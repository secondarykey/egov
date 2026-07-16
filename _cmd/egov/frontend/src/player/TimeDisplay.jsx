import { memo, useEffect, useState } from 'react'
import { Typography } from '@mui/material'
import { fmt } from './utils'

// 再生位置表示。timeupdate（約4回/秒）による再レンダーを
// このコンポーネント内に閉じ込め、Player 全体の再レンダーを避ける。
const TimeDisplay = memo(function TimeDisplay({ video, duration, visible }) {
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!video || !visible) return
    setTime(video.currentTime)
    const onTimeUpdate = () => setTime(video.currentTime)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [video, visible])
  return (
    <Typography sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', minWidth: 90, fontSize: '0.95rem' }}>
      {fmt(time)} / {fmt(duration)}
    </Typography>
  )
})

export default TimeDisplay
