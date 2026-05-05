import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  Box, Button, IconButton, Menu, MenuItem, Slider, Stack,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import ArrowUpwardIcon    from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon  from '@mui/icons-material/ArrowDownward'
import ArrowBackIcon      from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon   from '@mui/icons-material/ArrowForward'
import PlayArrowIcon      from '@mui/icons-material/PlayArrow'
import PauseIcon          from '@mui/icons-material/Pause'
import VolumeUpIcon       from '@mui/icons-material/VolumeUp'
import VolumeOffIcon      from '@mui/icons-material/VolumeOff'
import FolderOpenIcon     from '@mui/icons-material/FolderOpen'
import MenuIcon           from '@mui/icons-material/Menu'
import MinimizeIcon       from '@mui/icons-material/Minimize'
import CropSquareIcon     from '@mui/icons-material/CropSquare'
import CloseIcon          from '@mui/icons-material/Close'
import GridViewIcon       from '@mui/icons-material/GridView'
import VrpanoIcon         from '@mui/icons-material/Vrpano'
import OndemandVideoIcon  from '@mui/icons-material/OndemandVideo'
import OpenWithIcon       from '@mui/icons-material/OpenWith'
import RestartAltIcon     from '@mui/icons-material/RestartAlt'
import FitScreenIcon      from '@mui/icons-material/FitScreen'
import VideoFileIcon      from '@mui/icons-material/VideoFile'
import MonitorIcon        from '@mui/icons-material/Monitor'
import CameraAltIcon      from '@mui/icons-material/CameraAlt'
import FullscreenIcon     from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import FastForwardIcon    from '@mui/icons-material/FastForward'
import FastRewindIcon     from '@mui/icons-material/FastRewind'
import PushPinIcon        from '@mui/icons-material/PushPin'
import SettingsIcon       from '@mui/icons-material/Settings'
import { Events, Window } from '@wailsio/runtime'
import { GetInitialFile, GetServerURL, GetSettings, UpdateAlwaysOnTop, UpdatePlaybackSettings } from '../bindings/egov/api'
import { useTranslation } from 'react-i18next'
import { loadLanguages } from './languages'
import SettingsDialog from './SettingsDialog'

// VR始点ごとのテクスチャ設定
const VR_START = {
  left:   { repeat: [0.5, 1],   offset: [0,   0  ] },
  right:  { repeat: [0.5, 1],   offset: [0.5, 0  ] },
  top:    { repeat: [1,   0.5], offset: [0,   0.5] },
  bottom: { repeat: [1,   0.5], offset: [0,   0  ] },
}

export default function Player() {
  const { t } = useTranslation()
  const mountRef     = useRef(null)
  const videoRef     = useRef(null)
  const cameraRef    = useRef(null)
  const controlsRef  = useRef(null)
  const sphereRef    = useRef(null)
  const planeRef     = useRef(null)
  const textureRef   = useRef(null)
  const fitCameraRef = useRef(null)
  const modeRef      = useRef('fit')
  const seekDragging = useRef(false)
  const dragCounter  = useRef(0)
  const hideTimer    = useRef(null)
  const thumbVideoRef   = useRef(null)
  const thumbCanvasRef  = useRef(null)
  const seekBarRef      = useRef(null)
  const thumbSeekTimer  = useRef(null)
  const thumbEnabledRef = useRef(true)
  const vrStartRef      = useRef('left')
  const vrOffsetsRef    = useRef({ left: { x: 0, y: 0, z: 0.1 }, right: { x: 0, y: 0, z: 0.1 }, top: { x: 0, y: 0, z: 0.1 }, bottom: { x: 0, y: 0, z: 0.1 } })
  const headGroupRef    = useRef(null)
  const rendererRef     = useRef(null)
  const feedbackKeyRef      = useRef(0)
  const clickTimerRef       = useRef(null)
  const clickCountRef       = useRef(0)
  const lastClickXRef       = useRef(0)
  const seekFeedbackKeyRef  = useRef(0)
  const justFocusedRef      = useRef(false)
  const focusTimerRef       = useRef(null)

  const [paused,      setPaused]      = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [volume,      setVolume]      = useState(0.5)
  const [muted,       setMuted]       = useState(false)
  const [fileName,    setFileName]    = useState('')
  const [dragging,    setDragging]    = useState(false)
  const [showUI,      setShowUI]      = useState(false)
  const [mode,        setMode]        = useState('fit')
  const [vrStart,     setVrStart]     = useState('left')
  const [startOpen,   setStartOpen]   = useState(false)
  const [menuAnchor,  setMenuAnchor]  = useState(null)
  const [thumbInfo,    setThumbInfo]    = useState(null)
  const [clickFeedback, setClickFeedback] = useState(null)
  const [seekFeedback,  setSeekFeedback]  = useState(null)
  const [thumbEnabled, setThumbEnabled] = useState(true)
  const [language,     setLanguage]     = useState('en')
  const [vrOffsets,      setVrOffsets]      = useState({ left: { x: 0, y: 0, z: 0.1 }, right: { x: 0, y: 0, z: 0.1 }, top: { x: 0, y: 0, z: 0.1 }, bottom: { x: 0, y: 0, z: 0.1 } })
  const [availableLangs, setAvailableLangs] = useState([])
  const [serverUrl,      setServerUrl]      = useState('')
  const [settingsOpen,   setSettingsOpen]   = useState(false)
  const [activeColor,    setActiveColor]    = useState('#4fc3f7')
  const [alwaysOnTop,    setAlwaysOnTop]    = useState(false)
  const [fullscreen,     setFullscreen]     = useState(false)

  // Three.js セットアップ
  useEffect(() => {
    document.body.style.margin   = '0'
    document.body.style.overflow = 'hidden'

    const mount = mountRef.current
    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000)
    camera.position.set(0, 0, 0.1)
    cameraRef.current = camera

    const headGroup = new THREE.Group()
    headGroup.add(camera)
    scene.add(headGroup)
    headGroupRef.current = headGroup

    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const video = document.createElement('video')
    video.loop        = true
    video.muted       = false
    video.crossOrigin = 'anonymous'
    video.volume      = 0.5
    videoRef.current  = video

    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace
    textureRef.current = texture

    // VR: 半球内側
    const sGeo = new THREE.SphereGeometry(500, 60, 40, 0, Math.PI)
    sGeo.scale(-1, 1, 1)
    const sphere = new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({ map: texture }))
    sphere.rotation.y = -Math.PI / 2
    sphereRef.current  = sphere
    scene.add(sphere)

    // 通常/フィット: 平面
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 9),
      new THREE.MeshBasicMaterial({ map: texture }),
    )
    plane.visible    = false
    planeRef.current = plane
    scene.add(plane)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan    = false
    controls.enableZoom   = false
    controlsRef.current   = controls

    const fitCamera = () => {
      const videoAspect  = (16 * plane.scale.x) / 9
      const screenAspect = mount.clientWidth / mount.clientHeight
      const halfFovTan   = Math.tan((camera.fov * Math.PI / 180) / 2)
      const fitZ         = (4.5 / halfFovTan) * Math.max(1, videoAspect / screenAspect)
      camera.position.set(0, 0, fitZ)
      controls.target.set(0, 0, 0)
      controls.update()
    }
    fitCameraRef.current = fitCamera

    const onWheel = (e) => {
      if (modeRef.current !== 'vr') return
      e.preventDefault()
      camera.fov = Math.max(20, Math.min(100, camera.fov + e.deltaY * 0.05))
      camera.updateProjectionMatrix()
    }
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      if (modeRef.current === 'fit') fitCamera()
    }
    window.addEventListener('resize', onResize)

    video.addEventListener('loadedmetadata', () => {
      setDuration(video.duration)
      if (video.videoWidth && video.videoHeight) {
        const aspect = video.videoWidth / video.videoHeight
        plane.scale.set(aspect / (16 / 9), 1, 1)
        if (modeRef.current === 'fit') fitCamera()
      }
    })
    video.addEventListener('timeupdate', () => {
      if (!seekDragging.current) setCurrentTime(video.currentTime)
    })

    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('wheel', onWheel)
      controls.dispose()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      video.src = ''
    }
  }, [])

  // カメラ・コントロール切替
  useEffect(() => {
    modeRef.current = mode
    if (!sphereRef.current || !planeRef.current || !cameraRef.current || !controlsRef.current || !headGroupRef.current) return

    const camera    = cameraRef.current
    const controls  = controlsRef.current
    const headGroup = headGroupRef.current

    sphereRef.current.visible = mode === 'vr'
    planeRef.current.visible  = mode !== 'vr'

    if (mode === 'vr') {
      const off = vrOffsetsRef.current[vrStart] ?? { x: 0, y: 0 }
      camera.position.set(off.x, off.y, off.z ?? 0.1)
      headGroup.rotation.set(0, 0, 0)
      camera.fov     = 75
      controls.enabled = false
      camera.updateProjectionMatrix()
    } else if (mode === 'normal') {
      headGroup.rotation.set(0, 0, 0)
      camera.position.set(0, 0, 9)
      camera.fov            = 60
      controls.enabled      = true
      controls.enableRotate = false
      controls.enableZoom   = true
      controls.enablePan    = true
      controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()
    } else {
      headGroup.rotation.set(0, 0, 0)
      camera.fov            = 60
      controls.enabled      = true
      controls.enableRotate = false
      controls.enableZoom   = false
      controls.enablePan    = false
      camera.updateProjectionMatrix()
      fitCameraRef.current?.()
    }
  }, [mode, vrStart])

  // テクスチャ切替（モードまたはVR始点変更時）
  useEffect(() => {
    vrStartRef.current = vrStart
    if (!textureRef.current) return
    if (mode === 'vr') {
      const { repeat, offset } = VR_START[vrStart]
      textureRef.current.repeat.set(...repeat)
      textureRef.current.offset.set(...offset)
    } else {
      textureRef.current.repeat.set(1, 1)
      textureRef.current.offset.set(0, 0)
    }
    textureRef.current.needsUpdate = true
  }, [mode, vrStart])

  // VRモード: 右クリックドラッグでheadGroupを回転（首振り）
  useEffect(() => {
    if (mode !== 'vr') return
    const canvas = mountRef.current?.querySelector('canvas')
    if (!canvas) return

    let startX = 0, startY = 0, active = false
    let yaw = 0, pitch = 0
    const sensitivity = 0.004
    const worldY = new THREE.Vector3(0, 1, 0)

    const applyRotation = () => {
      const group = headGroupRef.current
      if (!group) return
      group.rotation.set(0, 0, 0)
      group.rotateOnWorldAxis(worldY, yaw)
      group.rotateX(pitch)
    }

    const onPointerDown = (e) => {
      if (e.button !== 2) return
      startX = e.clientX; startY = e.clientY; active = true
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    const onPointerMove = (e) => {
      if (!active) return
      yaw   -= (e.clientX - startX) * sensitivity
      pitch  = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - (e.clientY - startY) * sensitivity))
      startX = e.clientX; startY = e.clientY
      applyRotation()
    }
    const onPointerUp = () => { active = false }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [mode])

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

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('video/')) return
    const video = videoRef.current
    const url   = URL.createObjectURL(file)
    video.src = url
    if (thumbEnabledRef.current && thumbVideoRef.current) thumbVideoRef.current.src = url
    video.play()
    setPaused(false)
    setFileName(file.name)
  }

  const loadFilePath = (fileUrl) => {
    if (!fileUrl) return
    const video = videoRef.current
    video.src = fileUrl
    if (thumbEnabledRef.current && thumbVideoRef.current) thumbVideoRef.current.src = fileUrl
    video.play()
    setPaused(false)
    const filePath = new URL(fileUrl).searchParams.get('path') ?? ''
    setFileName(filePath.split(/[\\/]/).pop())
  }

  useEffect(() => {
    Promise.all([GetServerURL(), GetSettings()]).then(([url, s]) => {
      const p = s.playback
      setVolume(p.volume)
      setMuted(p.muted)
      setThumbEnabled(p.thumbnailEnabled)
      thumbEnabledRef.current = p.thumbnailEnabled
      setLanguage(p.language)
      setActiveColor(p.activeColor || '#4fc3f7')
      setAlwaysOnTop(s.app?.alwaysOnTop ?? false)
      setServerUrl(url)
      if (videoRef.current) {
        videoRef.current.volume = p.volume
        videoRef.current.muted  = p.muted
      }
      loadLanguages(url, p.language).then(langs => setAvailableLangs(langs))
    })
    GetInitialFile().then(loadFilePath)

    const unsub = Events.On('open-file', (event) => loadFilePath(event.data))
    return () => unsub()
  }, [])

  useEffect(() => {
    const onFocus = () => {
      justFocusedRef.current = true
      clearTimeout(focusTimerRef.current)
      // Alt+Tab などキーボードでフォーカスした場合は短時間でリセット
      focusTimerRef.current = setTimeout(() => { justFocusedRef.current = false }, 500)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const handleFileChange = (e) => loadFile(e.target.files[0])

  const handleDragEnter = (e) => { e.preventDefault(); dragCounter.current++; setDragging(true) }
  const handleDragLeave = (e) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setDragging(false)
  }
  const handleDragOver = (e) => e.preventDefault()
  const handleDrop = (e) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    loadFile(e.dataTransfer.files[0])
  }

  const handleMouseMove = (e) => {
    const inZone = e.clientY <= 80 || e.clientY >= window.innerHeight - 160 || e.clientX >= window.innerWidth - 80
    if (inZone) {
      clearTimeout(hideTimer.current)
      setShowUI(true)
    } else if (showUI) {
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setShowUI(false), 1500)
    }
  }

  const handleMouseLeave = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setShowUI(false), 800)
  }

  const handleSeekBarMouseMove = (e) => {
    if (!seekBarRef.current || !duration || !thumbEnabledRef.current) return
    const rect   = seekBarRef.current.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const ratio  = Math.max(0, Math.min(1, localX / rect.width))
    const time   = ratio * duration
    setThumbInfo(prev => ({ localX, time, dataUrl: prev?.dataUrl ?? null, w: prev?.w ?? 160, h: prev?.h ?? 90 }))
    clearTimeout(thumbSeekTimer.current)
    thumbSeekTimer.current = setTimeout(() => {
      if (thumbVideoRef.current) thumbVideoRef.current.currentTime = time
    }, 80)
  }

  const handleSeekBarMouseLeave = () => {
    clearTimeout(thumbSeekTimer.current)
    setThumbInfo(null)
  }

  const handlePlayPause = () => {
    const video = videoRef.current
    if (!video.src) return
    if (video.paused) { video.play(); setPaused(false) }
    else              { video.pause(); setPaused(true) }
  }

  const handleVolumeChange = (_, v) => {
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
    UpdatePlaybackSettings(v, muted, thumbEnabledRef.current, language)
  }

  const handleReset = () => {
    const camera   = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return

    if (mode === 'vr') {
      if (headGroupRef.current) headGroupRef.current.rotation.set(0, 0, 0)
      camera.fov = 75
      camera.updateProjectionMatrix()
    } else if (mode === 'fit') {
      const video = videoRef.current
      if (video?.videoWidth && video?.videoHeight) {
        Window.SetSize(video.videoWidth, video.videoHeight)
      }
    } else {
      camera.position.set(0, 0, 9)
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()
    }
  }

  const handleCanvasClick = (e) => {
    if (justFocusedRef.current) {
      justFocusedRef.current = false
      clearTimeout(focusTimerRef.current)
      return
    }
    const video = videoRef.current
    if (!video?.src) return
    clickCountRef.current++
    lastClickXRef.current = e.clientX
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    const willPlay = video.paused
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      const count = clickCountRef.current
      clickCountRef.current = 0
      const forward = lastClickXRef.current > window.innerWidth / 2
      if (count === 1) {
        handlePlayPause()
        feedbackKeyRef.current++
        setClickFeedback({ type: willPlay ? 'play' : 'pause', key: feedbackKeyRef.current })
      } else {
        const seconds = count === 2 ? 10 : 60
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (forward ? seconds : -seconds)))
        setCurrentTime(video.currentTime)
        seekFeedbackKeyRef.current++
        setSeekFeedback({ forward, seconds, key: seekFeedbackKeyRef.current })
      }
    }, 300)
  }

  const handleSnapshot = () => {
    const canvas = rendererRef.current?.domElement
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `egov_${Date.now()}.png`
    a.click()
  }

  const handleFullscreenToggle = () => {
    if (fullscreen) {
      Window.UnFullscreen()
    } else {
      Window.Fullscreen()
    }
    setFullscreen(f => !f)
  }

  const handleMuteToggle = () => {
    const next = !muted
    setMuted(next)
    if (videoRef.current) videoRef.current.muted = next
    UpdatePlaybackSettings(volume, next, thumbEnabledRef.current, language)
  }

  const handleLanguageChange = (lang) => {
    setLanguage(lang)
    loadLanguages(serverUrl, lang).then(langs => setAvailableLangs(langs))
    UpdatePlaybackSettings(volume, muted, thumbEnabledRef.current, lang)
  }

  const handleActiveColorChange = (color) => {
    setActiveColor(color)
  }

  const fmt = (s) => {
    if (!isFinite(s)) return '0:00'
    const m   = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const barStyle = {
    background:     'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(6px)',
    transition:     'opacity 0.3s ease',
    color:          'white',
  }

  // 始点選択オーバーレイ内のボタン定義（コンパス配置）
  const startButtons = [
    { value: 'top',    Icon: ArrowUpwardIcon,   col: 2, row: 1 },
    { value: 'left',   Icon: ArrowBackIcon,     col: 1, row: 2 },
    { value: 'right',  Icon: ArrowForwardIcon,  col: 3, row: 2 },
    { value: 'bottom', Icon: ArrowDownwardIcon, col: 2, row: 3 },
  ]

  return (
    <div
      data-file-drop-target
      style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        ref={mountRef}
        style={{ width: '100%', height: '100%' }}
        onClick={handleCanvasClick}
        onContextMenu={e => e.preventDefault()}
      />

      {seekFeedback && (
        <Box
          key={seekFeedback.key}
          sx={{
            position: 'absolute', top: '50%',
            ...(seekFeedback.forward ? { right: '15%' } : { left: '15%' }),
            pointerEvents: 'none', zIndex: 20,
            '@keyframes seekFade': {
              '0%':   { opacity: 0.9, transform: 'translateY(-50%) scale(1)' },
              '30%':  { opacity: 0.9, transform: 'translateY(-50%) scale(1)' },
              '100%': { opacity: 0,   transform: 'translateY(-50%) scale(1.3)' },
            },
            animation: 'seekFade 0.6s ease-out forwards',
          }}
          onAnimationEnd={() => setSeekFeedback(null)}
        >
          <Box sx={{
            bgcolor: 'rgba(0,0,0,0.45)', borderRadius: 2, px: 2, py: 1,
            display: 'flex', alignItems: 'center', gap: 1,
          }}>
            {seekFeedback.forward ? (
              <>
                <FastForwardIcon sx={{ fontSize: 32, color: 'white' }} />
                <Typography sx={{ color: 'white', fontSize: 28, fontWeight: 'bold', lineHeight: 1 }}>
                  {`+${seekFeedback.seconds}s`}
                </Typography>
              </>
            ) : (
              <>
                <Typography sx={{ color: 'white', fontSize: 28, fontWeight: 'bold', lineHeight: 1 }}>
                  {`-${seekFeedback.seconds}s`}
                </Typography>
                <FastRewindIcon sx={{ fontSize: 32, color: 'white' }} />
              </>
            )}
          </Box>
        </Box>
      )}

      {clickFeedback && (
        <Box
          key={clickFeedback.key}
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
          onAnimationEnd={() => setClickFeedback(null)}
        >
          <Box sx={{
            bgcolor: 'rgba(0,0,0,0.45)', borderRadius: '50%',
            width: 96, height: 96,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {clickFeedback.type === 'play'
              ? <PlayArrowIcon sx={{ fontSize: 64, color: 'white' }} />
              : <PauseIcon     sx={{ fontSize: 64, color: 'white' }} />
            }
          </Box>
        </Box>
      )}

      {!fileName && (
        <Box
          component="label"
          htmlFor="file-input"
          sx={{
            position: 'absolute', inset: 0, zIndex: 5,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', gap: 1.5,
            color: 'rgba(255,255,255,0.25)',
            transition: 'color 0.2s',
            '&:hover': { color: 'rgba(255,255,255,0.55)' },
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <VideoFileIcon sx={{ fontSize: 64 }} />
            <ArrowForwardIcon sx={{ fontSize: 64 }} />
            <MonitorIcon sx={{ fontSize: 64 }} />
          </Stack>
        </Box>
      )}

      {dragging && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
          border: '3px dashed rgba(255,255,255,0.7)',
          color: 'white', fontSize: 28, pointerEvents: 'none',
        }}>
          {t('drop')}
        </div>
      )}

      <input id="file-input" type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
      <video ref={thumbVideoRef} muted preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
      <canvas ref={thumbCanvasRef} style={{ display: 'none' }} />

      {/* VR始点選択オーバーレイ */}
      {startOpen && (
        <Box
          sx={{
            position: 'absolute', inset: 0, zIndex: 50,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(6px)',
          }}
          onClick={() => setStartOpen(false)}
        >
          <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)', letterSpacing: 4 }}>
            {t('vr.selectViewpoint')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 110px)',
              gridTemplateRows: 'repeat(3, 110px)',
              gap: 1.5,
            }}
            onClick={e => e.stopPropagation()}
          >
            {startButtons.map(({ value, Icon, col, row }) => (
              <Button
                key={value}
                onClick={() => setVrStart(value)}
                sx={{
                  gridColumn: col, gridRow: row,
                  width: '100%', height: '100%',
                  color: vrStart === value ? '#000' : 'white',
                  bgcolor: vrStart === value ? '#4fc3f7' : 'rgba(255,255,255,0.08)',
                  border: '1px solid',
                  borderColor: vrStart === value ? '#4fc3f7' : 'rgba(255,255,255,0.25)',
                  borderRadius: 2,
                  '&:hover': {
                    bgcolor: vrStart === value ? '#81d4fa' : 'rgba(255,255,255,0.18)',
                  },
                }}
              >
                <Icon sx={{ fontSize: 40 }} />
              </Button>
            ))}
          </Box>
          <Box
            sx={{ width: 340, mt: 2 }}
            onClick={e => e.stopPropagation()}
          >
            {[{ axis: 'x', label: t('vr.xOffset') }, { axis: 'y', label: t('vr.yOffset') }, { axis: 'z', label: t('vr.zOffset') }].map(({ axis, label }) => (
              <Box key={axis} sx={{ mb: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                    {label}
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography variant="caption" sx={{ color: 'white', fontFamily: 'monospace' }}>
                      {(vrOffsets[vrStart]?.[axis] ?? 0).toFixed(3)}
                    </Typography>
                    <Tooltip title={t('vr.resetToZero')} placement="top">
                      <IconButton
                        size="small"
                        sx={{ color: 'rgba(255,255,255,0.4)', width: 18, height: 18, '&:hover': { color: 'white' } }}
                        onClick={() => {
                          const next = { ...vrOffsets, [vrStart]: { ...vrOffsets[vrStart], [axis]: 0 } }
                          setVrOffsets(next)
                          vrOffsetsRef.current = next
                          if (cameraRef.current) {
                            cameraRef.current.position[axis] = 0
                            controlsRef.current?.update()
                          }
                        }}
                      >
                        <RestartAltIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
                <Slider
                  min={-1} max={1} step={0.005}
                  value={vrOffsets[vrStart]?.[axis] ?? 0}
                  onChange={(_, v) => {
                    const next = { ...vrOffsets, [vrStart]: { ...vrOffsets[vrStart], [axis]: v } }
                    setVrOffsets(next)
                    vrOffsetsRef.current = next
                    if (cameraRef.current && controlsRef.current) {
                      cameraRef.current.position[axis] = v
                      controlsRef.current.update()
                    }
                  }}
                  sx={{
                    color: '#4fc3f7',
                    '& .MuiSlider-thumb': { width: 16, height: 16 },
                  }}
                />
              </Box>
            ))}
          </Box>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', mt: 1 }}>
            {t('vr.clickToClose')}
          </Typography>
        </Box>
      )}

      {/* タイトルバー */}
      <Box
        sx={{
          ...barStyle,
          position: 'absolute', top: 0, left: 0, right: 0,
          height: 48,
          display: 'flex', alignItems: 'center',
          py: 0.5, px: '10px',
          zIndex: 10,
          opacity: showUI ? 1 : 0,
          pointerEvents: showUI ? 'auto' : 'none',
          cursor: 'grab',
          '&:active': { cursor: 'grabbing' },
        }}
        style={{ '--wails-draggable': 'drag' }}
      >
        {/* ハンバーガーメニュー */}
        <Box style={{ '--wails-draggable': 'no-drag' }}>
          <IconButton sx={{ color: 'white', width: 28, height: 28 }} onClick={e => setMenuAnchor(e.currentTarget)}>
            <MenuIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
          >
            <MenuItem onClick={() => { setMenuAnchor(null); document.getElementById('file-input').click() }}>
              <FolderOpenIcon fontSize="small" sx={{ mr: 1 }} />
              {t('menu.openFile')}
            </MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); setSettingsOpen(true) }}>
              <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
              {t('menu.settings')}
            </MenuItem>
          </Menu>
        </Box>

        {/* モード切替 */}
        <Box style={{ '--wails-draggable': 'no-drag' }} sx={{ ml: 1 }}>
          <ToggleButtonGroup
            value={mode} exclusive size="small"
            onChange={(_, v) => { if (v) setMode(v) }}
            sx={{
              '& .MuiToggleButton-root': {
                color: 'rgba(255,255,255,0.5)',
                borderColor: 'rgba(255,255,255,0.2)',
                py: 0.5, p: 0.5,
              },
              '& .Mui-selected': {
                color: 'white !important',
                bgcolor: 'rgba(255,255,255,0.15) !important',
              },
            }}
          >
            <Tooltip title={t('mode.normal')} placement="bottom">
              <ToggleButton value="fit"><OndemandVideoIcon fontSize="small" /></ToggleButton>
            </Tooltip>
            <Tooltip title={t('mode.free')} placement="bottom">
              <ToggleButton value="normal"><OpenWithIcon fontSize="small" /></ToggleButton>
            </Tooltip>
            <Tooltip title="VR" placement="bottom">
              <ToggleButton value="vr"><VrpanoIcon fontSize="small" /></ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>

        {/* VRモード時: 始点変更ボタン */}
        {mode === 'vr' && (
          <Box style={{ '--wails-draggable': 'no-drag' }} sx={{ ml: 0.5 }}>
            <Tooltip title={t('vr.changeViewpoint')} placement="bottom">
              <IconButton
                sx={{ color: 'white', width: 28, height: 28 }}
                onClick={() => setStartOpen(true)}
              >
                <GridViewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Box sx={{ flex: 1 }} />

        {/* ウィンドウ操作 */}
        <Stack direction="row" spacing={2.5} style={{ '--wails-draggable': 'no-drag' }}>
          <Tooltip title={alwaysOnTop ? t('controls.alwaysOnTopOn') : t('controls.alwaysOnTopOff')} placement="bottom">
            <IconButton
              sx={{ color: alwaysOnTop ? activeColor : 'rgba(255,255,255,0.4)', width: 28, height: 28 }}
              onClick={() => {
                const next = !alwaysOnTop
                setAlwaysOnTop(next)
                Window.SetAlwaysOnTop(next)
                UpdateAlwaysOnTop(next)
              }}
            >
              <PushPinIcon fontSize="small" sx={{ transition: 'transform 0.2s', transform: alwaysOnTop ? 'none' : 'rotate(45deg)' }} />
            </IconButton>
          </Tooltip>
          <IconButton sx={{ color: 'white', width: 28, height: 28 }} onClick={() => Window.Minimise()}>
            <MinimizeIcon fontSize="small" />
          </IconButton>
          <IconButton sx={{ color: 'white', width: 28, height: 28 }} onClick={() => Window.ToggleMaximise()}>
            <CropSquareIcon fontSize="small" />
          </IconButton>
          <IconButton
            sx={{ color: 'white', width: 28, height: 28, '&:hover': { color: '#ef5350', bgcolor: 'rgba(239,83,80,0.15)' } }}
            onClick={() => Window.Close()}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      {/* コントロールバー */}
      <Box sx={{
        ...barStyle,
        position: 'absolute', bottom: 0, left: 0, right: 0,
        px: 2, pt: 2, pb: 2,
        opacity: showUI ? 1 : 0,
        pointerEvents: showUI ? 'auto' : 'none',
      }}>
        <Box
          ref={seekBarRef}
          sx={{ position: 'relative' }}
          onMouseMove={handleSeekBarMouseMove}
          onMouseLeave={handleSeekBarMouseLeave}
        >
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
              videoRef.current.currentTime = v
              seekDragging.current = false
            }}
            sx={{
              py: 0.5,
              '& .MuiSlider-track': { height: 14, border: 'none', bgcolor: activeColor, borderRadius: 0.5 },
              '& .MuiSlider-rail':  { height: 14, bgcolor: 'rgba(255,255,255,0.25)', borderRadius: 0.5 },
              '& .MuiSlider-thumb': {
                width: 22, height: 22, bgcolor: activeColor,
                borderRadius: 0,
                clipPath: 'polygon(30% 0, 85% 50%, 30% 100%)',
                '&:hover, &.Mui-focusVisible': { boxShadow: 'none' },
                '&::before': { boxShadow: 'none' },
              },
            }}
          />
        </Box>
        <Stack direction="row" sx={{ alignItems: 'anchor-center', mt: 1 }} spacing={1}>
          <IconButton onClick={handlePlayPause} sx={{ color: 'white', width: 28, height: 28 }}>
            {paused ? <PlayArrowIcon /> : <PauseIcon />}
          </IconButton>
          <Typography sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', minWidth: 90, fontSize: '0.95rem' }}>
            {fmt(currentTime)} / {fmt(duration)}
          </Typography>
          <IconButton onClick={handleMuteToggle} sx={{ color: muted ? 'rgba(255,255,255,0.3)' : 'white', width: 28, height: 28, ml: '20px !important' }}>
            {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
          </IconButton>
          <Slider
            size="small"
            min={0} max={1} step={0.01}
            value={volume}
            onChange={handleVolumeChange}
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
            <IconButton onClick={handleFullscreenToggle} sx={{ color: 'white', width: 28, height: 28 }}>
              {fullscreen
                ? <FullscreenExitIcon fontSize="small" />
                : <FullscreenIcon    fontSize="small" />
              }
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
      {/* 右サイドパネル（スナップショット） */}
      <Box
        sx={{
          ...barStyle,
          position: 'absolute', right: 0, top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          py: 1.5, px: 0.5,
          borderRadius: '8px 0 0 8px',
          zIndex: 10,
          opacity: showUI ? 1 : 0,
          pointerEvents: showUI ? 'auto' : 'none',
        }}
      >
        <Tooltip title={t('controls.snapshot')} placement="left">
          <IconButton onClick={handleSnapshot} sx={{ color: 'white', width: 56, height: 56 }}>
            <CameraAltIcon sx={{ fontSize: 40 }} />
          </IconButton>
        </Tooltip>
        <Tooltip
          title={mode === 'vr' ? t('controls.resetCamera') : mode === 'fit' ? t('controls.fitWindow') : t('controls.resetView')}
          placement="left"
        >
          <IconButton onClick={handleReset} sx={{ color: 'white', width: 56, height: 56 }}>
            <FitScreenIcon sx={{ fontSize: 40 }} />
          </IconButton>
        </Tooltip>
      </Box>


      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        availableLangs={availableLangs}
        onLanguageChange={handleLanguageChange}
        activeColor={activeColor}
        onActiveColorChange={handleActiveColorChange}
        thumbEnabled={thumbEnabled}
        onThumbEnabledChange={(next) => {
          setThumbEnabled(next)
          thumbEnabledRef.current = next
          if (!next) {
            clearTimeout(thumbSeekTimer.current)
            setThumbInfo(null)
            if (thumbVideoRef.current) thumbVideoRef.current.src = ''
          } else if (videoRef.current?.src) {
            if (thumbVideoRef.current) thumbVideoRef.current.src = videoRef.current.src
          }
          UpdatePlaybackSettings(volume, muted, next, language)
        }}
      />
    </div>
  )
}
