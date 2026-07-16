import * as THREE from 'three'

// VR始点ごとのテクスチャ設定
export const VR_START = {
  left:   { repeat: [0.5, 1],   offset: [0,   0  ] },
  right:  { repeat: [0.5, 1],   offset: [0.5, 0  ] },
  top:    { repeat: [1,   0.5], offset: [0,   0.5] },
  bottom: { repeat: [1,   0.5], offset: [0,   0  ] },
}

export const fmt = (s) => {
  if (!isFinite(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export const deg2rad = (d) => (d * Math.PI) / 180
export const rad2deg = (r) => (r * 180) / Math.PI

// VR投影球の半径
export const VR_RADIUS = 500

// headGroup（首）の向きを設定する。ワールドY軸ヨー → ローカルX軸ピッチの順。
const WORLD_Y = new THREE.Vector3(0, 1, 0)
export const applyHeadRotation = (group, yaw, pitch) => {
  if (!group) return
  group.rotation.set(0, 0, 0)
  group.rotateOnWorldAxis(WORLD_Y, yaw)
  group.rotateX(pitch)
}

// 視点の平行移動。カメラではなく球体を逆方向に動かすことで
// 「自分が動く」のと等価な見え方にする（OrbitControls と干渉しない）。
// pos は球半径に対する比率 { x: 右+, y: 上+, z: 前+ }
export const applySpherePosition = (sphere, pos) => {
  if (!sphere) return
  sphere.position.set(-pos.x * VR_RADIUS, -pos.y * VR_RADIUS, pos.z * VR_RADIUS)
}

// 上下バー・サイドパネル共通の半透明スタイル
export const barStyle = {
  background:     'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(6px)',
  transition:     'opacity 0.3s ease',
  color:          'white',
}
