# 範囲切り出し（無劣化カット、`internal/mp4cut`）

progressive MP4 (`moov` + `mdat`) から時間範囲をサンプル単位で
バイトコピーして切り出す。再エンコードしないためコーデック非依存
（H.264 / HEVC / AV1 いずれも可）。実装は [Eyevinn/mp4ff](https://github.com/Eyevinn/mp4ff) を使う。

## 処理の流れ

1. `stts` で時刻→サンプル番号を解決
2. `stss` で開始点を直前のキーフレームへスナップ
3. `stsc`/`stsz`/`stco` で入力チャンクを範囲の端で切り詰め
4. `stbl` 配下のテーブルを作り直す
5. mdat 本体の開始位置が確定してから chunk offset を絶対値へ補正

- **開始点は必ず sync sample にスナップされる**ため、指定より前にずれる。`ExtractResult.StartSec` に実際の値が返る
- `edts`/`elst` は元のタイムラインを指すため破棄する。`sdtp`/`sbgp`/`sgpd`/`subs`/`saio`/`saiz` も破棄する
- fragmented MP4 (`moof`) は非対応。対応拡張子は `API.CanExtract()`（`.mp4`/`.m4v`/`.mov`）が判定する
- 4GB 超の出力では mdat を largesize ヘッダ（16バイト）にし、chunk offset も `co64` にする

## 保存先

- **ネイティブの保存ダイアログ**（`Dialogs.SaveFile`、Go側Binding不要）で選ばせる。
  既定のフォルダ・ファイル名は `API.SuggestExtractTarget()` が
  `<元の場所>/<name>_02m00s-07m00s.mp4` の形で作る（衝突時は `_2` を付ける）
- 上書き確認はネイティブダイアログの責務なので `API.ExtractRange()` は既存ファイルを拒否しないが、
  **読み込み中の元ファイルへの上書きだけは必ず弾く**（`resolveExtractPath()` / `sameFile()`）。
  Windows/macOS は大文字小文字を区別しないため `os.SameFile` で実体比較する

## UI

- **既存の範囲ループのマーカーをそのまま in/out 点として使う**。選択範囲は
  `SeekBarArea` から `rangeRef`（ref）で Player へ公開する — state で持ち上げると
  マーカーのドラッグ中に Player 全体が再描画されるため
- 起動は右サイドパネル最上段のハサミ（範囲ループが ON のときだけ有効）
- **キーフレーム単位でしか切れないことはハサミのツールチップに注記する**
  （`controls.extractKeyframeNote`）。GOP 長はエンコーダ次第で、x264 のデフォルト
  （`keyint=250`）なら 30fps で約8秒空くため、黙っていると「指定と違う位置で切れた」
  という驚きになる。切り出し後の Snackbar には実際の範囲を出す
- 保存ダイアログを待っている間にマーカーが動いても影響しないよう、
  範囲はクリック時点の値をコピーして固定する
- 進行中と結果は Snackbar に出す（進行中は `busy` で自動クローズを止める）

## テストデータ

`internal/mp4cut/testdata/sample.mp4` は ffmpeg で生成した合成クリップ
（320x180 / 30fps / GOP 60 = キーフレームは 0,2,4,6,8秒 / AAC）。
出力の妥当性検証に ffmpeg デコードを使うテストがあるが、ffmpeg が無い環境ではスキップされる。
