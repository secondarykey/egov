import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, IconButton, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { fmt } from './utils'

const CAPTURE_LONG_SIDE = 320   // 取り込み時の長辺ピクセル

// Normalモードのサムネイル一覧オーバーレイ。
// gridSize=N のとき N×N 枚を並べる。動画を (N²+1) 分割した内側の N² 個の
// 時刻（0秒と末尾を除く）を専用の隠しビデオでシークしながら取り込む。
// クリックでその時刻へシークして閉じる。
export default function ThumbnailGrid({ src, duration, rotation = 0, gridSize = 4, activeColor, onSeek, onClose }) {
  const cols  = Math.max(2, Math.min(9, gridSize))
  const count = cols * cols
  const [thumbs, setThumbs] = useState(() => new Array(count).fill(null))
  const [ready, setReady]   = useState(0)

  // 取り込み対象の時刻（0秒と末尾を除いた等間隔）
  const timesRef = useRef([])
  if (timesRef.current.length === 0 && duration > 0) {
    timesRef.current = Array.from({ length: count }, (_, i) => (duration * (i + 1)) / (count + 1))
  }

  useEffect(() => {
    if (!src || !duration) return
    const times = timesRef.current
    let cancelled = false
    let idx = 0

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
        const scale = CAPTURE_LONG_SIDE / Math.max(vw, vh)
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
        const capIdx = idx
        setThumbs(prev => {
          const next = prev.slice()
          next[capIdx] = { time: times[capIdx], dataUrl }
          return next
        })
        setReady(r => r + 1)
      }
      idx++
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
  }, [src, duration, rotation, count])

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
          gap: 1,
          width: '100%', maxWidth: 1100,
          maxHeight: '100%',
        }}
      >
        {thumbs.map((thumb, i) => (
          <Box
            key={i}
            onClick={() => { if (thumb) { onSeek(thumb.time); onClose() } }}
            sx={{
              position: 'relative',
              aspectRatio: '16 / 9',
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
                sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
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
