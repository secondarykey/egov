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

`_cmd/egov/frontend/src/Player.jsx` is the entire UI — one large component rendered from `App.jsx`. It uses:

- **Three.js** (`r0.184`) + `OrbitControls` for rendering: a sphere (VR mode) and a plane (fit/normal mode) share one `VideoTexture`
- **MUI** for all UI controls (title bar, control bar, sliders, menus)
- Three view modes: `fit` (default, window-fit), `normal` (free pan/zoom), `vr` (spherical, right-click rotates)
- VR split-screen: `textureRef.current.repeat/offset` selects the left/right/top/bottom half of the video

### Wails3 Drag Behavior

`@wailsio/runtime/dist/drag.js` registers capture-phase listeners on `mousedown/mousemove/mouseup`. Elements with `--wails-draggable: drag` trigger window drag on left-click-move. **Do not set `--wails-draggable: drag` on the Three.js canvas/mount div** — while `dragging=true`, the library suppresses all `mousedown` events and all non-left-button events via `stopImmediatePropagation`, which breaks OrbitControls right-click. Only set `--wails-draggable: drag` on the title bar.

## Wails3 Known Patterns

### Window State Save/Restore

Window position/size restoration uses a **two-phase approach**:

- **Phase 1 (before `app.Run()`)**: `NewWebviewWindowWithOptions` に保存済み座標を渡す。`ScreenNearestDipPoint` は Run() 前に nil を返すため、サイズは安全な上限でクランプのみ。`InitialPosition: application.WindowXY` を明示的に指定しないと X/Y が無視され中央配置になる。
- **Phase 2 (after `app.Run()`)**: `OnApplicationEvent(ApplicationStarted)` 内で `ScreenNearestDipPoint` を使い正式なクランプを行い `SetSize`/`SetPosition` で補正。

終了時の保存は `API.Quit()` 経由で行う。`WindowClosing` 時点ではウィンドウ破棄が進行中のため `Position()`/`Size()` が (0,0) を返すことがある。フロントエンドの閉じるボタンは `Window.Close()` ではなく `Quit()` binding を呼ぶ。

### Frameless Window Resize Handles

Frameless ウィンドウではコンテンツがウィンドウ端に密着するとリサイズハンドル（5px）が塞がれる。Three.js canvas のような全面要素は `calc(100vw - 10px)` × `calc(100vh - 10px)` + `margin: 5px` でリサイズ領域を確保すること。

### Runtime Import

`main.jsx` で `import '@wailsio/runtime'` をベア import しておくこと。個別の名前付き import（`import { Window } from '@wailsio/runtime'`）だけでは `drag.js` の副作用が有効化されない場合がある。

### Worktree / Junction

ワークツリーでは node_modules をメインリポジトリからジャンクション（Windows）でリンクする。ワークツリー側で `npm install` を実行するとジャンクションが破壊される。パッケージの追加・削除は必ずメイン側で行う。

`build/Taskfile.yml` の `install:frontend:deps` は `status: test -d node_modules` で存在チェックに変更済み（`generates: node_modules` はViteキャッシュで誤検知し不要な npm install を走らせるため）。`wails3 update build-assets` を実行すると `build/Taskfile.yml` が上書きされるため、再修正が必要。

## Key Configuration Files

- `_cmd/egov/build/config.yml` — Wails3 app metadata and dev server settings
- `_cmd/egov/Taskfile.yml` + `_cmd/egov/build/Taskfile.yml` — all build tasks
- `_cmd/egov/frontend/vite.config.js` — Vite + Wails plugin configuration
