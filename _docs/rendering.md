# 描画（Three.js で動画を描く、`player/useThreeScene.js`）

Three.js で `<video>` を WebGL に描くときに、egov の外でも通用する注意点をまとめる。
VR 固有の話（投影・色空間の往復・スナップショット）は [vr-projection.md](vr-projection.md)。

## 構成

- 平面モード（normal/free）は `PerspectiveCamera` ＋ plane、VRモードは専用シーンの
  フルスクリーンquad＋シェーダ。動画のときは両者が同じ `VideoTexture` を共有し、
  `renderOnce()` が `modeRef` で描画先を切り替える
- 画像・アニメーション画像のときは平面だけが別テクスチャ（`imageTexture`）を使う。
  `showVideo` / `showImage` / `showCanvas` で平面マテリアルの `map` を差し替える
- 平面の縦横比は素材に合わせる（`PlaneGeometry` は 16:9 基準）

## 小窓ズーム（`player/ZoomInset.jsx`）

normal / free モードで、映像の一部を切り抜いて拡大した小窓を主画面に重ねる。

- 主画面と**同じ `scene`（同じ `VideoTexture` の平面）を、2つ目のカメラで描き直す**だけにする。
  デコードと GPU への転送は1フレーム1回のままで、増えるのは小窓の面積ぶんの描画だけ。
  `<video>`・`VideoTexture`・`WebGLRenderer` を2つ目に作ると、デコードや転送がそのまま倍になる
- 描画は `useThreeScene` の `planePassRef` から呼ぶ（平面モードの `renderOnce()` の直後）。
  主画面と同じフレームで描くので、小窓がずれることはない
- 見た目は設定 `settings.zoomInset` で選ぶ。枠線あり（縁は透かさない）か、枠線なしで縁を透かすか。
  透かす幅は小窓の短辺に対する割合（上限は Go の `zoomFeatherMax` とダイアログのスライダーで揃える）。
  0 のときはシェーダの `smoothstep` が未定義になるので、マスクを 1 に分岐している
- 縁を透かすため、小窓はいったん小窓の大きさのレンダーターゲットへ描き、縁ほどアルファを落とす
  シェーダで主画面へ合成する（`autoClear` を切って viewport を小窓に絞る。viewport は左下原点の CSS px）。
  レンダーターゲットは sRGB にする（線形のまま 8bit に入れると暗部が潰れる）。映像の外は透明で
  クリアするので中身は乗算済みアルファになり、合成は `premultipliedAlpha` で行う。
  出力の色空間変換（`colorspace_fragment`）は乗算を外した色に掛けてから、アルファを掛け直す
- 切り抜く範囲はワールド座標（平面上の中心と高さ）で持つ。free モードで主画面を動かしても
  小窓は同じ場所を映し続ける。主画面には範囲を示す枠を出さない（要らないという判断）
- normal モードの回転は mount を CSS で回しているので、小窓の DOM は mount の子に置いて一緒に回す。
  ドラッグ量は画面座標から mount 内の座標へ直す。mount には `zIndex: 0` を付けて、
  小窓の重なり順を mount の中に閉じ込めている
- 小窓の倍率は主画面の等倍が下限（引いても主画面と同じ大きさで止まる）。基準は主カメラの
  1px あたりのワールド長で、free モードで主画面を寄せると小窓の下限もそれに合わせて上がる
- 小窓の位置と範囲は Player の ref に持つ（VR に切り替えてコンポーネントが外れても保つ）
- 小窓は画面端からはみ出させてよい（mount の `overflow: hidden` で切れる。viewport は負の位置や
  描画バッファの外へ出ても WebGL が切り取る）。見失わないよう `KEEP_VISIBLE` px は画面内に残す

## レンダーオンデマンド

常時 60fps で回す代わりに、**実フレーム到着時と操作・状態変化時だけ描画する**。
操作・リサイズなどからは `requestRender()` を呼ぶ。

- 再生中は `requestVideoFrameCallback`（rVFC）で新しいフレームが提示されたときだけ描く。
  一時停止中は描画しない
- 一時停止中のシークでも新フレームを出すため、`seeked` では常に描画を要求する
- **最初のフレームは `loadeddata` で描く。** `loadedmetadata` 時点は
  `readyState=HAVE_METADATA` でフレーム実体がまだ無く、描いても黒のまま。
  `play` イベント起点のループだけに頼ると、自動再生が拒否される環境
  （Linux の WebKitGTK）で永久に真っ黒になる
- **rVFC は「メソッドはあるがコールバックが発火しない」環境がある**（Linux の WebKitGTK）。
  three.js の `VideoTexture` も内部で rVFC を使って `needsUpdate` を立てるので、
  この場合は自前ループと three.js 側が同時に沈黙し、音と `currentTime` は進むのに画が止まる。
  存在チェックでは検出できないため、再生位置が進んでいるのにフレームが1枚も来なければ
  rAF ループへ恒久的に切り替える（誤検出しても rAF に落ちるだけで描画は正しい）
- 一時停止時は保留中の rVFC を明示的にキャンセルしてフラグを戻す。
  停止後は保留中のコールバックが二度と発火しない実装があり、フラグが立ったままだと
  再開時にループが始まらない

## テクスチャ

- **`VideoTexture` だけは sRGB の内部フォーマットにならない**（`RGBA8`）。組み込みマテリアルは
  自動で復号するが、自作シェーダでは `sRGBTransferEOTF()` で復号が要る。
  逆に `THREE.Texture`（画像）は sRGB 内部フォーマットでサンプル時点で線形化済みなので、
  同じシェーダに両方を通すと片方の色が狂う
- GPU の `maxTextureSize`（多くは 16384px）を超える画像はアップロードに失敗して黒くなるので、
  キャンバスで縮小してから渡す
- 毎フレーム描き換える canvas は、アップロードごとのミップマップ生成を切る（速度優先）

## レンダラ

- WebGL コンテキストの生成は環境によって失敗しうる（GPU アクセラレーションが無い Linux など）。
  握り潰すと「UI は出るが映像だけ真っ黒」になるので、エラーオーバーレイに出す。
  コンテキストロストも同様に通知する
- HiDPI 環境では `setPixelRatio(devicePixelRatio)` で内部バッファを確保する（にじみ対策）。
  DPI の異なるモニタへ移るとデバイスピクセル比が変わるので、リサイズのたびに反映する
- スナップショットのために `preserveDrawingBuffer` を使わない。`renderOnce()` の直後に
  同期で `drawImage` すれば描画バッファの内容は残っている
