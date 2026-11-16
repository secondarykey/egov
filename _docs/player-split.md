# Player.jsx の分割（作業計画）

`_cmd/egov/frontend/src/Player.jsx` は状態・ref・入力処理をほぼすべて抱えていて大きすぎる。
**動作を変えずに**、読みやすい単位へ切り分ける。

この文書は作業の引き継ぎ用。終わったら「分割後の構成」として書き直すか、
AGENTS.md の Architecture へ要点を移して消す。

## 前提

- 0.7.2 の次のリリースを出してから着手する。そのリリースには構造見直しの Go 側の修正
  （`SettingsStore`、`UpdateDialogSettings`、`NewFileHandler`、定数照合テスト、PR 用 CI）が入っている。
  作業ブランチはそれを含む main から切る
- 作業前に AGENTS.md の「守ること」と `_docs/rendering.md`・`_docs/vr-projection.md` を読む
- 画面操作での確認はエージェントからはできない。ビルドを渡し、下の確認項目を人に見てもらう

## 現状（2026-11 時点）

- `Player.jsx` は約1550行。`useRef` 約60個、`useState` 約40個、`Ref.current` の参照は約210か所
- `player/useThreeScene.js` は ref を23個そのまま返している（`mountRef`, `videoRef`, `cameraRef`, …,
  `planePassRef`）。フックに分けた意味が薄く、中の構造が外に漏れている
- 描画は `player/` の各コンポーネントへ分けてある（`ControlBar`・`SeekBarArea`・`ZoomInset`・
  `VrViewpointOverlay` など）。問題は状態と処理が `Player` に集まっていること

### ref が多い理由（崩さないこと）

`useEffect(() => { ... }, [])` で一度だけ登録するリスナー（キー操作、`open-file`、focus など）が多く、
その中から呼ぶ関数は**初回描画時のクロージャ**のまま残る。最新の値は ref 経由で読むことで
この古いクロージャ問題を避けている。例:

- 矢印キーの effect は `doZoneSeek(arrowSeekSecsRef.current, …)` を初回の関数のまま呼ぶ
- `handleSceneError` は `useState(() => fn)` で安定参照にし、最新の `reloadMedia` へは
  `reloadMediaRef` 経由で届けている（`useThreeScene` がマウント時の関数を持ち続けるため）

フックへ出すときも「一度だけ登録するリスナーは ref を読む」形を保つ。state に置き換えて
依存配列に足すと、リスナーの付け外しが毎回起き、コマ送りのラッチ（`frameSeeking`）などが壊れる。

## 進め方

### 1. 設定値の ref をまとめる

設定を1項目ずつ写している ref をオブジェクト1つにまとめる。

| 今の ref | 設定の項目 |
|---|---|
| `clickTimeoutMsRef` / `doubleClickSeekRef` / `dragSeekSecsRef` / `fastSeekSecsRef` / `arrowSeekSecsRef` / `thumbGridSizeRef` / `uiHideDelayRef` / `uiHideLeaveDelayRef` | `settings.controls` |
| `vrSensitivityRef` / `vrScrollSpeedRef` | `settings.vr.dragSensitivity` / `scrollSpeed` |
| `acceptInactiveRef` | `settings.app.acceptInactiveClick` |

- 例: `controlsRef.current = s.controls`。`applyControlSettings` はその代入だけになる
- 設定値は Go 側で正規化済み（`SettingsStore.update` が必ず `normalize()` を通す）なので、
  フロントでのフォールバックは要らない
- **VR視点の ref（`vrYawRef`・`vrPitchRef`・`vrRollRef`・`vrShiftRef`・`vrFovRef`・`vrSrcFovRef`・
  `vrSrcProjRef`・`vrDispProjRef`・`vrStartRef`）はこの対象にしない。** 保存とリセットを
  `currentVrView()` / `restoreVrView()` の1オブジェクトで対称に扱う仕組みがあるので、それを崩さない
  （まとめるなら `currentVrView()` の形のまま1つの ref に持つ）

### 2. 塊ごとにカスタムフックへ出す

置き場所は `src/player/`。候補（関数名は今の `Player.jsx` のもの）:

| フック（仮名） | 中身 |
|---|---|
| `useMediaLoader` | `openMedia`・`loadFilePath`・`handleOpenFile`・`reloadMedia`（`recoveryRef`・`newRecovery`）・`applyDetectedFormat`（`loadSeqRef`）・`safePlay`。メディアの種類（`mediaKindRef`・`isImage`・`isAnim`・`animRef`）もここ |
| `usePointerSeek` | `handleCanvasMouseDown/Up/Click`・長押しのゾーンシーク（`startZoneSeek`・`stopZoneSeek`・`doZoneSeek`・`hideSeekOverlay`）・クリックの判定に使う ref 群（`clickTimerRef`・`holdTimerRef`・`holdOriginRef`・`wasHoldRef` など） |
| `useDropWatchdog` | `handleDragEnter/Leave/Over/Drop`・`armDragWatchdog`・`clearDragWatchdog`・`endDrag` |
| `useKeyboardShortcuts` | 矢印キー（コマ送り・シーク）と診断オーバーレイ（Ctrl+Shift+D）の effect |
| `useVrView` | `syncVrView`・`currentVrView`・`restoreVrView`・`toOverlay`/`fromOverlay`・`persistVRView`・VR モードのマウス操作の effect |

1つずつ出して、そのたびにビルドしてコミットする。まとめて動かさない。

### 3. `useThreeScene` の返り値を整理する（無理はしない）

23個の ref を、使う側から見たまとまり（シーン本体、描画の要求、診断用カウンタ、メディア表示の切替）に
分けて返せるなら分ける。Player 側の参照が大きく変わるので、1・2 が終わってから判断する。

## 守ること（この作業で特に壊しやすいもの）

AGENTS.md の「守ること」がすべて前提。そのうち分割で崩しやすいもの:

- `onChangeCommitted` などから `onCommit`（既定として保存）を呼ばない。Reset の戻り先が壊れる
- 最初のフレームは `loadeddata` で描く。`play` イベントだけをきっかけにしない（Linux で自動再生が拒否される）
- 映像側の mousedown / click は `utils.isResizeEdge()` でリサイズ域を先に弾く
- ファイルドロップは Go の `WindowFilesDropped`（`open-file` イベント）に一本化。DOM の `drop` で読み込まない
- `<video>`・`VideoTexture`・`WebGLRenderer` を2つ目に作らない
- 画像のときは video の `src` を `removeAttribute('src')` + `load()` で外す
- ファイルの読み込みは設定の適用（音量・ミュート）が終わってから。`settingsReady` の順序を保つ

## 完了の条件

- `_cmd/egov/frontend` で `npm run build`、`_cmd/egov` で `go build` が通る（PR では CI も通る）
- 挙動が変わっていない（下の確認項目を人に見てもらう）
- 区切りごとにコミットしてある（Conventional Commits、末尾に「Glory to mankind.」）

## 人に見てもらう確認項目

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
