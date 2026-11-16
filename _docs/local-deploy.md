# ローカルデプロイ（`Taskfile.local.yml`）

手元でビルドして、普段使う場所へコピーするための個人用 Taskfile。コピー先は人や環境によって違うので
Git 管理外にし、`_cmd/egov/Taskfile.yml` から `optional: true` で include している
（無い環境では `local:` のタスクが無いだけで、他は今までどおり動く）。

## 置き方

`_cmd/egov/Taskfile.local.yml` に下の雛形をそのまま置き、`DEPLOY_DEST` の既定を自分のコピー先に書き換える。

```bash
wails3 task --list-all                               # local:deploy / local:install / local:build-info が出る
wails3 task local:deploy                             # 既定のコピー先へ
wails3 task local:deploy DEPLOY_DEST="D:/tmp/egov"   # この回だけコピー先を変える（-- 以降の引数は渡らない）
wails3 task local:install                            # ビルドしてコピーするだけ
wails3 task local:build-info                         # ビルド情報の反映だけ（版上げ・コミットはしない）
```

マイナー・メジャーは `go run _cmd/version.go -bump`（または `go run _cmd/version.go 0.8.0`）で
`version` を書き換えてから deploy する。そのタグはまだ無いので、deploy がさらに上げることはない。

## 雛形

```yaml
version: '3'

vars:
  DEPLOY_DEST: '{{.DEPLOY_DEST | default "D:/Program Files/egov"}}'
  # タグは CI（versionup.yml）が打つ。手元でも打つと同じ名前のタグが別のコミットにでき、ぶつかる
  TAG_VERSION: '{{.TAG_VERSION | default "false"}}'
  # build-info と wails3 build が書き換える Git 管理下のファイル（_cmd/egov からの相対パス）
  BUILD_INFO_FILES: >-
    version
    build/config.yml
    build/darwin/Info.plist
    build/darwin/Info.dev.plist
    build/darwin/icons.icns
    build/linux/desktop
    build/linux/nfpm/nfpm.yaml
    build/windows/info.json
    build/windows/icon.ico
    build/windows/nsis/wails_tools.nsh
    build/windows/wails.exe.manifest
    frontend/package.json
    frontend/package-lock.json

tasks:
  deploy:
    desc: Bump, build, commit build info and install locally.
    cmds:
      - task: bump-version
      - task: build-info
      - wails3 build
      - task: commit-build-info
      - task: tag-version
      - task: copy-bin

  install:
    desc: Build and install locally (no bump, no commit, no tag).
    cmds:
      - wails3 build
      - task: copy-bin

  copy-bin:
    internal: true
    preconditions:
      - sh: test -n "$(ls bin 2>/dev/null)"
        msg: "bin/ が空です（wails3 build が何も出していません）"
    cmds:
      # 起動中の exe は上書きできないので止める。未起動だと powershell が exit 1 を返すので無視する
      - cmd: powershell -Command "Get-Process {{.APP_NAME}} -ErrorAction SilentlyContinue | Stop-Process -Force"
        ignore_error: true
      - powershell -Command "New-Item -ItemType Directory -Force -Path '{{.DEPLOY_DEST}}' | Out-Null"
      - powershell -Command "Copy-Item -Path bin/* -Destination '{{.DEPLOY_DEST}}' -Recurse -Force"

  build-info:
    desc: Propagate version and app info to the build assets.
    cmds:
      - task: sync-version
      - wails3 update build-assets -name "{{.APP_NAME}}" -binaryname "{{.APP_NAME}}" -config build/config.yml -dir build
      # update build-assets は build/Taskfile.yml をテンプレートで上書きする（install:frontend:deps の
      # status などの手直しが消える）ので戻す。versionup.yml と同じ
      - git checkout -- build/Taskfile.yml

  sync-version:
    internal: true
    dir: ../..
    cmds:
      - go run _cmd/version.go

  bump-version:
    internal: true
    dir: ../..
    cmds:
      - go run _cmd/version.go -auto

  commit-build-info:
    internal: true
    cmds:
      - |
        if git diff --quiet HEAD -- {{.BUILD_INFO_FILES}}; then
          echo "build info: no changes"
        else
          git commit -m "chore: egov $(< version) のビルド情報を反映する" -m "Glory to mankind." -- {{.BUILD_INFO_FILES}}
        fi

  tag-version:
    internal: true
    cmds:
      - |
        if [ "{{.TAG_VERSION}}" != "true" ]; then
          echo "tag: skipped (TAG_VERSION={{.TAG_VERSION}}. タグは CI が打つ)"
          exit 0
        fi
        tag="v$(< version)"
        if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
          echo "tag $tag already exists at $(git rev-parse --short "$tag^{commit}")"
        else
          git tag "$tag" && echo "tagged $tag at $(git rev-parse --short HEAD)"
        fi
```

macOS / Linux では `copy-bin` の3行を `pkill -x {{.APP_NAME}} || true` / `mkdir -p "{{.DEPLOY_DEST}}"` /
`cp -R bin/* "{{.DEPLOY_DEST}}"` に置き換える。

## 流れと理由

| 段 | やること | なぜ |
|---|---|---|
| `bump-version` | `version.go -auto`: `v`+今の版のタグがあれば patch +1 | リリース済みと同じ版番号の別物を作らない |
| `build-info` | `version` → config.yml / package.json → `update build-assets` → `build/Taskfile.yml` を戻す | CI を通さないビルドでは誰も版を各 OS のアセットへ伝えない。`update build-assets` は手直しした `build/Taskfile.yml` を上書きする（`versionup.yml` も同じように戻している） |
| `wails3 build` | ビルド | `info.json` などはビルド時に exe へ焼き込まれる |
| `commit-build-info` | `BUILD_INFO_FILES` に変更があれば、それだけをコミット | 作り直したアセットを捨てるとリポジトリが exe より古くなる。`git commit -- <paths>` なので作業中の他の変更は巻き込まない |
| `tag-version` | 既定では何もしない（`TAG_VERSION=false`） | 下記 |
| `copy-bin` | 起動中の egov を止めて `bin/*` をコピー | 起動中の exe は上書きできない。未起動だと `Get-Process` が exit 1 を返すので `ignore_error` |

## CI との分担

タグは `versionup.yml` だけが打つ（手元でも打つと、同じ名前のタグが別のコミットにでき、ぶつかる）。
そのため「`v`+今の版のタグがある」は「CI がリリース済み」を意味する。

1. `version` は 0.7.2、`v0.7.2` は CI が打ち済み → deploy で 0.7.3 に上げてコミット
2. リリース前に何度 deploy しても `v0.7.3` が無いので 0.7.3 のまま
3. PR をマージ → `versionup.yml` は `v0.7.3` が無いので版を上げずに `v0.7.3` を打つ
   （ファイルの差分が無いので chore の PR は作らない）→ `release.yml` が 0.7.3 をビルド
4. `git fetch --tags` で `v0.7.3` が手元に来ると、次の deploy で 0.7.4 に上がる

`git fetch --tags` を忘れても壊れはしない（版が上がらないまま deploy されるだけ）。

## 注意

- **`wails3` CLI のバージョンを `.github/variables` の `WAILS_VERSION` に揃える。** CLI が違うと
  `update build-assets` の出力が変わる（例: v3.0.0 は `info.json` の言語キーを `0409`、beta.26 は `0000` にする）。
  そのままだと deploy のたびに CI と逆向きの差分がコミットされる
- `build-info` は `git checkout -- build/Taskfile.yml` で戻すので、`build/Taskfile.yml` のコミットしていない変更も消える。
  そのファイルを触っているときは先にコミットする
- 作業ツリーにコミットしていない変更があると、exe にはそれが入るが、ビルド情報のコミットには入らない
- 同じ版で `install` を繰り返しても版もコミットも増えない。コピーだけ失敗したときのやり直しは `install` で
- `Taskfile.yml` 側のタスクから `local:` を呼ばない（`Taskfile.local.yml` が無い環境で落ちる）
