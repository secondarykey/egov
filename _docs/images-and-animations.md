# 静止画とアニメーション画像

## 静止画の表示

画像（`api.go` の `imageExts` / フロントの `utils.IMAGE_EXTS`、両者は揃えること）も開ける。
**画像は normal / free だけで、VR は無効**（タイトルバーの VR ボタンを disabled にし、
VR 中に開いたら normal へ落とす）。

- 読み込みは `Player.openMedia()` に一本化してある。画像のときは **video 要素の src を外す**
  （`removeAttribute('src')` + `load()`。`src = ''` は error を発火させる）。
  再生・シーク・コマ送り・サムネイル・長押しシークはすべて `video.src` の有無で
  早期 return するので、個別の分岐は不要
- 描画は `useThreeScene` の `showImage()` / `showVideo()` が平面マテリアルの `map` を
  `THREE.Texture`（画像）と `VideoTexture` で差し替える。画像は一度アップロードすれば
  描画ループは不要（操作・リサイズ時の `requestRender` だけ）
- **VR に画像を通さない理由は色空間。** `THREE.Texture` は sRGB 内部フォーマットで持たれ、
  サンプル時点で線形化済み。VRシェーダは VideoTexture 前提で `sRGBTransferEOTF()` を
  自前でかけているので、そのまま通すと二重復号で暗く沈む（[vr-projection.md](vr-projection.md) の「色空間」）
- GPU の `maxTextureSize` を超える画像はキャンバスで縮小してから渡す
- ウィンドウのフィット（Reset）は `mediaSizeRef`（動画／画像共通の画素数）を使う。
  作業領域（`Window.GetScreen().WorkArea`）に収まらない素材は、縦横比を保って縮めた
  サイズにし、何%表示かを Snackbar で出す（`fitWindowToMedia()`）。そのまま `SetSize` すると
  OS が片方の辺だけクランプし、ウィンドウは最大近くなのに画は余白付きという状態になる

## アニメーション画像（WebP / GIF / APNG）

WebView は `<img>` ならアニメーション画像を再生できるが、WebGL へ渡せるのは先頭フレームだけで
シークもできない。そこで **Go 側で全フレームを合成して保持し、フロントは video 要素と同じ顔の
`player/AnimPlayer.js` で再生する**。

### デコーダ

- WebP: `golang.org/x/image` の fork（`github.com/secondarykey/image` の
  `feature/webp-animated`、`webp.DecodeAnimated`）。ルートと `_cmd/egov` の **両方の go.mod** に
  `replace` がある（replace はメインモジュールでしか効かないため）。fork を更新したら両方の
  擬似バージョンを上げること
- GIF: 標準の `image/gif`（`DecodeAll`）
- APNG: `github.com/kettek/apng`（タグ無し、擬似バージョンで取り込み）。先頭の既定画像
  （`IsDefault`）はアニメーションに含めない

### 合成（`internal/animimage`）

- 形式ごとの差（位置・重ね方・消し方・表示時間の単位）は `formats.go` で共通の `frame` に揃え、
  合成は `compose()` だけが行う
- 消し方は「そのまま / 透明に戻す / 直前に戻す（GIF・APNG のみ）」の3種。
  背景色ではなく透明に戻すのは libwebp / ブラウザと同じ
- 10ms 以下の表示時間は 100ms 扱い（これもブラウザと同じ、GIF の `delay=0` 対策）
- 合計 `MaxBytes`（1GB）を超える素材は展開せず静止画で出す

### 判定

**形式もアニメーションかどうかも拡張子ではなく中身で判定する**（`IsAnimated`）。
`.png` の APNG があるため。軽い判定で済ませる:

- WebP は VP8X のフラグ
- APNG は IDAT より前の `acTL`。acTL があっても1フレームの APNG は `ErrNotAnimated` → 静止画
- GIF は画像記述子が2つあるか（LZW は展開しない）

フロントは `utils.mayBeAnimatedPath()`（webp/gif/png/apng）のときだけ `OpenAnimation` を呼ぶ。

### 配信と再生

- `API.OpenAnimation(path)` が展開して `AnimStore` に1本だけ保持し、フレームはローカルファイル
  サーバの `/animframe?token=&id=&i=` で生の RGBA として配る（バインディングで []byte を返すと
  base64 の JSON になり毎フレームには重い）。`id` は開き直すたびに増え、古い id の要求は 410
- Player は **`videoRef.current` を AnimPlayer に差し替える**。シークバー・時間表示・範囲ループ・
  ダブルクリック／長押しシークは video 要素と同じプロパティとイベントで動く。
  本物の video 要素は `videoElRef`（診断オーバーレイ・コマ送りのラッチ・ループ初期値）
- 画像と同じく VR は無効。サムネイル（ホバー／一覧）と音量も出さない。
  ホバーサムネイルの可否は設定値そのものではなく `thumbHoverRef` を SeekBarArea へ渡している
- 描画は canvas を `imageTexture` に貼り、フレームを描き換えるたびに `refreshCanvasRef` で
  再アップロードする（ミップマップ生成は切る）

## アニメーション AVIF（展開せず動画として再生）

中身は ISOBMFF（moov/trak、ハンドラ `pict`、`av01` サンプル）で MP4 と同じ構造をしており、
Chromium（WebView2）の `<video>` で動画として再生できる。
`API.OpenAnimation` は ftyp に `avis` ブランドがあれば `AsVideo=true` を返し、
フロントは通常の動画として開く（VR・サムネイル・範囲ループなども動画と同じく使える）。

- ⚠️ **そのままでは再生できない。** AVIF シーケンスはトップレベルの `meta` に代表画像（静止画
  1枚）を持ち、Chromium のデマクサ（FFmpeg）はこれを moov のトラックより前の映像ストリームとして
  見せる。video 要素はその1フレームの方を選ぶため、読み込み直後に末尾（duration）へ飛んで
  ended になる（`loadeddata` の時点で `currentTime == duration`）。
  ローカルファイルサーバの `egov.ServeLocalFile()` が、配信時に **`meta` の box type だけを
  同じ長さの `free` に読み替える**（`animimage.AVIFVideo`、ファイルは書き換えない）。
  サイズが変わらないので stco のオフセットは直さなくてよい。ブランドや hdlr（`pict`）は
  そのままで再生できる
- ⚠️ 検証の落とし穴: 読み込み後にすぐシークするテストでは上の症状が見えない（シーク先は
  正しく出る）。再生開始位置と `currentTime` の進みで確かめること
- 実機の WebView2 を外から調べるには、`application.Options.Windows.AdditionalBrowserArgs` に
  `--remote-debugging-port=<port>` を足した一時ビルドを使い、CDP の `Runtime.evaluate` で
  状態を読む（環境変数 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` は Wails が引数を渡すため効かない）
- 静止画の AVIF（`avif` ブランドのみ）は画像ビューアで表示する
- AV1 を WebAssembly でデコードして展開する案（`gen2brain/avif`）は、バイナリ +7MB・
  1080p/5秒で展開6秒・約1GB と重いので採らなかった
- 透過（アルファ用の補助トラック）は video 要素では反映されない
- WebKitGTK / WKWebView での再生は未確認
