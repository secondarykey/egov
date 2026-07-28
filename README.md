# egov

動画プレイヤーです。
２分割画面のVR動画を見ることが可能です。

## 構成

[Wails3](https://v3.wails.io/)（Go バックエンド + React/TypeScript フロントエンド）製のデスクトップアプリです。

| パス | 内容 |
|------|------|
| `/`（ルート） | 共有ライブラリ（Go モジュール `egov`）。`API` 構造体・設定・ロケール |
| `_cmd/egov/` | アプリ本体（Wails3 エントリポイント、ビルド設定、フロントエンド） |
| `_cmd/egov/frontend/` | React + Three.js + MUI のフロントエンド |
| `_cmd/version/` | バージョン同期ツール（`version` ファイル → `config.yml` / `package.json`） |
| `_cmd/wails3check/` | wails3 CLI とモジュールのバージョン整合チェックツール |

### 開発

```bash
cd _cmd/egov
task dev      # ホットリロード付き開発
task build    # プロダクションビルド
task run      # ビルド済みバイナリの実行
```

## macOS 版の実行について

macOS 版はまだ Apple の Developer ID 署名・notarization を行っていません。
そのため GitHub Release からダウンロードすると `com.apple.quarantine` 属性が付き、
Gatekeeper に「"egov" は壊れているため開けません。ゴミ箱に入れる必要があります。」と拒否されます。

**ファイルは壊れていません。** 以下のコマンドで隔離属性を外してから起動してください。

```bash
xattr -dr com.apple.quarantine /Applications/egov.app
```

また現在の macOS 版は Apple Silicon (arm64) 専用ビルドのため、Intel Mac では動作しません。

## リリース

1. PR が `main` にマージされると [versionup.yml](.github/workflows/versionup.yml) がパッチバージョンを自動更新し、`chore: version x.y.z` の PR を作成・マージして `vx.y.z` タグを push します。
2. `v*` タグの push で [release.yml](.github/workflows/release.yml) が Windows / macOS / Linux 向けにビルドし、draft の GitHub Release にアップロードします。

バージョンを手動で変更する場合は `_cmd/egov/version` を編集後、以下で各ファイルへ同期します。

```bash
go run ./_cmd/version          # version ファイルの値で同期
go run ./_cmd/version 1.2.3    # 指定バージョンを設定
go run ./_cmd/version -bump    # 対話的に選択
```
