import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, Popover, Tooltip, Typography } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTranslation } from 'react-i18next'
import { barStyle } from './utils'

// 時:分:秒。1時間未満でも尺の桁が揃うよう 0:00:00 形式で出す。
const fmtDuration = (s) => {
  if (!isFinite(s) || s < 0) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a)

// 16:9 のような整数比。約分しても大きい数になる変則サイズでは小数比を返す。
const aspectRatio = (w, h) => {
  if (!w || !h) return '—'
  const g = gcd(w, h)
  const rw = w / g
  const rh = h / g
  const dec = `${(w / h).toFixed(2)}:1`
  return rw <= 50 && rh <= 50 ? `${rw}:${rh} (${dec})` : dec
}

// 実測フレームレートを見慣れた値へ寄せる。計測値は 29.9703… のように端数が出る。
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 72, 90, 100, 119.88, 120]
const fmtFps = (fps) => {
  if (!fps) return '—'
  // 許容差内で「最も近い」ものを選ぶ。最初に見つかったものにすると
  // 24 と 23.976 はどちらも許容差内なので、ちょうど 24 でも 23.98 と出てしまう
  const near = COMMON_FPS
    .filter(c => Math.abs(c - fps) < c * 0.005)
    .sort((a, b) => Math.abs(a - fps) - Math.abs(b - fps))[0]
  if (near) return `${near.toFixed(Number.isInteger(near) ? 0 : 2)} fps`
  // 候補外（GIF に多い 10 / 12.5 fps など）は小数2桁まで、末尾の 0 は落とす
  return `${Number(fps.toFixed(2))} fps`
}

// フレームレートは video 要素からは読めないので requestVideoFrameCallback の
// mediaTime / presentedFrames の差分から実測する。再生中しか進まないため、
// 一時停止のまま開いた場合は前回の計測値（無ければ '—'）のままになる。
function useMeasuredFps(video, active) {
  const [fps, setFps] = useState(0)
  const baseRef = useRef(null)

  useEffect(() => {
    if (!video || !active || typeof video.requestVideoFrameCallback !== 'function') return
    let handle = null
    let cancelled = false

    baseRef.current = null
    const onFrame = (_now, meta) => {
      const base = baseRef.current
      const dt = base ? meta.mediaTime - base.time : 0
      const df = base ? meta.presentedFrames - base.frames : 0
      // シークや逆再生で mediaTime が戻ったら基準を取り直す
      if (!base || dt < 0) {
        baseRef.current = { time: meta.mediaTime, frames: meta.presentedFrames }
      } else if (dt >= 0.5 && df > 0) {
        setFps(df / dt)
      }
      if (!cancelled) handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)

    return () => {
      cancelled = true
      if (handle !== null) video.cancelVideoFrameCallback(handle)
    }
  }, [video, active])

  return fps
}

// 動画情報のポップオーバー（下部バーのインフォメーションボタン）。
export default function VideoInfoPanel({ video, duration, fileName, filePath }) {
  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = useState(null)
  const open = Boolean(anchorEl) && !!fileName
  const fps = useMeasuredFps(video, open)

  const width  = video?.videoWidth  ?? 0
  const height = video?.videoHeight ?? 0

  // アニメーション画像（AnimPlayer）はコマごとに表示時間を持ち、一定の FPS が無い。
  // フレーム数は分かっているので、実測ではなく「フレーム数 ÷ 長さ」の平均を出す。
  const frameCount = video?.frameCount ?? 0
  const fpsRows = frameCount && duration > 0
    ? [[t('info.frameCount'), frameCount.toLocaleString()],
       [t('info.frameRate'),  t('info.averageFps', { fps: fmtFps(frameCount / duration) })]]
    : [[t('info.frameRate'),  fmtFps(fps)]]

  const rows = [
    [t('info.fileName'),   fileName || '—'],
    // ドロップで開いたファイルはローカルパスが取れないので、その場合は行ごと出さない
    ...(filePath ? [[t('info.path'), filePath]] : []),
    [t('info.resolution'), width && height ? `${width} × ${height}` : '—'],
    [t('info.aspect'),     aspectRatio(width, height)],
    [t('info.duration'),   fmtDuration(duration)],
    ...fpsRows,
  ]

  return (
    <>
      <Tooltip title={t('info.title')} placement="top">
        <IconButton
          onClick={e => setAnchorEl(anchorEl ? null : e.currentTarget)}
          sx={{ color: open ? 'white' : 'rgba(255,255,255,0.3)', width: 28, height: 28 }}
        >
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top',    horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{
          paper: {
            sx: {
              ...barStyle,
              backgroundImage: 'none',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 2,
              px: 2, py: 1.5,
              maxWidth: '60vw',
            },
          },
        }}
      >
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          columnGap: 2, rowGap: 0.75,
          alignItems: 'baseline',
        }}>
          {rows.map(([label, value]) => (
            <Box key={label} sx={{ display: 'contents' }}>
              <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>
                {label}
              </Typography>
              <Typography sx={{ fontSize: '0.9rem', wordBreak: 'break-all' }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  )
}
