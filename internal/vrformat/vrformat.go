// Package vrformat は動画ファイルから VR 素材の形式（フレームのどこを使うか・
// 投影方式・画角）を推定する。
//
// 判定の優先順位は「メタデータ → ファイル名」。項目ごとに独立していて、
// メタデータで決まらなかった項目だけをファイル名で埋める。どちらでも
// 決まらなかった項目は空のまま返し、呼び出し側が保存済みの既定値を使う。
//
// メタデータは MP4/MOV の Spherical Video V2（サンプルエントリ配下の
// st3d / sv3d）と V1（trak 直下の uuid box に入った XML）を読む。
// ffmpeg で加工したファイルや配布サイトの動画はメタデータが消えていることが
// 多いため、プレイヤー間で慣習になっているファイル名の印（_LR / _TB / _180 等）も見る。
package vrformat

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Format は推定結果。空文字列／0 は「決まらなかった」を表す。
type Format struct {
	// Start はフレームのどこを使うか。"left"（左右分割）/ "top"（上下分割）/ "full"（モノラル）。
	Start string `json:"start"`
	// Projection は素材の投影方式。"equirect" / "equidistant"。
	Projection string `json:"projection"`
	// FOV は素材の（片目分の）水平画角（度）。
	FOV float64 `json:"fov"`
	// Source は判定の根拠。"metadata" / "filename" / "metadata+filename" / ""。
	Source string `json:"source"`
}

func (f Format) empty() bool { return f.Start == "" && f.Projection == "" && f.FOV == 0 }

// merge は f の空いている項目だけを o で埋める。
func (f Format) merge(o Format) Format {
	if f.Start == "" {
		f.Start = o.Start
	}
	if f.Projection == "" {
		f.Projection = o.Projection
	}
	if f.FOV == 0 {
		f.FOV = o.FOV
	}
	return f
}

// Detect は path の形式を推定する。ファイルが開けない・解析できない場合も
// エラーにはせず、ファイル名だけで推定した結果を返す。
func Detect(path string) Format {
	meta, _ := FromMetadata(path)
	name := FromFileName(path)
	out := meta.merge(name)
	switch {
	case !meta.empty() && !name.empty() && out != meta:
		out.Source = "metadata+filename"
	case !meta.empty():
		out.Source = "metadata"
	case !name.empty():
		out.Source = "filename"
	}
	return out
}

// --- ファイル名 ---

var fisheyeToken = regexp.MustCompile(`^FISHEYE(\d{3})?$`)

// FromFileName はファイル名の慣習的な印から推定する。
// 区切り文字（_ - . 空白など）で分けたトークン単位で完全一致を見るので、
// "SBS" を含む単語に誤反応しない。
func FromFileName(path string) Format {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	tokens := strings.FieldsFunc(strings.ToUpper(base), func(r rune) bool {
		return !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9')
	})
	var f Format
	for _, t := range tokens {
		switch t {
		case "LR", "SBS", "3DH", "SIDEBYSIDE":
			f.Start = "left"
		case "TB", "OU", "3DV", "TOPBOTTOM", "OVERUNDER":
			f.Start = "top"
		case "MONO":
			f.Start = "full"
		case "180", "360":
			f.Projection = "equirect"
			f.FOV, _ = strconv.ParseFloat(t, 64)
		default:
			if m := fisheyeToken.FindStringSubmatch(t); m != nil {
				f.Projection = "equidistant"
				f.FOV = 180
				if m[1] != "" {
					f.FOV, _ = strconv.ParseFloat(m[1], 64)
				}
			}
		}
	}
	return f
}

// --- メタデータ ---

// maxMoovSize は読み込む moov の上限。moov はサンプルテーブルなので数時間の
// 動画でも数十MB程度に収まる。壊れたサイズ値で巨大な確保をしないための保険。
const maxMoovSize = 512 << 20

// sphericalV1UUID は Spherical Video V1 の XML を入れる uuid box の識別子。
var sphericalV1UUID = []byte{0xff, 0xcc, 0x82, 0x63, 0xf8, 0x55, 0x4a, 0x93, 0x88, 0x14, 0x58, 0x7a, 0x02, 0x52, 0x1f, 0xdd}

// visualSampleEntryHeader は VisualSampleEntry の固定部の長さ。子box（avcC, st3d 等）はこの後に続く。
const visualSampleEntryHeader = 78

var errNoMoov = errors.New("vrformat: moov not found")

// FromMetadata は MP4/MOV の Spherical Video メタデータから推定する。
// 映像トラックが複数ある場合は最初のものを使う。
func FromMetadata(path string) (Format, error) {
	fp, err := os.Open(path)
	if err != nil {
		return Format{}, err
	}
	defer fp.Close()

	moov, err := readTopLevel(fp, "moov")
	if err != nil {
		return Format{}, err
	}
	for _, trak := range children(moov, "trak") {
		if !isVideoTrak(trak) {
			continue
		}
		f := fromSampleEntry(trak)
		if f.empty() {
			f = fromV1(trak)
		}
		return f, nil
	}
	return Format{}, nil
}

// readTopLevel はファイル先頭から最上位 box を辿り、name の本体を返す。
// mdat は読まずに読み飛ばす。
func readTopLevel(r io.ReadSeeker, name string) ([]byte, error) {
	var hdr [16]byte
	for {
		if _, err := io.ReadFull(r, hdr[:8]); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil, errNoMoov
			}
			return nil, err
		}
		size := uint64(binary.BigEndian.Uint32(hdr[:4]))
		typ := string(hdr[4:8])
		hlen := uint64(8)
		switch size {
		case 1:
			if _, err := io.ReadFull(r, hdr[8:16]); err != nil {
				return nil, err
			}
			size = binary.BigEndian.Uint64(hdr[8:16])
			hlen = 16
		case 0:
			// ファイル末尾まで。moov がこれだと大きさが分からないので対象外
			return nil, errNoMoov
		}
		if size < hlen {
			return nil, errors.New("vrformat: invalid box size")
		}
		body := size - hlen
		if typ == name {
			if body > maxMoovSize {
				return nil, errors.New("vrformat: moov too large")
			}
			buf := make([]byte, body)
			if _, err := io.ReadFull(r, buf); err != nil {
				return nil, err
			}
			return buf, nil
		}
		if _, err := r.Seek(int64(body), io.SeekCurrent); err != nil {
			return nil, err
		}
	}
}

// box は子boxの型と本体。
type box struct {
	typ  string
	body []byte
}

// parseBoxes は data を box の並びとして分解する。壊れていたらそこで打ち切る。
func parseBoxes(data []byte) []box {
	var out []box
	for len(data) >= 8 {
		size := uint64(binary.BigEndian.Uint32(data[:4]))
		typ := string(data[4:8])
		hlen := uint64(8)
		switch size {
		case 1:
			if len(data) < 16 {
				return out
			}
			size = binary.BigEndian.Uint64(data[8:16])
			hlen = 16
		case 0:
			size = uint64(len(data))
		}
		if size < hlen || size > uint64(len(data)) {
			return out
		}
		out = append(out, box{typ, data[hlen:size]})
		data = data[size:]
	}
	return out
}

func children(data []byte, typ string) [][]byte {
	var out [][]byte
	for _, b := range parseBoxes(data) {
		if b.typ == typ {
			out = append(out, b.body)
		}
	}
	return out
}

func child(data []byte, typ string) []byte {
	if c := children(data, typ); len(c) > 0 {
		return c[0]
	}
	return nil
}

// descend は入れ子の box を順に辿る。
func descend(data []byte, types ...string) []byte {
	for _, t := range types {
		if data = child(data, t); data == nil {
			return nil
		}
	}
	return data
}

// isVideoTrak は hdlr の handler_type が vide かを見る。
// hdlr は FullBox（4バイト）＋ pre_defined（4バイト）の後に handler_type が来る。
func isVideoTrak(trak []byte) bool {
	hdlr := descend(trak, "mdia", "hdlr")
	return len(hdlr) >= 12 && string(hdlr[8:12]) == "vide"
}

// fromSampleEntry は Spherical Video V2 の st3d / sv3d を読む。
func fromSampleEntry(trak []byte) Format {
	stsd := descend(trak, "mdia", "minf", "stbl", "stsd")
	// stsd は FullBox（4バイト）＋ entry_count（4バイト）の後にサンプルエントリが並ぶ
	if len(stsd) < 8 {
		return Format{}
	}
	entries := parseBoxes(stsd[8:])
	if len(entries) == 0 || len(entries[0].body) < visualSampleEntryHeader {
		return Format{}
	}
	ext := entries[0].body[visualSampleEntryHeader:]

	var f Format
	// st3d: FullBox（4バイト）＋ stereo_mode（1バイト）
	if st3d := child(ext, "st3d"); len(st3d) >= 5 {
		switch st3d[4] {
		case 0:
			f.Start = "full"
		case 1:
			f.Start = "top"
		case 2:
			f.Start = "left"
		}
	}
	// sv3d/proj の中身が equi なら正距円筒。cbmp（キューブマップ）や
	// mshp（メッシュ）は egov が貼れないので投影方式は決めない。
	if equi := descend(ext, "sv3d", "proj", "equi"); equi != nil {
		f.Projection = "equirect"
		f.FOV = 360
		// equi: FullBox（4バイト）＋ bounds top/bottom/left/right（0.32 固定小数点）。
		// 左右から削った割合を 360° から引いたものが水平画角。VR180 は左右とも 0.25。
		if len(equi) >= 20 {
			left := float64(binary.BigEndian.Uint32(equi[12:16])) / (1 << 32)
			right := float64(binary.BigEndian.Uint32(equi[16:20])) / (1 << 32)
			if fov := 360 * (1 - left - right); fov > 0 {
				f.FOV = fov
			}
		}
	}
	return f
}

var (
	v1StereoMode = regexp.MustCompile(`<GSpherical:StereoMode>\s*([\w-]+)\s*<`)
	v1Projection = regexp.MustCompile(`<GSpherical:ProjectionType>\s*(\w+)\s*<`)
	v1CropWidth  = regexp.MustCompile(`<GSpherical:CroppedAreaImageWidthPixels>\s*(\d+)\s*<`)
	v1FullWidth  = regexp.MustCompile(`<GSpherical:FullPanoWidthPixels>\s*(\d+)\s*<`)
)

// fromV1 は Spherical Video V1（trak 直下の uuid box に入った XML）を読む。
func fromV1(trak []byte) Format {
	var f Format
	for _, u := range children(trak, "uuid") {
		if len(u) < 16 || !bytes.Equal(u[:16], sphericalV1UUID) {
			continue
		}
		xml := u[16:]
		if m := v1StereoMode.FindSubmatch(xml); m != nil {
			switch string(m[1]) {
			case "mono":
				f.Start = "full"
			case "top-bottom":
				f.Start = "top"
			case "left-right":
				f.Start = "left"
			}
		}
		if m := v1Projection.FindSubmatch(xml); m != nil && string(m[1]) == "equirectangular" {
			f.Projection = "equirect"
			f.FOV = 360
			crop, full := v1CropWidth.FindSubmatch(xml), v1FullWidth.FindSubmatch(xml)
			if crop != nil && full != nil {
				c, _ := strconv.ParseFloat(string(crop[1]), 64)
				w, _ := strconv.ParseFloat(string(full[1]), 64)
				if c > 0 && w > 0 && c <= w {
					f.FOV = 360 * c / w
				}
			}
		}
		return f
	}
	return f
}
