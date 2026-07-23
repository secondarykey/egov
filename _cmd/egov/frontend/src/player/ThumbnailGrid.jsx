import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, IconButton, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { fmt } from './utils'

// グリッドが占める最大の表示領域（ビューポート比）
const AREA_W = 0.9
const AREA_H = 0.88

// Normalモードのサムネイル一覧オーバーレイ。
// gridSize=N のとき N×N 枚を並べる。動画を (N²+1) 分割した内側の N² 個の
// 時刻（0秒と末尾を除く）を専用の隠しビデオでシークしながら取り込む。
// グリッドはウィンドウと動画のアスペクト比に合わせて拡縮し、取り込み解像度も
// 実際の表示セルサイズ（×devicePixelRatio）に合わせる。
// クリックでその時刻へシークして閉じる。
export default function ThumbnailGrid({ src, duration, rotation = 0, gridSize = 4, aspect = 16 / 9, activeColor, initialThumbs, onSeek, onClose, onComplete }) {
  const cols  = Math.max(2, Math.min(9, gridSize))
  const count = cols * cols
  // 表示上のグリッド幅（px）とセル寸法。取り込み解像度の決定にも使う。
  const gridW = Math.min(window.innerWidth * AREA_W, window.innerHeight * AREA_H * aspect)
  // 同一動画・分割数・回転のキャッシュが渡っていれば再生成せずそのまま使う
  const cached = !!initialThumbs && initialThumbs.length === count && initialThumbs.every(Boolean)
  const [thumbs, setThumbs] = useState(() => cached ? initialThumbs : new Array(count).fill(null))
  const [ready, setReady]   = useState(() => cached ? count : 0)

  // 取り込み対象の時刻（0秒と末尾を除いた等間隔）
  const timesRef = useRef([])
  if (timesRef.current.length === 0 && duration > 0) {
    timesRef.current = Array.from({ length: count }, (_, i) => (duration * (i + 1)) / (count + 1))
  }

  useEffect(() => {
    if (!src || !duration || cached) return
    const times = timesRef.current
    let cancelled = false
    let idx = 0
    const results = new Array(count).fill(null)

    // 実際に表示されるセルの長辺（px）× dpr を取り込み目標の長辺にする。
    // 元動画の解像度は上限（拡大はしない）。
    const dpr      = window.devicePixelRatio || 1
    const cellW    = gridW / cols
    const cellH    = cellW / aspect
    const wantLong = Math.max(160, Math.ceil(Math.max(cellW, cellH) * dpr))

    const v = document.createElement('video')
    v.src = src
    v.muted = true
    v.crossOrigin = 'anonymous'
    v.preload = 'auto'

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    const seekNext = () => {
      if (cancelled || idx >= count) return
      v.currentTime = times[idx]
    }

    const onSeeked = () => {
      if (cancelled) return
      const vw = v.videoWidth
      const vh = v.videoHeight
      if (vw && vh) {
        const scale = Math.min(1, wantLong / Math.max(vw, vh))
        const sw = Math.max(1, Math.round(vw * scale))
        const sh = Math.max(1, Math.round(vh * scale))
        const rotated = rotation % 180 !== 0
        canvas.width  = rotated ? sh : sw
        canvas.height = rotated ? sw : sh
        ctx.save()
        if (rotation) {
          ctx.translate(canvas.width / 2, canvas.height / 2)
          ctx.rotate((rotation * Math.PI) / 180)
          ctx.drawImage(v, -sw / 2, -sh / 2, sw, sh)
        } else {
          ctx.drawImage(v, 0, 0, sw, sh)
        }
        ctx.restore()
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        results[idx] = { time: times[idx], dataUrl }
        setThumbs(results.slice())
        setReady(r => r + 1)
      }
      idx++
      if (idx >= count) {
        // 全枚数そろったらキャッシュへ渡す（欠けがある場合はキャッシュしない）
        if (results.every(Boolean)) onComplete?.(results)
        return
      }
      seekNext()
    }

    const onLoaded = () => seekNext()

    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('seeked', onSeeked)

    return () => {
      cancelled = true
      v.removeEventListener('loadeddata', onLoaded)
      v.removeEventListener('seeked', onSeeked)
      v.removeAttribute('src')
      v.load()
    }
  }, [src, duration, rotation, count, gridW, aspect])

  return (
    <Box
      onClick={onClose}
      sx={{
        position: 'absolute', inset: 0, zIndex: 20,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        bgcolor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
        p: 3,
      }}
    >
      <IconButton
        onClick={onClose}
        sx={{ position: 'absolute', top: 12, right: 12, color: 'white' }}
      >
        <CloseIcon />
      </IconButton>

      {ready < count && (
        <Box sx={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 1, color: 'rgba(255,255,255,0.8)',
        }}>
          <CircularProgress size={16} sx={{ color: activeColor }} />
          <Typography variant="caption">{ready}/{count}</Typography>
        </Box>
      )}

      <Box
        onClick={e => e.stopPropagation()}
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${cols}, 1fr)`,
          gap: 0.5,
          // ウィンドウと動画アスペクト比に合わせて拡縮する（リサイズにも追従）
          width: `min(${AREA_W * 100}vw, calc(${AREA_H * 100}vh * ${aspect}))`,
          aspectRatio: String(aspect),
        }}
      >
        {thumbs.map((thumb, i) => (
          <Box
            key={i}
            onClick={() => { if (thumb) { onSeek(thumb.time); onClose() } }}
            sx={{
              position: 'relative',
              minWidth: 0, minHeight: 0,
              bgcolor: 'rgba(255,255,255,0.06)',
              borderRadius: 1,
              overflow: 'hidden',
              cursor: thumb ? 'pointer' : 'default',
              border: '2px solid transparent',
              transition: 'border-color 0.15s',
              '&:hover': thumb ? { borderColor: activeColor } : {},
            }}
          >
            {thumb ? (
              <Box
                component="img"
                src={thumb.dataUrl}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress size={20} sx={{ color: 'rgba(255,255,255,0.3)' }} />
              </Box>
            )}
            <Typography sx={{
              position: 'absolute', bottom: 4, right: 4,
              px: 0.5, borderRadius: 0.5,
              bgcolor: 'rgba(0,0,0,0.7)', color: 'white',
              fontSize: '0.7rem', fontFamily: 'monospace', lineHeight: 1.4,
              pointerEvents: 'none',
            }}>
              {fmt(thumb ? thumb.time : timesRef.current[i] ?? 0)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
