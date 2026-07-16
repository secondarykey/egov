import { Box, Collapse, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material'
import PlayArrowIcon      from '@mui/icons-material/PlayArrow'
import PauseIcon          from '@mui/icons-material/Pause'
import VolumeUpIcon       from '@mui/icons-material/VolumeUp'
import VolumeOffIcon      from '@mui/icons-material/VolumeOff'
import FullscreenIcon     from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import RepeatIcon         from '@mui/icons-material/Repeat'
import LinearScaleIcon    from '@mui/icons-material/LinearScale'
import { useTranslation } from 'react-i18next'
import SeekBarArea from './SeekBarArea'
import TimeDisplay from './TimeDisplay'
import { barStyle } from './utils'

// 下部コントロールバー（シークバー・再生操作・音量・ファイル名・全画面）。
export default function ControlBar({
  showUI, video, duration, paused, onPlayPause,
  muted, onMuteToggle, volume, onVolumeChange, onVolumeCommitted,
  fileName, fullscreen, onFullscreenToggle,
  loop, onLoopToggle, rangeLoop, onRangeLoopToggle, activeColor,
  thumbVideoRef, thumbCanvasRef, thumbEnabledRef, modeRef, vrStartRef,
}) {
  const { t } = useTranslation()

  return (
    <Box sx={{
      ...barStyle,
      position: 'absolute', bottom: 0, left: 0, right: 0,
      px: 2, pt: 2, pb: 1,
      opacity: showUI ? 1 : 0,
      pointerEvents: showUI ? 'auto' : 'none',
    }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <SeekBarArea
          video={video}
          thumbVideoRef={thumbVideoRef}
          thumbCanvasRef={thumbCanvasRef}
          thumbEnabledRef={thumbEnabledRef}
          modeRef={modeRef}
          vrStartRef={vrStartRef}
          duration={duration}
          activeColor={activeColor}
          rangeLoop={rangeLoop}
          visible={showUI}
        />
        <Tooltip title={loop ? t('controls.loopOn') : t('controls.loopOff')} placement="top">
          <IconButton onClick={onLoopToggle} sx={{ color: loop ? activeColor : 'rgba(255,255,255,0.3)', width: 28, height: 28 }}>
            <RepeatIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={rangeLoop ? t('controls.rangeLoopOn') : t('controls.rangeLoopOff')} placement="top">
          <IconButton onClick={onRangeLoopToggle} sx={{ color: rangeLoop ? activeColor : 'rgba(255,255,255,0.3)', width: 28, height: 28 }}>
            <LinearScaleIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Collapse in={rangeLoop}>
        <Box sx={{ mt: 0.25, height: 16 }} />
      </Collapse>
      <Stack direction="row" sx={{ alignItems: 'center', mt: 1 }} spacing={1}>
        <IconButton onClick={onPlayPause} sx={{ color: 'white', width: 36, height: 36 }}>
          {paused ? <PlayArrowIcon sx={{ fontSize: 28 }} /> : <PauseIcon sx={{ fontSize: 28 }} />}
        </IconButton>
        <TimeDisplay video={video} duration={duration} visible={showUI} />
        <IconButton onClick={onMuteToggle} sx={{ color: muted ? 'rgba(255,255,255,0.3)' : 'white', width: 28, height: 28, ml: '20px !important' }}>
          {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
        </IconButton>
        <Slider
          size="small"
          min={0} max={1} step={0.01}
          value={volume}
          onChange={onVolumeChange}
          onChangeCommitted={onVolumeCommitted}
          valueLabelDisplay="auto"
          valueLabelFormat={v => `${Math.round(v * 100)}%`}
          sx={{
            color: muted ? 'rgba(255,255,255,0.3)' : 'white', width: 160, py: '10px', mr: '20px !important',
            '& .MuiSlider-track': { height: 9, border: 'none' },
            '& .MuiSlider-rail':  { height: 9 },
            '& .MuiSlider-thumb': { width: 16, height: 16 },
          }}
        />
        <Typography noWrap sx={{
          flex: 1, fontSize: '1.2rem', lineHeight: 1,
          color: 'rgba(255,255,255,0.6)',
          userSelect: 'none', ml: '20px', minWidth: 0,
        }}>
          {fileName}
        </Typography>
        <Tooltip title={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')} placement="top">
          <IconButton onClick={onFullscreenToggle} sx={{ color: 'white', width: 28, height: 28 }}>
            {fullscreen
              ? <FullscreenExitIcon fontSize="small" />
              : <FullscreenIcon    fontSize="small" />
            }
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}
