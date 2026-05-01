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

## Key Configuration Files

- `_cmd/egov/build/config.yml` — Wails3 app metadata and dev server settings
- `_cmd/egov/Taskfile.yml` + `_cmd/egov/build/Taskfile.yml` — all build tasks
- `_cmd/egov/frontend/vite.config.js` — Vite + Wails plugin configuration
