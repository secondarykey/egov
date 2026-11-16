# TODO

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
  一時停止のまま開くと「—」になる。等速以外で再生している間も測らない（倍速では間引きで低く出るため）
- 再生速度: Linux（WebKitGTK）で倍速時に音程が保たれるかは未確認（GStreamer の `scaletempo` が要る）。
  ショートカットキーは未割り当て。高倍速のアニメーション画像は、表示時間が画面の更新周期より短いコマが飛ぶ
