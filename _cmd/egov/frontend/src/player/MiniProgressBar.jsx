import { memo, useEffect, useState } from 'react'
import { Box } from '@mui/material'

// UI非表示時のミニプログレスバー。表示中のみマウントされる前提。
const MiniProgressBar = memo(function MiniProgressBar({ video, duration, activeColor }) {
  const [time, setTime] = useState(() => video?.currentTime ?? 0)
  useEffect(() => {
    if (!video) return
    setTime(video.currentTime)
    const onTimeUpdate = () => setTime(video.currentTime)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [video])
  return (
    <Box sx={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      height: 3, zIndex: 5, pointerEvents: 'none',
    }}>
      <Box sx={{
        height: '100%',
        width: `${duration ? (time / duration) * 100 : 0}%`,
        bgcolor: activeColor,
        opacity: 0.7,
      }} />
    </Box>
  )
})

export default MiniProgressBar
