// VR始点ごとのSBS切り出し設定（テクスチャUVの repeat / offset）
export const VR_START = {
  left:   { repeat: [0.5, 1],   offset: [0,   0  ] },
  right:  { repeat: [0.5, 1],   offset: [0.5, 0  ] },
  top:    { repeat: [1,   0.5], offset: [0,   0.5] },
  bottom: { repeat: [1,   0.5], offset: [0,   0  ] },
  // モノラル素材（360°正距円筒、変換済みの平面映像など）は切り出さない
  full:   { repeat: [1,   1  ], offset: [0,   0  ] },
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

// 描画結果の平行移動の上限（1.0 = ウィンドウの半分）。
// 透視投影は画面座標をいくら伸ばしても視線角が90°に漸近するだけなので
// 180°素材なら黒帯は出ないが、Panini/ステレオ投影は有限の画面座標で
// 素材の範囲を超える（fov75 で 300% を過ぎると画が残らない）。そこで切る。
export const VR_SHIFT_LIMIT = 3

// 表示側の垂直画角（度）の範囲。素材が 180° 級である以上 180° は
// 「設定したい値」になりうるので、そこまで届かせる。
// 透視/Panini は tan(fov/2) が 180° ちょうどで発散するが、それは
// projScaleFor() 側で潰す（ステレオ投影なら 180° は普通に使える）。
export const VR_FOV_MIN = 20
export const VR_FOV_MAX = 180

// ウィンドウ枠のリサイズ判定域内か。
// @wailsio/runtime の drag.js は window.outerWidth/outerHeight とマウス座標の
// 比較だけでリサイズ端を決める（既定 5px、角は +10px）。そこで mousedown すると
// canResize が立ち、続く mousemove で resizing に入って以降の mouseup/click は
// capture 段で stopImmediatePropagation される。
//
// つまりリサイズ開始時、こちらの mousedown は届くのに mouseup が届かない。
// 長押しの早送りオーバーレイがそこで開くと、離しても閉じず早送りが続く。
// 映像側のクリック処理はこの領域を最初から無視する。
//
// しきい値は drag.js と揃える（フラグが読めない状況では既定値にフォールバック）。
const resizeFlag = (key, fallback) => {
  try {
    const v = window._wails?.flags?.[key]
    return typeof v === 'number' && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}

export const isResizeEdge = (clientX, clientY) => {
  const hw    = resizeFlag('system.resizeHandleWidth', 5)
  const hh    = resizeFlag('system.resizeHandleHeight', 5)
  const extra = resizeFlag('resizeCornerExtra', 10)

  const right  = window.outerWidth  - clientX
  const bottom = window.outerHeight - clientY

  // 角は判定域が広い。左右いずれかの角領域かつ上下いずれかの角領域なら角。
  const inCornerX = clientX < hw + extra || right  < hw + extra
  const inCornerY = clientY < hh + extra || bottom < hh + extra
  if (inCornerX && inCornerY) return true

  return clientX < hw || right < hw || clientY < hh || bottom < hh
}

// 上下バー・サイドパネル共通の半透明スタイル
export const barStyle = {
  background:     'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(6px)',
  transition:     'opacity 0.3s ease',
  color:          'white',
}
