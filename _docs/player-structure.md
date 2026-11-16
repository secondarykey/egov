# Player の構成

`_cmd/egov/frontend/src/Player.jsx` は、状態・設定・入力処理をつなぐだけの役にしてある。
処理の塊は `src/player/` のカスタムフックに、描画は同じ場所のコンポーネントに置く。
2026-11 に Player.jsx（約1550行）を分割した。そのときの決めごとをここに残す。

## フックの分担

| フック | 持つもの |
|---|---|
| `useThreeScene` | Three.js のシーン・`<video>`・描画ループ。ref をまとめて返す |
| `useDropWatchdog` | ドロップ表示（`DropHint`）の出し入れ。`dragover` が途切れたら消すウォッチドッグ |
| `usePointerSeek` | 映像の上の左ボタン（クリックで再生/停止、ダブルクリックで前後シーク、長押しでゾーンシーク）。非アクティブ時のクリックを弾くフォーカス判定 |
| `useKeyboardShortcuts` | 矢印キー（再生中はシーク、一時停止中はコマ送り）と Ctrl+Shift+D（診断オーバーレイ） |
| `useVrView` | VR 視点の ref・保存・リセット・オーバーレイ・VR モードのマウス操作。設定からの読み込み（`loadSavedVrView`）と素材形式の推定結果の反映（`applySourceFormat`） |
| `useMediaLoader` | メディアを開く（`openMedia`・`loadFilePath`・`handleOpenFile`）、デコードエラーからの復旧（`reloadMedia`）、`safePlay`。メディアの種類・ファイル名・切り出し可否 |

Player に残っているもの: カメラの切り替え（モード・回転）、設定の読み込みと `open-file` の受け取り、
UI の表示/非表示、再生系のボタン（音量・ループ・全画面など）、切り出し・スナップショット・サムネイル一覧、
各コンポーネントへの受け渡し。

### フックどうしのつなぎ方

- **設定値**は Player が設定の形のまま ref に持ち（`controlSettingsRef`＝`settings.controls`、
  `vrInputRef`＝VR の感度とホイール速度、`appSettingsRef`＝`settings.app`）、フックへは ref を渡す。
  項目ごとの ref に分けない。設定値は Go 側で正規化済みなので、フロントでのフォールバックは要らない
  （初期値の `INITIAL_CONTROLS` などは読み込みが終わるまでの暫定値）
- **メディアを開いたときの片付け**（サムネイル・範囲ループ・VR からの退避）は Player の
  `handleMediaChange` が受ける。`useMediaLoader` は `onMediaChange({ kind, url })` を呼ぶだけ
- **video 要素のエラー**は `useThreeScene` がマウント時の関数のまま呼ぶので、Player は
  安定参照の `handleSceneError` を渡し、最新の `reloadMedia` へは `reloadMediaRef` 経由で届ける
  （`useMediaLoader` が描画ごとに入れる）
- **素材形式の推定**は、呼び出しと応答の新旧判定（`loadSeqRef`）を `useMediaLoader` が、
  結果の反映を `useVrView.applySourceFormat` が持つ
- `handlePlayPause` は `usePointerSeek` の呼び出しより後で定義しているので、`onPlayPause` には
  `() => handlePlayPause()` と包んで渡している（`const` の TDZ を避けるため）

## 一度だけ登録するリスナーは ref を読む（崩さないこと）

`useEffect(() => { ... }, [])` で一度だけ登録するリスナー（キー操作、`open-file`、focus など）が多く、
その中から呼ぶ関数は**初回描画時のクロージャ**のまま残る。最新の値は ref 経由で読むことで
この古いクロージャ問題を避けている。例:

- 矢印キーの effect は `doZoneSeek(controlSettingsRef.current.arrowSeekSecs, …)` を初回の関数のまま呼ぶ
- `open-file` と起動引数は初回の `loadFilePath` を呼ぶ。そこから `openMedia`・`handleMediaChange`・
  `applySourceFormat` も初回の関数が動く
- `handleSceneError` は `useState(() => fn)` で安定参照にしている

だから、フックが返す関数や、フックへ渡すコールバックは **ref と state の setter だけ**で書く。
描画ごとの state を読む関数を、一度だけ登録するリスナーから呼ばせない。
state に置き換えて依存配列に足すのもやめる。リスナーの付け外しが毎回起き、コマ送りのラッチ
（`frameSeeking`）などが壊れる。

## VR 視点は1オブジェクトで扱う

VR 視点の ref（`vrYawRef` など）は設定値の ref とは別に `useVrView` の中に持つ。保存とリセットは
`currentVrView()` / `restoreVrView()` の1オブジェクトで対称に扱う。個別の ref を外から読み書きしない。
詳しくは [`vr-projection.md`](vr-projection.md) の「保存とリセット」。

## `useThreeScene` の返り値はまとめていない

返り値の ref（22個）を「シーン本体・描画の要求・診断用カウンタ・メディア表示の切替」のように
まとめる案があった。分割後に見直して、見送った。各フックは要る ref を1つずつ受け取る形になっていて、
まとめても `scene.xxxRef` と前置きが増えるだけで読みやすくならない。使われていなかった `textureRef`
だけを外した。

## 確かめ方

- `_cmd/egov/frontend` で `npm run build`、`_cmd/egov` で `go build`、ルートで `go test ./...`
- フロントにリンタは無い。Vite のビルドは未定義の識別子や TDZ（`const` を宣言より前に読む）を
  見逃すので、Player やフックの間で関数を動かしたら、名前の取り違えに気を付ける
- 画面操作での確認はエージェントからはできない。ビルドを渡し、下の項目を人に見てもらう

### Player を大きく触ったあとに人に見てもらう項目

- 起動: 前回の音量・ミュート・既定モードが反映される。起動引数のファイルが開く
- 開く: ダイアログ・ドロップ・二重起動の転送（シングルインスタンス時）。動画・静止画・アニメーション画像（WebP/GIF/APNG）・アニメーション AVIF
- normal / free / vr の切替。free と vr の右ドラッグ（平行移動）・ホイール・中ドラッグ（VR の首振り）
- 左クリックで再生/停止、ダブルクリックで前後シーク、長押しでゾーンシークのオーバーレイ
- 矢印キー: 再生中はシーク、一時停止中はコマ送り（動画・アニメーション画像の両方）
- VR 視点オーバーレイ: スライダーの即時反映、「既定として保存」、Reset Camera で保存値（＋推定した素材形式）へ戻る
- 小窓ズーム（normal / free）: 表示・移動・リサイズ・小窓上の右ドラッグとホイール
- 範囲ループと無劣化切り出し、スナップショット、サムネイル一覧
- 設定ダイアログ: 保存後に操作系の設定（クリック判定時間・シーク秒数・UI を隠すまでの時間）が即反映される
- デコードエラーからの自動復旧と、エラー表示の「再読み込み」ボタン
- ウィンドウの縁でのリサイズ（映像の上でもクリック扱いにならない）
- Ctrl+Shift+D の診断オーバーレイ

## 守ること（Player を触るときに特に壊しやすいもの）

AGENTS.md の「守ること」がすべて前提。そのうち Player まわりで崩しやすいもの:

- `onChangeCommitted` などから `onCommit`（既定として保存）を呼ばない。Reset の戻り先が壊れる
- 最初のフレームは `loadeddata` で描く。`play` イベントだけをきっかけにしない（Linux で自動再生が拒否される）
- 映像側の mousedown / click は `utils.isResizeEdge()` でリサイズ域を先に弾く（`usePointerSeek`）
- ファイルドロップは Go の `WindowFilesDropped`（`open-file` イベント）に一本化。DOM の `drop` で読み込まない
- `<video>`・`VideoTexture`・`WebGLRenderer` を2つ目に作らない
- 画像のときは video の `src` を `removeAttribute('src')` + `load()` で外す
- ファイルの読み込みは設定の適用（音量・ミュート）が終わってから。`settingsReady` の順序を保つ
