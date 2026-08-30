import * as THREE from 'three'

// VR描画は球メッシュ＋PerspectiveCamera ではなく、フルスクリーンquad＋
// フラグメントシェーダで行う。ピクセルごとに
//   画面座標 → 視線ベクトル → 頭の回転 → ソース画像のUV
// を直接解くため、以下が同時に手に入る。
//
//  - 球メッシュのUV線形補間による歪みが原理的に発生しない
//    （旧実装は 60x40 分割で、FOVを絞ると1マスが画面の1/4を占めていた）
//  - ソース側の投影方式（正距円筒 / 魚眼）を切り替えられる
//    未変換のデュアル魚眼素材を正距円筒として貼ると、中央は合うのに
//    首を振ると周辺が伸び縮みする——これが「視点が合わない」の主因
//  - ソースの画角を実レンズに合わせられる（180°決め打ちをやめる）
//    撮影機は 190°/200° が多く、180°として貼ると首振り角と画がずれる
//  - 表示側の投影方式を選べる。透視投影は原理的に画面端が引き伸ばされ、
//    HMDならレンズが打ち消すが平面モニタでは歪みとして残る

export const SOURCE_PROJECTIONS  = ['equirect', 'equidistant', 'equisolid']
export const DISPLAY_PROJECTIONS = ['rectilinear', 'panini', 'stereographic']

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = `
varying vec2 vUv;

uniform sampler2D uMap;
uniform vec2  uSrcOffset;    // SBS切り出しのオフセット
uniform vec2  uSrcRepeat;    // SBS切り出しのスケール
uniform float uSrcAspect;    // 切り出し後の 幅/高さ（魚眼を真円に保つ補正）
uniform float uSrcHalfFov;   // ソースの半画角（ラジアン）
uniform int   uSrcProj;      // 0:正距円筒 1:等距離魚眼 2:等立体角魚眼
uniform int   uDispProj;     // 0:透視 1:Panini 2:ステレオ投影
uniform float uAspect;       // 画面の 幅/高さ
uniform vec2  uShift;        // 描画結果の平行移動（1.0 = 画面の半分）
uniform float uProjScale;    // 表示投影ごとの画面スケール（projScaleFor で算出）
uniform mat3  uRot;          // yaw/pitch/roll

// 画面座標 → カメラ座標系の視線ベクトル（前方 -Z）
vec3 screenToDir(vec2 p) {
  vec2 s = p * uProjScale;

  // ステレオ投影: 画面半径 r = 2 tan(θ/2)。広い画角でも局所的な形が保たれる。
  if (uDispProj == 2) {
    float r = length(s);
    if (r < 1e-6) return vec3(0.0, 0.0, -1.0);
    float th = 2.0 * atan(r * 0.5);
    return vec3(sin(th) * s / r, -cos(th));
  }

  // Panini (d=1): 水平はステレオ投影的、垂直は円筒。直線の垂直が保たれる。
  //   x = (d+1) sinα / (d + cosα) を α について解いた逆変換。
  if (uDispProj == 1) {
    const float d = 1.0;
    float k  = s.x / (d + 1.0);
    float a  = atan(k) + asin(clamp(k * d * inversesqrt(1.0 + k * k), -1.0, 1.0));
    float sc = (d + 1.0) / (d + cos(a));
    return normalize(vec3(sin(a), s.y / sc, -cos(a)));
  }

  // 透視投影（従来と同じ）
  return normalize(vec3(s, -1.0));
}

// 視線ベクトル → ソース画像のUV。z成分は範囲内なら1.0、範囲外なら0.0。
vec3 dirToUv(vec3 dir) {
  // 正距円筒: 経度・緯度がそれぞれ線形にマップされる
  if (uSrcProj == 0) {
    float lon = atan(dir.x, -dir.z);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2(0.5) + vec2(lon, lat) / (2.0 * uSrcHalfFov);
    float ok = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.0 : 1.0;
    return vec3(uv, ok);
  }

  // 魚眼: 前方軸からの角度 θ を像高（半径）へマップする
  float th = acos(clamp(-dir.z, -1.0, 1.0));
  float r  = (uSrcProj == 1)
    ? th / uSrcHalfFov                            // 等距離射影 r ∝ θ
    : sin(0.5 * th) / sin(0.5 * uSrcHalfFov);     // 等立体角射影 r ∝ sin(θ/2)
  if (r > 1.0) return vec3(0.0, 0.0, 0.0);        // イメージサークルの外

  float rho = length(dir.xy);
  vec2  u2  = rho > 1e-6 ? dir.xy / rho : vec2(0.0);
  vec2  c   = u2 * (r * 0.5);
  c.x /= uSrcAspect;                              // 切り出しが正方でなくても真円を保つ
  vec2 uv = vec2(0.5) + c;
  float ok = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.0 : 1.0;
  return vec3(uv, ok);
}

void main() {
  // 平行移動はアスペクト補正の前に引く。こうすると X/Y とも
  // 「1.0 = ウィンドウの半分」で単位が揃う。
  vec2 p = (vUv - 0.5) * 2.0 - uShift;
  p.x *= uAspect;

  vec3 hit = dirToUv(uRot * screenToDir(p));
  if (hit.z < 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = texture2D(uMap, uSrcOffset + hit.xy * uSrcRepeat);

  // three.js は VideoTexture に限って sRGB の内部フォーマットを使わない
  // （WebGLTextures.js の getInternalFormat に forceLinearTransfer =
  //  texture.isVideoTexture が渡るため RGBA8 になる）。サンプル結果は
  // sRGB のままなので、組み込みマテリアルの DECODE_VIDEO_TEXTURE と同じく
  // シェーダ内で明示的にリニアへ復号する。これを省くと出力側の再符号化と
  // あわせて sRGB が二重にかかり、画が白っぽく浮く。
  gl_FragColor = sRGBTransferEOTF(gl_FragColor);
  #include <colorspace_fragment>
}
`

// VR描画用のシーン一式を作る。平面モード用のシーン／カメラとは独立させ、
// renderer.render() の引数を切り替えて使う。
export function createVrQuad(texture) {
  const uniforms = {
    uMap:        { value: texture },
    uSrcOffset:  { value: new THREE.Vector2(0, 0) },
    uSrcRepeat:  { value: new THREE.Vector2(1, 1) },
    uSrcAspect:  { value: 1 },
    uSrcHalfFov: { value: Math.PI / 2 },
    uSrcProj:    { value: 0 },
    uDispProj:   { value: 0 },
    uAspect:     { value: 1 },
    uShift:      { value: new THREE.Vector2(0, 0) },
    uProjScale:  { value: Math.tan((75 * Math.PI) / 360) },
    uRot:        { value: new THREE.Matrix3() },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:   VERT,
    fragmentShader: FRAG,
    depthTest:      false,
    depthWrite:     false,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false        // clip空間へ直接書くのでカリング判定は無意味

  const scene = new THREE.Scene()
  scene.add(mesh)

  return { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh, material, uniforms }
}

// 画面上端／下端で視線角がちょうど halfFov になる画面スケール。
export function projScaleFor(displayProjection, halfFovRad) {
  return displayProjection === 'stereographic'
    ? 2 * Math.tan(halfFovRad / 2)
    : Math.tan(halfFovRad)
}

const _euler = new THREE.Euler()
const _mat4  = new THREE.Matrix4()

// 頭の向き。ワールドYヨー → ローカルXピッチ → 視線軸ロール の順で合成する。
export function setVrRotation(matrix3, yaw, pitch, roll) {
  _euler.set(pitch, yaw, roll, 'YXZ')
  _mat4.makeRotationFromEuler(_euler)
  matrix3.setFromMatrix4(_mat4)
}

export const srcProjIndex  = (name) => Math.max(0, SOURCE_PROJECTIONS.indexOf(name))
export const dispProjIndex = (name) => Math.max(0, DISPLAY_PROJECTIONS.indexOf(name))
