# TODO

## 機能

### 再生速度（倍速）の変更

動画・アニメーション画像の再生速度を変えられるようにする（0.25〜2倍など）。

- 動画（AVIF 含む）は `HTMLVideoElement.playbackRate` を変えるだけで済む。
  音声は既定で `preservesPitch = true`（音程を保ったまま速度だけ変わる）
- アニメーション画像（`player/AnimPlayer.js`）は `playbackRate` を持っていないので実装が要る。
  再生位置は `performance.now()` 基準の時計（`_clockBase`）から求めているので、
  経過時間に倍率を掛け、倍率を変えた時点で `_clockBase` を取り直せばよい
- 高倍速では表示時間の短いコマが画面の更新周期（60Hz なら約16ms）より短くなり、
  コマが飛ぶ。速度は時計基準なので崩れない
- UI の置き場所・ショートカットキー・倍率を保存するかは未定

## 構造の見直し（残り）

- **パスを受け取る binding に許可リストの確認を足す** — `OpenAnimation`・`DetectVRFormat`・`CanExtract`・
  `ExtractRange` はフロントから来たパスをそのまま使う。HTTP 配信は `LocalFiles` の許可リストで
  守っているが、binding は通っていない。各メソッドの先頭で `a.files.IsAllowed(path)` を確かめ、
  テストを足す（呼ぶのは自前のフロントだけなので危険は小さく、方針と実装を揃えるのが目的）
- 急がないもの
  - MP4（ISOBMFF）の箱を読む処理が3つある（`internal/mp4cut` は mp4ff、`internal/vrformat` と
    `internal/animimage/avif.go` は自前）。後の2つは上位の箱を読むだけなので、まとめる利点は小さい
  - `internal/locales/` は JSON だけで Go パッケージではないが `internal/` にある。移すなら
    `locales.go` の `//go:embed` のパスも変える

## 既知の制限・改善

- アニメーション AVIF は video 要素で再生するため、透過（アルファの補助トラック）が反映されない
- アニメーション AVIF の Linux（WebKitGTK）/ macOS（WKWebView）での再生は未確認
- 情報パネルのフレームレートは、動画だと再生中に実測する方式のため、
  一時停止のまま開くと「—」になる
