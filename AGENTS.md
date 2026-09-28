# AGENTS.md

This file provides guidance to coding agents (Claude Code など) when working with code in this repository.

## Project Overview

**egov** is a desktop VR video player built with [Wails3](https://v3.wails.io/) — a framework that pairs a Go backend with a React + TypeScript frontend compiled into a single native binary. The app focuses on split-screen VR video playback with zoom support.
It also opens still images (normal/free modes only) and plays animated images
(WebP / GIF / APNG / AVIF) with the same controls as video.

## Commands

All commands are run from `_cmd/egov/` using [Task](https://taskfile.dev/).

```bash
task dev             # Development (hot-reload for both Go and frontend)
task build           # Production build
task run             # Run the built binary
task windows:build   # / darwin:build / linux:build
task build:server    # Headless HTTP server (no GUI)
task run:server
```

Frontend commands (from `_cmd/egov/frontend/`): `npm run dev` / `npm run build` / `npm run build:dev`

Regenerate Go→TypeScript bindings after changing the `API` struct:

```bash
wails3 generate bindings -f '' -clean=true
```

## Architecture

- **Two Go modules**: root `egov`（`API` struct と共有ライブラリ、`internal/` 配下に
  `animimage` / `mp4cut` / `vrformat`）と `_cmd/egov`（Wails3 のエントリポイント・ビルドアセット・
  フロントエンド）。`_cmd/egov/go.mod` はルートを `replace` で参照する
- **Binding**: `api.go` の `API` にメソッドを足す → bindings を再生成 → フロントで
  `_cmd/egov/frontend/bindings/` から import
- **Events**: Go は `app.Event.Emit(name, payload)`、フロントは `@wailsio/runtime` の `Events.On`
- **Embedding**: Vite の出力 `frontend/dist/` を `//go:embed` している。本番バイナリに
  フロントの変更を入れるにはビルドし直す
- **Frontend**: `src/Player.jsx` が状態・ref・入力処理を持ち、描画は `src/player/` の各コンポーネントに
  委ねる。高頻度で更新する部分（シークバー・時間表示）は `memo` で切り離してある
- Three.js（`r0.184`）＋ MUI。表示モードは `normal` / `free` / `vr`（設定の旧名 `fit` は
  `Settings.normalize()` が `normal` へ移す）
- マウス割り当ては free と vr で揃えてある: **右ドラッグ＝平行移動、ホイール＝寄る/引く、
  中ドラッグ＝VRの首振り**。左ボタンは全モードで再生・シークが使う
- 小窓ズーム（normal / free）も同じ割り当て: 小窓の上で右ドラッグ＝範囲の平行移動、ホイール＝寄る/引く。
  左ドラッグは小窓の移動（角でリサイズ）

## 詳細ドキュメント（`_docs/`）

該当箇所を触る前に読むこと。

| ファイル | 内容 |
|---|---|
| [`_docs/rendering.md`](_docs/rendering.md) | Three.js で動画を描く仕組み（小窓ズーム、レンダーオンデマンド、rVFC が動かない環境、テクスチャ） |
| [`_docs/vr-projection.md`](_docs/vr-projection.md) | VR投影シェーダ、素材形式の推定、色空間、視点の保存とリセット |
| [`_docs/images-and-animations.md`](_docs/images-and-animations.md) | 静止画、アニメーション画像（WebP/GIF/APNG）の展開と再生、アニメーション AVIF |
| [`_docs/range-extract.md`](_docs/range-extract.md) | MP4 の無劣化切り出し（`internal/mp4cut`）と UI |

## 守ること

### 描画・VR
- `texture.repeat/offset` は平面モードと共有しているので触らない。VR の左右／上下の切り出しは
  シェーダの `uSrcOffset` / `uSrcRepeat` で行う
- VR シェーダは `VideoTexture` 前提で sRGB を自前で復号している。画像（`THREE.Texture`）を
  そのまま通すと暗くなるので、**画像・アニメーション画像では VR を無効にしている**
- 最初のフレームは `loadeddata` で描く。`play` イベントだけを描画のきっかけにしない
  （Linux では自動再生が拒否される）
- VR 視点はディスクへ書かない。保存は「既定として保存」（`onCommit`）だけ。
  **`onChangeCommitted` などから `onCommit` を呼ばない**（Reset の戻り先が壊れる）
- VR 視点の保存とリセットは `currentVrView()` の1オブジェクトで対称に扱う。個別の ref に分けない
- 小窓ズームは同じ `scene` / `VideoTexture` を2つ目のカメラで scissor 描画する（`planePassRef`）。
  `<video>`・`VideoTexture`・`WebGLRenderer` を2つ目に作らない（デコードや転送が倍になる）
- 表示画角の上限 180° を「歪むから」で手前に切らない（`projScaleFor()` が発散を潰している）
- 素材形式の推定結果はセッション中だけの上書き。ディスクへ書かない

### メディアの種類
- 画像の拡張子はフロント `utils.IMAGE_EXTS` と Go `imageExts` を揃える
- 画像のときは video の `src` を `removeAttribute('src')` + `load()` で外す（`src = ''` は error を出す）
- アニメーションかどうかは拡張子ではなく中身で判定する（`.png` の APNG があるため）
- WebP の fork（`github.com/secondarykey/image`）の `replace` はルートと `_cmd/egov` の
  **両方の go.mod** にある。更新するときは両方を上げる

### 切り出し
- 開始点は直前のキーフレームにスナップされる。読み込み中の元ファイルへの上書きは必ず弾く

### Wails / プラットフォーム
- **`--wails-draggable: drag` はタイトルバーだけに付ける。** canvas に付けると右ドラッグが壊れる
- `main.jsx` の `import '@wailsio/runtime'`（ベア import）を消さない。ドラッグが効かなくなる
- 映像側の mousedown / click は `utils.isResizeEdge()` でリサイズ域を先に弾く
  （リサイズに入ると mouseup が届かない）
- ファイルドロップは Go の `WindowFilesDropped` に一本化する。DOM の `drop` は
  Linux/macOS では届かず、両方で処理すると二重に読み込む。`relatedTarget=null` の
  `dragleave` は無視する
- ファイルを開くのは `Dialogs.OpenFile` ＋ `API.OpenLocalFile`。**`<input type="file">` は使わない**
  （パスが取れない）。フロントが読めるのはユーザーが明示的に開いたファイルだけ
  （`egov.LocalFiles` の許可リスト）
- 閉じるボタンは `Window.Close()` ではなく `Quit()` binding を呼ぶ（終了時にウィンドウ位置を保存するため）。
  ウィンドウの復元は `WindowRuntimeReady` で行う
- Linux では `webkitenv_linux.go` が `WEBKIT_DISABLE_DMABUF_RENDERER=1` を既定にしている
  （DMA-BUF による映像化け対策、`application.New()` より前に設定）
- Linux では `-tags production,devtools` がビルドできない。本番ビルドの切り分けには
  `Ctrl+Shift+D` の診断オーバーレイ（`player/DiagnosticsOverlay.jsx`）を使う

### Worktree
- ワークツリーでは `_cmd/egov/frontend/node_modules` をメインリポジトリから
  ジャンクションで張る。**ワークツリー側で `npm install` しない**（ジャンクションが壊れる）

  ```powershell
  New-Item -ItemType Junction -Path "_cmd\egov\frontend\node_modules" -Target "D:\Go\Projects\egov\_cmd\egov\frontend\node_modules"
  New-Item -ItemType Directory -Path "_cmd\egov\frontend\dist" -Force   # go:embed 用
  ```
- `build/Taskfile.yml` の `install:frontend:deps` は `status: test -d node_modules` に変えてある。
  `wails3 update build-assets` で上書きされるので、実行したら直し直す

## Key Configuration Files

- `_cmd/egov/build/config.yml` — Wails3 app metadata and dev server settings
- `_cmd/egov/Taskfile.yml` + `_cmd/egov/build/Taskfile.yml` — all build tasks
- `_cmd/egov/frontend/vite.config.js` — Vite + Wails plugin configuration
