import { Box, Stack, Typography } from '@mui/material'
import PlayArrowIcon     from '@mui/icons-material/PlayArrow'
import PauseIcon         from '@mui/icons-material/Pause'
import FastForwardIcon   from '@mui/icons-material/FastForward'
import FastRewindIcon    from '@mui/icons-material/FastRewind'
import ReportProblemIcon from '@mui/icons-material/ReportProblem'
import VideoFileIcon     from '@mui/icons-material/VideoFile'
import ArrowForwardIcon  from '@mui/icons-material/ArrowForward'
import MonitorIcon       from '@mui/icons-material/Monitor'
import { useTranslation } from 'react-i18next'

// シーク実行時の +Ns / -Ns フィードバック表示。
// feedback: { forward, seconds, key, overlayPos } — key の変化でアニメーションが再スタートする。
export function SeekFeedback({ feedback, onDone }) {
  const nearOverlay = !!feedback.overlayPos
  const ox = nearOverlay ? Math.max(100, Math.min(window.innerWidth - 100, feedback.overlayPos.x)) : 0
  const oy = nearOverlay ? feedback.overlayPos.y : 0
  return (
    <Box
      key={feedback.key}
      sx={{
        position: 'absolute',
        ...(nearOverlay
          ? { left: ox, top: oy - 52, transform: 'translate(-50%, -50%)' }
          : { top: '50%', ...(feedback.forward ? { right: '15%' } : { left: '15%' }) }
        ),
        pointerEvents: 'none', zIndex: 21,
        '@keyframes seekFade': {
          '0%':   { opacity: 0.9, transform: `${nearOverlay ? 'translate(-50%,-50%)' : 'translateY(-50%)'} scale(1)` },
          '30%':  { opacity: 0.9, transform: `${nearOverlay ? 'translate(-50%,-50%)' : 'translateY(-50%)'} scale(1)` },
          '100%': { opacity: 0,   transform: `${nearOverlay ? 'translate(-50%,-50%)' : 'translateY(-50%)'} scale(1.2)` },
        },
        animation: 'seekFade 0.5s ease-out forwards',
      }}
      onAnimationEnd={onDone}
    >
      <Box sx={{
        bgcolor: 'rgba(0,0,0,0.55)', borderRadius: 1.5, px: 1, py: 0.5,
        display: 'flex', alignItems: 'center', gap: 0.5,
      }}>
        {feedback.forward ? (
          <>
            <FastForwardIcon sx={{ fontSize: 18, color: 'white' }} />
            <Typography sx={{ color: 'white', fontSize: 14, fontWeight: 'bold', lineHeight: 1 }}>
              {`+${feedback.seconds}s`}
            </Typography>
          </>
        ) : (
          <>
            <Typography sx={{ color: 'white', fontSize: 14, fontWeight: 'bold', lineHeight: 1 }}>
              {`-${feedback.seconds}s`}
            </Typography>
            <FastRewindIcon sx={{ fontSize: 18, color: 'white' }} />
          </>
        )}
      </Box>
    </Box>
  )
}

// 長押しシークのゾーンコントローラー表示。
// overlay: { x, y }、active: { seconds, forward } | null
export function SeekZoneOverlay({ overlay, active, activeColor, fastSeekSecs, doubleClickSeekSecs }) {
  const zones = [
    { label: '<<<', sub: `${fastSeekSecs}s`,        seconds: fastSeekSecs,        forward: false },
    { label: '<<',  sub: `${doubleClickSeekSecs}s`, seconds: doubleClickSeekSecs, forward: false },
    { label: '·',   sub: '',                        seconds: 0, forward: false },
    { label: '>>',  sub: `${doubleClickSeekSecs}s`, seconds: doubleClickSeekSecs, forward: true },
    { label: '>>>',  sub: `${fastSeekSecs}s`,       seconds: fastSeekSecs,        forward: true },
  ]
  return (
    <Box sx={{
      position: 'absolute',
      left: Math.max(140, Math.min(window.innerWidth - 140, overlay.x)),
      top: overlay.y,
      transform: 'translate(-50%, -50%)',
      zIndex: 20, pointerEvents: 'none',
      display: 'flex', alignItems: 'stretch',
      background: 'rgba(0,0,0,0.3)',
      backdropFilter: 'blur(4px)',
      borderRadius: 2, overflow: 'hidden',
      userSelect: 'none',
      '@keyframes seekOverlayFadeIn': {
        '0%':   { opacity: 0, transform: 'translate(-50%, -50%) scale(0.9)' },
        '100%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
      },
      animation: 'seekOverlayFadeIn 0.2s ease-out forwards',
    }}>
      {zones.map(({ label, sub, seconds, forward }, i) => {
        const isActive = seconds === 0
          ? !active
          : active?.seconds === seconds && active?.forward === forward
        return (
          <Box key={i} sx={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            px: 2, py: 1, minWidth: 64,
            bgcolor: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
            borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
            transition: 'background 0.1s',
          }}>
            <Typography sx={{
              color: isActive ? activeColor : 'rgba(255,255,255,0.4)',
              fontSize: isActive ? 20 : 16,
              fontWeight: isActive ? 'bold' : 'normal',
              fontFamily: 'monospace', lineHeight: 1.2,
              transition: 'all 0.1s',
            }}>{label}</Typography>
            {sub && (
              <Typography sx={{
                color: isActive ? activeColor : 'rgba(255,255,255,0.3)',
                fontSize: 10, fontFamily: 'monospace', lineHeight: 1,
              }}>{sub}</Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// クリックによる再生/一時停止のフィードバック表示。
// feedback: { type: 'play' | 'pause', key }
export function ClickFeedback({ feedback, onDone }) {
  return (
    <Box
      key={feedback.key}
      sx={{
        position: 'absolute', top: '50%', left: '50%',
        pointerEvents: 'none', zIndex: 20,
        '@keyframes clickFade': {
          '0%':   { opacity: 0.85, transform: 'translate(-50%, -50%) scale(1)' },
          '30%':  { opacity: 0.85, transform: 'translate(-50%, -50%) scale(1)' },
          '100%': { opacity: 0,    transform: 'translate(-50%, -50%) scale(1.5)' },
        },
        animation: 'clickFade 0.6s ease-out forwards',
      }}
      onAnimationEnd={onDone}
    >
      <Box sx={{
        bgcolor: 'rgba(0,0,0,0.45)', borderRadius: '50%',
        width: 96, height: 96,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {feedback.type === 'play'
          ? <PlayArrowIcon sx={{ fontSize: 64, color: 'white' }} />
          : <PauseIcon     sx={{ fontSize: 64, color: 'white' }} />
        }
      </Box>
    </Box>
  )
}

// 動画読み込みエラー表示。error はエラーコード文字列。
export function VideoErrorOverlay({ error }) {
  const { t } = useTranslation()
  return (
    <Box sx={{
      position: 'absolute', inset: 0, zIndex: 15,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 1,
      pointerEvents: 'none',
    }}>
      <ReportProblemIcon sx={{ fontSize: 64, color: 'rgba(255,80,80,0.8)' }} />
      <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: 16 }}>
        {t('error.videoLoad')}
      </Typography>
      <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
        {error}
      </Typography>
    </Box>
  )
}

// ファイル未選択時のプレースホルダ。クリックでファイル選択を開く（label 経由）。
export function EmptyState({ resizeCursor }) {
  return (
    <Box
      component="label"
      htmlFor="file-input"
      sx={{
        position: 'absolute', inset: 0, zIndex: 5,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 1.5,
        color: 'rgba(255,255,255,0.25)',
        transition: 'color 0.2s',
        '&:hover': { color: 'rgba(255,255,255,0.55)' },
        // 画面端付近（Wails3のリサイズ判定領域）ではリサイズカーソルを優先表示
        cursor: resizeCursor || 'pointer',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <VideoFileIcon sx={{ fontSize: 64 }} />
        <ArrowForwardIcon sx={{ fontSize: 64 }} />
        <MonitorIcon sx={{ fontSize: 64 }} />
      </Stack>
    </Box>
  )
}

// ドラッグ&ドロップ中のヒント表示。
export function DropHint() {
  const { t } = useTranslation()
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      border: '3px dashed rgba(255,255,255,0.7)',
      color: 'white', fontSize: 28, pointerEvents: 'none',
    }}>
      {t('drop')}
    </div>
  )
}
