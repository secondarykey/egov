import { memo, useEffect, useRef, useState } from 'react'
import { Box, Slider, Typography } from '@mui/material'
import { VR_START, fmt } from './utils'

// シークバー＋サムネイルプレビュー＋範囲ループ。
// ホバー中のサムネイル更新（mousemove 毎）と再生位置の追従という
// 高頻度 state 更新を Player 全体から切り離す。
const SeekBarArea = memo(function SeekBarArea({
  video, thumbVideoRef, thumbCanvasRef, thumbEnabledRef,
  modeRef, vrStartRef, duration, activeColor, rangeLoop, visible, rangeRef,
}) {
  const [currentTime, setCurrentTime] = useState(0)
  const [thumbInfo,   setThumbInfo]   = useState(null)
  const [rangePoint1, setRangePoint1] = useState(null)
  const [rangePoint2, setRangePoint2] = useState(null)
  const seekBarRef     = useRef(null)
  const seekDragging   = useRef(false)
  const thumbSeekTimer = useRef(null)
  // 範囲マーカーのピック（フォーカス）中フラグ。ピック中はホバーより
  // マーカー位置のサムネイル表示を優先する。
  const markerPickedRef = useRef(false)

  // 範囲ループの on/off に応じて範囲を初期化・解除する
  useEffect(() => {
    if (rangeLoop) {
      if (duration > 0) {
        setRangePoint1(p => p ?? 0)
        setRangePoint2(p => p ?? duration)
      }
    } else {
      setRangePoint1(null)
      setRangePoint2(null)
      // ピック中にオフにされるとマーカーごと消え blur が発火しないため後始末
      markerPickedRef.current = false
      setThumbInfo(null)
    }
  }, [rangeLoop, duration])

  // 選択範囲を Player 側へ ref で公開する（切り出し機能が参照する）。
  // state で持ち上げるとマーカーのドラッグ中に Player 全体が再描画されるため ref を使う。
  useEffect(() => {
    if (!rangeRef) return
    if (!rangeLoop || rangePoint1 === null || rangePoint2 === null) {
      rangeRef.current = null
      return
    }
    rangeRef.current = {
      start: Math.min(rangePoint1, rangePoint2),
      end:   Math.max(rangePoint1, rangePoint2),
    }
  }, [rangeRef, rangeLoop, rangePoint1, rangePoint2])

  // 再生位置の追従と範囲ループの実施。
  // 非表示中は state 更新を省略するが、範囲ループの巻き戻しは常に行う。
  useEffect(() => {
    if (!video) return
    const onTimeUpdate = () => {
      if (rangeLoop && rangePoint1 !== null && rangePoint2 !== null) {
        const start = Math.min(rangePoint1, rangePoint2)
        const end   = Math.max(rangePoint1, rangePoint2)
        if (video.currentTime >= end) video.currentTime = start
      }
      if (!visible || seekDragging.current) return
      setCurrentTime(video.currentTime)
    }
    // 表示された瞬間に省略していた更新を取り戻す
    if (visible && !seekDragging.current) setCurrentTime(video.currentTime)
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [video, visible, rangeLoop, rangePoint1, rangePoint2])

  // サムネイル取得: thumbVideoがseekされたらcanvasに描画してdataUrlを更新
  useEffect(() => {
    const thumbVideo = thumbVideoRef.current
    const canvas     = thumbCanvasRef.current
    if (!thumbVideo || !canvas) return
    const onSeeked = () => {
      const vw = thumbVideo.videoWidth
      const vh = thumbVideo.videoHeight
      const ctx = canvas.getContext('2d')

      let srcX = 0, srcY = 0, srcW = vw, srcH = vh
      if (modeRef.current === 'vr' && vw && vh) {
        const { repeat, offset } = VR_START[vrStartRef.current]
        srcX = offset[0] * vw
        srcW = repeat[0] * vw
        // Three.js UV の Y は下起点なので反転
        srcY = (1 - offset[1] - repeat[1]) * vh
        srcH = repeat[1] * vh
      }

      // アスペクト比を維持して long-side = 160 に収める
      const srcAspect = srcW / srcH
      const dstW = srcAspect >= 1 ? 160 : Math.round(160 * srcAspect)
      const dstH = srcAspect >= 1 ? Math.round(160 / srcAspect) : 160
      canvas.width  = dstW
      canvas.height = dstH
      ctx.drawImage(thumbVideo, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      setThumbInfo(prev => prev ? { ...prev, dataUrl, w: dstW, h: dstH } : null)
    }
    thumbVideo.addEventListener('seeked', onSeeked)
    return () => thumbVideo.removeEventListener('seeked', onSeeked)
  }, [])

  // 指定位置（px）と秒数でサムネイルを表示し、遅延付きでプレビュー動画をシークする
  const showThumbAt = (localX, time) => {
    setThumbInfo(prev => ({ localX, time, dataUrl: prev?.dataUrl ?? null, w: prev?.w ?? 160, h: prev?.h ?? 90 }))
    clearTimeout(thumbSeekTimer.current)
    thumbSeekTimer.current = setTimeout(() => {
      if (thumbVideoRef.current) thumbVideoRef.current.currentTime = time
    }, 80)
  }

  // マーカーの秒数位置にサムネイルを表示する（ピック中・キー移動時）
  const showThumbAtTime = (time) => {
    const bar = seekBarRef.current
    if (!bar || !duration || !thumbEnabledRef.current) return
    showThumbAt((time / duration) * bar.getBoundingClientRect().width, time)
  }

  const handleSeekBarMouseMove = (e) => {
    if (markerPickedRef.current) return
    if (!seekBarRef.current || !duration || !thumbEnabledRef.current) return
    const rect   = seekBarRef.current.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const ratio  = Math.max(0, Math.min(1, localX / rect.width))
    showThumbAt(localX, ratio * duration)
  }

  const handleSeekBarMouseLeave = () => {
    if (markerPickedRef.current) return
    clearTimeout(thumbSeekTimer.current)
    setThumbInfo(null)
  }

  // マーカー移動時に再生位置が範囲より前に取り残されないよう追従させる
  const clampCurrentTimeToRange = (newTime, otherPoint) => {
    if (otherPoint === null) return
    const rangeStart = Math.min(newTime, otherPoint)
    if (video && video.currentTime < rangeStart) video.currentTime = rangeStart
  }

  // ピック（クリック）で選択状態＝フォーカスにし、←/→ で1秒ずつ微調整する。
  // stopPropagation で Player 側のコマ送り/シークのキー操作を抑止する。
  const handleMarkerKeyDown = (setPoint, point, otherPoint, e) => {
    if (e.key === 'Escape') { e.currentTarget.blur(); return }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    if (!duration) return
    const delta   = e.key === 'ArrowRight' ? 1 : -1
    const newTime = Math.max(0, Math.min(duration, point + delta))
    setPoint(newTime)
    clampCurrentTimeToRange(newTime, otherPoint)
    showThumbAtTime(newTime)
  }

  const handleMarkerPointerDown = (setPoint, otherPoint, e) => {
    e.preventDefault()
    e.stopPropagation()
    // preventDefault でフォーカスが当たらないため明示的に当てる
    e.currentTarget.focus()
    const bar = seekBarRef.current
    if (!bar || !duration) return
    const onMove = (me) => {
      const rect    = bar.getBoundingClientRect()
      const ratio   = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
      const newTime = ratio * duration
      setPoint(newTime)
      clampCurrentTimeToRange(newTime, otherPoint)
      // ドラッグ中はマーカー位置（＝マウス位置）にサムネイルを追従させる
      showThumbAtTime(newTime)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
      // ピック状態は続くのでサムネイルは消さず、保留中のシークも完了させる
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
  }

  return (
    <Box
      ref={seekBarRef}
      sx={{ position: 'relative', flex: 1, height: 28, display: 'flex', alignItems: 'center' }}
      onMouseMove={handleSeekBarMouseMove}
      onMouseLeave={handleSeekBarMouseLeave}
    >
      {rangeLoop && rangePoint1 !== null && rangePoint2 !== null && duration > 0 && (
        <Box sx={{
          position: 'absolute', pointerEvents: 'none', zIndex: 1,
          left: `${(Math.min(rangePoint1, rangePoint2) / duration) * 100}%`,
          width: `${(Math.abs(rangePoint2 - rangePoint1) / duration) * 100}%`,
          top: '50%', transform: 'translateY(-50%)',
          height: 26, bgcolor: `${activeColor}50`, borderRadius: 0.5,
        }} />
      )}
      {rangeLoop && duration > 0 && [
        { point: rangePoint1, setPoint: setRangePoint1 },
        { point: rangePoint2, setPoint: setRangePoint2 },
      ].map(({ point, setPoint }, i) => {
        if (point === null) return null
        const other  = i === 0 ? rangePoint2 : rangePoint1
        const isLeft = other === null || point <= other
        return (
          <Box
            key={i}
            tabIndex={-1}
            sx={{
              position: 'absolute', zIndex: 3, cursor: 'ew-resize',
              left: `${(point / duration) * 100}%`,
              top: 0, height: 'calc(100% + 20px)', width: 16,
              transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              outline: 'none',
              // 選択中（フォーカス中）は白いグローで示す
              '&:focus': { filter: 'drop-shadow(0 0 3px #fff)' },
            }}
            onPointerDown={(e) => handleMarkerPointerDown(setPoint, other, e)}
            onKeyDown={(e) => handleMarkerKeyDown(setPoint, point, other, e)}
            onFocus={() => { markerPickedRef.current = true; showThumbAtTime(point) }}
            onBlur={() => {
              markerPickedRef.current = false
              clearTimeout(thumbSeekTimer.current)
              setThumbInfo(null)
            }}
          >
            <Box sx={{ flex: 1, width: 2, bgcolor: activeColor }} />
            <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0 }}>
              <Box sx={{
                width: '100%', height: '100%',
                bgcolor: activeColor,
                clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
              }} />
              <Typography sx={{
                position: 'absolute', bottom: 0, pointerEvents: 'none',
                ...(isLeft ? { right: '100%', pr: '4px' } : { left: '100%', pl: '4px' }),
                fontSize: '0.65rem', color: activeColor, fontFamily: 'monospace',
                whiteSpace: 'nowrap', userSelect: 'none', lineHeight: 1,
              }}>
                {fmt(point)}
              </Typography>
            </Box>
          </Box>
        )
      })}
      {thumbInfo?.dataUrl && (
        <Box sx={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: `clamp(${thumbInfo.w / 2}px, ${thumbInfo.localX}px, calc(100% - ${thumbInfo.w / 2}px))`,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          bgcolor: 'rgba(0,0,0,0.85)',
          borderRadius: 1,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}>
          <Box component="img" src={thumbInfo.dataUrl}
            sx={{ width: thumbInfo.w, height: thumbInfo.h, display: 'block' }} />
          <Typography variant="caption" sx={{
            display: 'block', textAlign: 'center',
            color: 'rgba(255,255,255,0.9)', py: 0.25, fontFamily: 'monospace',
          }}>
            {fmt(thumbInfo.time)}
          </Typography>
        </Box>
      )}
      <Slider
        size="small"
        min={0} max={duration || 0} step={0.1}
        value={currentTime}
        onMouseDown={() => { seekDragging.current = true }}
        onChange={(_, v) => setCurrentTime(v)}
        onChangeCommitted={(_, v) => {
          let target = v
          if (rangeLoop && rangePoint1 !== null && rangePoint2 !== null) {
            const start = Math.min(rangePoint1, rangePoint2)
            if (v < start) target = start
          }
          if (video) video.currentTime = target
          seekDragging.current = false
        }}
        sx={{
          py: 0,
          // track 右端は三角に接するため角丸なし。三角の底辺は 2px 左へ伸ばして
          // track に重ね、% 位置のサブピクセル丸め差による隙間を防ぐ。
          '& .MuiSlider-track': { height: 26, border: 'none', bgcolor: activeColor, borderRadius: '2px 0 0 2px' },
          '& .MuiSlider-rail':  { height: 26, bgcolor: 'rgba(255,255,255,0.25)', borderRadius: 0.5 },
          '& .MuiSlider-thumb': {
            // rail(高さ26)を覆える最小限の高さにして右側の rail(灰)を隠し、
            // はみ出しは控えめに。底辺は track 右端(=再生位置)へ 3px 重ね、
            // バーと一体の矢印に見せる。
            width: 26, height: 28, bgcolor: activeColor,
            borderRadius: 0,
            clipPath: 'polygon(calc(50% - 3px) 0, 100% 50%, calc(50% - 3px) 100%)',
            '&:hover, &.Mui-focusVisible': { boxShadow: 'none' },
            '&::before': { boxShadow: 'none' },
          },
        }}
      />
    </Box>
  )
})

export default SeekBarArea
