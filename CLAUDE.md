# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**egov** is a desktop VR video player built with [Wails3](https://v3.wails.io/) — a framework that pairs a Go backend with a React + TypeScript frontend compiled into a single native binary. The app focuses on split-screen VR video playback with zoom support.

## Commands

All commands are run from `_cmd/egov/` using [Task](https://taskfile.dev/).

```bash
# Development (hot-reload for both Go and frontend)
task dev

# Production build
task build

# Run the built binary
task run

# Platform-specific builds
task windows:build
task darwin:build
task linux:build

# Headless HTTP server (no GUI)
task build:server
task run:server
```

Frontend commands (from `_cmd/egov/frontend/`):

```bash
npm run dev          # Vite dev server standalone
npm run build        # Production build → frontend/dist/
npm run build:dev    # Non-minified build
```

Regenerate Go→TypeScript bindings after changing the `API` struct:

```bash
wails3 generate bindings -f '' -clean=true
```

## Architecture

### Module Layout

The project uses **two Go modules**:

| Module | Path | Purpose |
|--------|------|---------|
| `egov` | `/` (root) | Shared library — defines the `API` struct and its methods |
| `github.com/secondarykey/egov/cmd/egov` | `_cmd/egov/` | Wails3 application entry point (`main.go`), build assets, frontend |

The command module imports the root module as a local `replace` directive in its `go.mod`.

### Go ↔ Frontend Binding Pattern

Methods on the `API` struct (`api.go`) are automatically callable from React via auto-generated TypeScript clients in `_cmd/egov/frontend/bindings/`. Adding a new backend method requires:

1. Add the method to `API` in `api.go`
2. Run `wails3 generate bindings -f '' -clean=true`
3. Import the generated function in the frontend

### Event System

Go goroutines in `_cmd/egov/main.go` emit events via `app.Event.Emit("eventName", payload)`. The frontend subscribes with `Events.On("eventName", callback)` from `@wailsio/runtime`.

### Frontend Embedding

Vite builds to `_cmd/egov/frontend/dist/`. The Go binary embeds that directory with `//go:embed frontend/dist` and serves it as the Wails3 web root. Any frontend change requires a rebuild to be picked up in a production binary; `task dev` handles this automatically via hot-reload.

### Frontend Component

`_cmd/egov/frontend/src/Player.jsx` is the orchestrator component rendered from `App.jsx` — it owns all state/refs and input handling, and delegates rendering to `src/player/`:

| File | Role |
|------|------|
| `player/useThreeScene.js` | Three.js scene setup + render-on-demand loop (rVFC), exposes refs |
| `player/TitleBar.jsx` | Title bar (drag region, mode toggle, window controls) |
| `player/ControlBar.jsx` | Bottom bar (seek, play/pause, volume, fullscreen) |
| `player/SeekBarArea.jsx` / `TimeDisplay.jsx` / `MiniProgressBar.jsx` | `memo`-isolated high-frequency updates (`timeupdate`, thumbnail hover) |
| `player/VrViewpointOverlay.jsx` | VR start-point + view sliders overlay |
| `player/Overlays.jsx` | Feedback/error/drop/empty-state overlays |
| `player/ExtractDialog.jsx` | 範囲切り出しのファイル名確認ダイアログ |
| `player/utils.js` | Shared constants (`VR_START`, `barStyle`) and helpers |

Key facts:

- **Three.js** (`r0.184`) + `OrbitControls` for rendering: a sphere (VR mode) and a plane (fit/normal mode) share one `VideoTexture`
- **MUI** for all UI controls (title bar, control bar, sliders, menus)
- Three view modes: `normal` (default, window-fit), `free` (pan/zoom), `vr` (spherical, right-click rotates) — internal names match the UI labels. Legacy `fit` in settings.json is migrated to `normal` by `Settings.normalize()`
- VR split-screen: `textureRef.current.repeat/offset` selects the left/right/top/bottom half of the video

### 範囲切り出し（無劣化カット）

`internal/mp4cut` が progressive MP4 (`moov` + `mdat`) から時間範囲をサンプル単位で
バイトコピーして切り出す。再エンコードしないためコーデック非依存
（H.264 / HEVC / AV1 いずれも可）。実装は [Eyevinn/mp4ff](https://github.com/Eyevinn/mp4ff) を使う。

処理の流れは `stts` で時刻→サンプル番号を解決 → `stss` で開始点を直前のキーフレームへ
スナップ → `stsc`/`stsz`/`stco` で入力チャンクを範囲の端で切り詰め →
`stbl` 配下のテーブルを作り直し → mdat 本体の開始位置が確定してから chunk offset を絶対値へ補正、というもの。

- **開始点は必ず sync sample にスナップされる**ため、指定より前にずれる。`ExtractResult.StartSec` に実際の値が返る
- `edts`/`elst` は元のタイムラインを指すため破棄する。`sdtp`/`sbgp`/`sgpd`/`subs`/`saio`/`saiz` も破棄する
- fragmented MP4 (`moof`) は非対応。対応拡張子は `API.CanExtract()`（`.mp4`/`.m4v`/`.mov`）が判定する
- 4GB 超の出力では mdat を largesize ヘッダ（16バイト）にし、chunk offset も `co64` にする
- 保存先は元ファイルと同じディレクトリ固定。ファイル名は UI で指定でき、既定値は
  `API.SuggestExtractName()` が `<name>_02m00s-07m00s.mp4` の形で作る（衝突時は `_2` を付ける）
- `API.ExtractRange()` は**既存ファイルへの上書きを拒否する**。ファイル名にフォルダを
  含めることもできない（`resolveExtractPath()`）

UI は既存の**範囲ループのマーカーをそのまま in/out 点として使う**。選択範囲は
`SeekBarArea` から `rangeRef`（ref）で Player へ公開する — state で持ち上げると
マーカーのドラッグ中に Player 全体が再描画されるため。
起動は右サイドパネル最上段のハサミ（範囲ループが ON のときだけ有効）で、
`player/ExtractDialog.jsx` がファイル名を確認してから実行する。
入力起因のエラー（名前の重複など）はダイアログを閉じずにその場に出し、
成功時のみ Snackbar で実際の切り出し範囲を通知する。

テスト用の `internal/mp4cut/testdata/sample.mp4` は ffmpeg で生成した合成クリップ
（320x180 / 30fps / GOP 60 = キーフレームは 0,2,4,6,8秒 / AAC）。
出力の妥当性検証に ffmpeg デコードを使うテストがあるが、ffmpeg が無い環境ではスキップされる。

### Wails3 Drag Behavior

`@wailsio/runtime/dist/drag.js` registers capture-phase listeners on `mousedown/mousemove/mouseup`. Elements with `--wails-draggable: drag` trigger window drag on left-click-move. **Do not set `--wails-draggable: drag` on the Three.js canvas/mount div** — while `dragging=true`, the library suppresses all `mousedown` events and all non-left-button events via `stopImmediatePropagation`, which breaks OrbitControls right-click. Only set `--wails-draggable: drag` on the title bar.

## Wails3 Known Patterns

### Linux (WebKitGTK) の自動再生制限

WebKitGTK はミュートしていないメディアの自動再生にユーザー操作を要求するため、
ファイルを開いた直後の `video.play()` は必ず `NotAllowedError` で拒否される。
Wails v3 alpha2.114 時点で `EnableAutoplayWithoutUserAction`（`mediaTypesRequiringUserActionForPlayback`）は
**darwin/iOS 専用**で、Linux 側の `linux_cgo.go` は
`webkit_settings_set_media_playback_requires_user_gesture` を一切呼んでいない。
Windows の WebView2 は既定で自動再生を許可するため、この問題は Linux でのみ顕在化する。

そのため **描画のきっかけを `play` イベントだけに依存してはいけない**。
`loadedmetadata` 時点は `readyState=HAVE_METADATA` でフレーム実体がまだ無く、
ここで描画しても黒画になる。最初のフレームは `loadeddata` で
`texture.needsUpdate` を立てて描画すること（`player/useThreeScene.js`）。

### Linux (WebKitGTK) の DMA-BUF による映像化け

WebKitGTK 2.40 以降はデコード済み動画フレームを DMA-BUF（YUV マルチプレーン＋
DRM format modifier）でゼロコピー転送するが、ドライバが未対応だとタイル化された
バッファをリニアな RGB として読み、**映像が砂嵐状に化ける**。
Intel Haswell 世代の Mesa が該当し、起動時に
`FINISHME: support YUV colorspace with DRM format modifiers` を出力する。

egov は VideoTexture 経由で WebGL に転送するためこの経路に強く依存する。
`webkitenv_linux.go` の `configureWebviewEnv()` で
`WEBKIT_DISABLE_DMABUF_RENDERER=1` を既定で設定して回避する
（`application.New()` より前に設定すること。Webプロセスのfork前である必要がある）。
環境変数が既に設定済みなら尊重するため、`WEBKIT_DISABLE_DMABUF_RENDERER=0` で上書き可能。

⚠️ 検証時の注意: `VAR=1` を単独行で書くと export されず子プロセスに渡らない。
`VAR=1 ./bin/egov` か `export VAR=1` を使うこと。

### ファイルのドラッグ&ドロップ

`EnableFileDrop: true` のとき、Wails はネイティブ側でドロップを横取りし、
ドロップ先の要素が `data-file-drop-target` を持つ場合に **Go 側の**
`events.Common.WindowFilesDropped` を発火させる。

⚠️ **Linux(WebKitGTK)/macOS では DOM の `drop` イベントが配送されない**ため、
フロントエンドの `e.dataTransfer.files` に依存してはいけない。
Windows でもランタイムがドロップを Go へ転送するので、
`WindowFilesDropped` に一本化するのが正しい（両方で処理すると二重読み込みになる）。

また Linux/macOS では `relatedTarget=null` の `dragleave` が即座に飛んでくるので、
ドラッグ表示のカウンタはこれを無視しないと状態が壊れる。

### 診断オーバーレイ

`Ctrl+Shift+D` で `player/DiagnosticsOverlay.jsx` を開ける（Esc で閉じる）。
HTTP取得/CORS・デコード・WebGL転送のどこで詰まっているかを
`networkState` / `readyState` / `MediaError` / 2D drawImage / 描画カウンタで判別する。
Linux では `-tags production,devtools` がビルドできない
（`webview_window_linux_production.go` が `!devtools`、`webview_window_linux_dev.go` が `!production`
で両方とも除外される）ため、プロダクションビルドでの切り分けにはこれを使う。

### Window State Save/Restore

Window position/size restoration uses a **two-phase approach**:

- **Phase 1 (before `app.Run()`)**: `NewWebviewWindowWithOptions` に保存済み座標を渡す。`ScreenNearestDipPoint` は Run() 前に nil を返すため、サイズは安全な上限でクランプのみ。`InitialPosition: application.WindowXY` を明示的に指定しないと X/Y が無視され中央配置になる。
- **Phase 2 (after `app.Run()`)**: `win.OnWindowEvent(WindowRuntimeReady)` 内で `ScreenNearestDipPoint` を使い正式なクランプを行い `SetSize`/`SetPosition` で補正。`ApplicationStarted` では `SetSize` が効かない場合がある。

終了時の保存は `API.Quit()` 経由で行う。`WindowClosing` 時点ではウィンドウ破棄が進行中のため `Position()`/`Size()` が (0,0) を返すことがある。フロントエンドの閉じるボタンは `Window.Close()` ではなく `Quit()` binding を呼ぶ。

### Frameless Window Resize Handles

`@wailsio/runtime/dist/drag.js` のリサイズハンドル判定は `window.outerWidth/outerHeight` とマウス座標の比較のみで行われ、DOM要素のマージンには依存しない。そのため Three.js canvas 等の全面要素にマージンは不要で、`100vw`/`100vh` で映像を100%表示にしてもリサイズは機能する（以前は `calc(100vw - 10px)` + `margin: 5px` としていたが撤去済み）。

### Runtime Import

`main.jsx` で `import '@wailsio/runtime'` をベア import しておくこと。個別の名前付き import（`import { Window } from '@wailsio/runtime'`）だけでは `drag.js` の副作用が有効化されない場合がある。

### Worktree / Junction

ワークツリーでは node_modules をメインリポジトリからジャンクション（Windows）でリンクする。ワークツリー側で `npm install` を実行するとジャンクションが破壊される。パッケージの追加・削除は必ずメイン側で行う。

**ワークツリーでのセッション開始時（必須）**: `_cmd/egov/frontend/node_modules` が存在しない場合、以下のコマンドでメインリポジトリからジャンクションを作成すること。ビルドや `task dev` の前に必ず実行する。

```powershell
# PowerShell で実行（cmd の mklink /J でも可）
New-Item -ItemType Junction -Path "_cmd\egov\frontend\node_modules" -Target "D:\Go\Projects\egov\_cmd\egov\frontend\node_modules"
```

同様に `frontend/dist` も存在しないとGoの `//go:embed all:frontend/dist` がビルドエラーになる。空ディレクトリを作成するか、ジャンクションを作成すること。

```powershell
# 空ディレクトリで十分（ビルド時に上書きされる）
New-Item -ItemType Directory -Path "_cmd\egov\frontend\dist" -Force
```

`build/Taskfile.yml` の `install:frontend:deps` は `status: test -d node_modules` で存在チェックに変更済み（`generates: node_modules` はViteキャッシュで誤検知し不要な npm install を走らせるため）。`wails3 update build-assets` を実行すると `build/Taskfile.yml` が上書きされるため、再修正が必要。

## Key Configuration Files

- `_cmd/egov/build/config.yml` — Wails3 app metadata and dev server settings
- `_cmd/egov/Taskfile.yml` + `_cmd/egov/build/Taskfile.yml` — all build tasks
- `_cmd/egov/frontend/vite.config.js` — Vite + Wails plugin configuration
