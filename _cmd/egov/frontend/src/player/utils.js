// VR始点ごとのSBS切り出し設定（テクスチャUVの repeat / offset）
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

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

// 上下バー・サイドパネル共通の半透明スタイル
export const barStyle = {
  background:     'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(6px)',
  transition:     'opacity 0.3s ease',
  color:          'white',
}
