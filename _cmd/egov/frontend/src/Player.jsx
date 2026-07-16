import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Box, IconButton, Tooltip } from '@mui/material'
import CameraAltIcon from '@mui/icons-material/CameraAlt'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import { Events, Window } from '@wailsio/runtime'
import { GetInitialFile, GetServerURL, GetSettings, UpdateAlwaysOnTop, UpdatePlaybackSettings, UpdateVRSettings } from '../bindings/egov/api'
import { useTranslation } from 'react-i18next'
import { loadLanguages } from './languages'
import SettingsDialog from './SettingsDialog'
import useThreeScene from './player/useThreeScene'
import TitleBar from './player/TitleBar'
import ControlBar from './player/ControlBar'
import MiniProgressBar from './player/MiniProgressBar'
import VrViewpointOverlay from './player/VrViewpointOverlay'
import { ClickFeedback, DropHint, EmptyState, SeekFeedback, SeekZoneOverlay, VideoErrorOverlay } from './player/Overlays'
import { VR_START, applyHeadRotation, applySpherePosition, barStyle, deg2rad, rad2deg } from './player/utils'

// プレイヤー本体。状態・設定・入力処理のオーケストレーターとして働き、
// 描画は useThreeScene（Three.jsシーン）と player/ 以下の各コンポーネントに委譲する。
export default function Player() {
  const { t } = useTranslation()
  const modeRef      = useRef('normal')
  const dragCounter  = useRef(0)
  const hideTimer    = useRef(null)
  const thumbVideoRef   = useRef(null)
  const thumbCanvasRef  = useRef(null)
  const thumbEnabledRef = useRef(true)
  const vrStartRef      = useRef('left')
  const vrYawRef        = useRef(0)   // 現在の頭の向き（ラジアン、セッション中保持）
  const vrPitchRef      = useRef(0)
  const vrInitYawRef    = useRef(0)   // 保存済みの既定の向き（ラジアン）
  const vrInitPitchRef  = useRef(0)
  const vrPosRef        = useRef({ x: 0, y: 0, z: 0 })   // 現在の視点位置（半径比）
  const vrInitPosRef    = useRef({ x: 0, y: 0, z: 0 })   // 保存済みの既定位置
  const feedbackKeyRef      = useRef(0)
  const clickTimerRef           = useRef(null)
  const holdTimerRef            = useRef(null)
  const wasHoldRef              = useRef(false)
  const lastPointerDownTimeRef  = useRef(0)
  const isMouseHeldRef          = useRef(false)
  const seekZoneTimerRef        = useRef(null)
  const seekZoneRef             = useRef(null)
  const seekOverlayRef          = useRef(null)
  const fastSeekSecsRef         = useRef(60)
  const seekFeedbackKeyRef  = useRef(0)
  const clickTimeoutMsRef   = useRef(300)
  const doubleClickSeekRef  = useRef(10)
  const justFocusedRef      = useRef(false)
  const focusTimerRef       = useRef(null)
  const acceptInactiveRef   = useRef(false)
  const vrFovRef            = useRef(75)
  const vrSensitivityRef    = useRef(0.004)
  const vrScrollSpeedRef    = useRef(0.05)
  const uiHideDelayRef      = useRef(1500)
  const uiHideLeaveDelayRef = useRef(800)
  const [miniProgress, setMiniProgress] = useState(false)

  const [paused,      setPaused]      = useState(true)
  const [duration,    setDuration]    = useState(0)
  const [videoEl,     setVideoEl]     = useState(null)   // 子コンポーネントが timeupdate を購読するため
  const [volume,      setVolume]      = useState(0.5)
  const [muted,       setMuted]       = useState(false)
  const [fileName,    setFileName]    = useState('')
  const [dragging,    setDragging]    = useState(false)
  const [showUI,      setShowUI]      = useState(false)
  const [resizeCursor, setResizeCursor] = useState(null)   // Wails3リサイズ判定領域内で明示すべきカーソル種別
  const [mode,        setMode]        = useState('normal')   // normal=ウィンドウフィット / free=自由パン・ズーム / vr
  const [vrStart,     setVrStart]     = useState('left')
  const [startOpen,   setStartOpen]   = useState(false)
  const [clickFeedback, setClickFeedback] = useState(null)
  const [seekFeedback,  setSeekFeedback]  = useState(null)
  const [thumbEnabled, setThumbEnabled] = useState(true)
  const [language,     setLanguage]     = useState('en')
  const [vrView,         setVrView]         = useState({ pitch: 0, yaw: 0, fov: 75, posX: 0, posY: 0, posZ: 0 })   // オーバーレイ表示用（度・半径比）
  const [availableLangs, setAvailableLangs] = useState([])
  const [serverUrl,      setServerUrl]      = useState('')
  const [settingsOpen,   setSettingsOpen]   = useState(false)
  const [activeColor,    setActiveColor]    = useState('#4fc3f7')
  const [alwaysOnTop,    setAlwaysOnTop]    = useState(false)
  const [fullscreen,     setFullscreen]     = useState(false)
  const [loop,           setLoop]           = useState(true)
  const [videoError,     setVideoError]     = useState(null)
  const [seekOverlay,    setSeekOverlay]    = useState(null)   // { x, y } or null
  const [seekZoneActive, setSeekZoneActive] = useState(null)   // { seconds, forward } or null
  const [rangeLoop,      setRangeLoop]      = useState(false)
  const [rotation,       setRotation]       = useState(0)

  // Three.js シーン（生成・破棄・描画ループはフック側が担う）
  const {
    mountRef, videoRef, cameraRef, controlsRef, sphereRef, planeRef,
    textureRef, fitCameraRef, headGroupRef, rendererRef,
    requestRenderRef, objectUrlRef, detectedFpsRef,
  } = useThreeScene({
    modeRef,
    vrScrollSpeedRef,
    onDuration: setDuration,
    onVideoEl: setVideoEl,
    onVideoError: setVideoError,
  })

  // カメラ・コントロール切替
  useEffect(() => {
    modeRef.current = mode
    if (!sphereRef.current || !planeRef.current || !cameraRef.current || !controlsRef.current || !headGroupRef.current) return

    const camera    = cameraRef.current
    const controls  = controlsRef.current
    const headGroup = headGroupRef.current

    sphereRef.current.visible = mode === 'vr'
    planeRef.current.visible  = mode !== 'vr'

    const mount = mountRef.current
    if (mount) {
      camera.aspect = mount.clientWidth / mount.clientHeight
      rendererRef.current?.setSize(mount.clientWidth, mount.clientHeight)
    }

    if (mode === 'vr') {
      camera.position.set(0, 0, 0.1)
      // セッション中の頭の向き・視点位置を維持して復帰する
      applyHeadRotation(headGroup, vrYawRef.current, vrPitchRef.current)
      applySpherePosition(sphereRef.current, vrPosRef.current)
      camera.fov     = vrFovRef.current
      controls.enabled = false
      camera.updateProjectionMatrix()
      planeRef.current.rotation.z = 0
    } else if (mode === 'free') {
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
      planeRef.current.rotation.z = -(rotation * Math.PI) / 180
    } else {
      headGroup.rotation.set(0, 0, 0)
      camera.fov            = 60
      controls.enabled      = true
      controls.enableRotate = false
      controls.enableZoom   = false
      controls.enablePan    = false
      camera.updateProjectionMatrix()
      planeRef.current.rotation.z = 0
      fitCameraRef.current?.()
    }
    requestRenderRef.current?.()
  }, [mode, vrStart, rotation])

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
    requestRenderRef.current?.()
  }, [mode, vrStart])

  // VRモード: 右クリックドラッグでheadGroupを回転（首振り）
  useEffect(() => {
    if (mode !== 'vr') return
    const canvas = mountRef.current?.querySelector('canvas')
    if (!canvas) return

    let startX = 0, startY = 0, active = false

    const onPointerDown = (e) => {
      if (e.button !== 2) return
      startX = e.clientX; startY = e.clientY; active = true
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    const onPointerMove = (e) => {
      if (!active) return
      const sensitivity = vrSensitivityRef.current
      // 向きは ref に保持し、モード切替やスライダー調整と整合させる
      vrYawRef.current  -= (e.clientX - startX) * sensitivity
      vrPitchRef.current = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
        vrPitchRef.current - (e.clientY - startY) * sensitivity))
      startX = e.clientX; startY = e.clientY
      applyHeadRotation(headGroupRef.current, vrYawRef.current, vrPitchRef.current)
      requestRenderRef.current?.()
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

  // 現在の頭の向き・視点位置・FOVを既定として保存する。
  // 他のVR設定（感度等）は保存済みの値を維持する。
  const persistVRView = async () => {
    const fov = cameraRef.current?.fov ?? vrFovRef.current
    vrInitPitchRef.current = vrPitchRef.current
    vrInitYawRef.current   = vrYawRef.current
    vrInitPosRef.current   = { ...vrPosRef.current }
    vrFovRef.current       = fov
    const s = await GetSettings()
    UpdateVRSettings({
      ...s.vr,
      initialPitch: rad2deg(vrPitchRef.current),
      initialYaw:   rad2deg(vrYawRef.current),
      positionX:    vrPosRef.current.x,
      positionY:    vrPosRef.current.y,
      positionZ:    vrPosRef.current.z,
      fov,
    })
  }

  // VR視点オーバーレイを開く。スライダーへ現在の向き・位置を反映する。
  const openVrOverlay = () => {
    setVrView({
      pitch: rad2deg(vrPitchRef.current),
      yaw:   rad2deg(vrYawRef.current),
      fov:   cameraRef.current?.fov ?? vrFovRef.current,
      posX:  vrPosRef.current.x,
      posY:  vrPosRef.current.y,
      posZ:  vrPosRef.current.z,
    })
    setStartOpen(true)
  }

  // オーバーレイのスライダー変更を即時反映する
  const applyVrView = (next) => {
    setVrView(next)
    vrPitchRef.current = deg2rad(next.pitch)
    vrYawRef.current   = deg2rad(next.yaw)
    vrPosRef.current   = { x: next.posX, y: next.posY, z: next.posZ }
    applyHeadRotation(headGroupRef.current, vrYawRef.current, vrPitchRef.current)
    applySpherePosition(sphereRef.current, vrPosRef.current)
    if (cameraRef.current && cameraRef.current.fov !== next.fov) {
      cameraRef.current.fov = next.fov
      cameraRef.current.updateProjectionMatrix()
    }
    requestRenderRef.current?.()
  }

  // 範囲の解除・初期化は SeekBarArea 側の effect が行う
  const resetRangeLoop = () => setRangeLoop(false)

  // play() は自動再生ポリシー等で拒否されることがある。
  // 拒否時は楽観的に false にした paused 状態を停止へ戻す。
  const safePlay = (video) => {
    video.play().catch((err) => {
      console.warn('video.play() rejected:', err)
      setPaused(true)
    })
  }

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('video/')) return
    const video = videoRef.current
    const url   = URL.createObjectURL(file)
    // 前のファイルの Object URL を解放（Blob 参照のリーク防止）
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = url
    setVideoError(null)
    video.src = url
    if (thumbEnabledRef.current && thumbVideoRef.current) thumbVideoRef.current.src = url
    safePlay(video)
    setPaused(false)
    setFileName(file.name)
    resetRangeLoop()
  }

  const loadFilePath = (fileUrl) => {
    if (!fileUrl) return
    const video = videoRef.current
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setVideoError(null)
    video.src = fileUrl
    if (thumbEnabledRef.current && thumbVideoRef.current) thumbVideoRef.current.src = fileUrl
    safePlay(video)
    setPaused(false)
    const filePath = new URL(fileUrl).searchParams.get('path') ?? ''
    setFileName(filePath.split(/[\\/]/).pop())
    resetRangeLoop()
  }

  useEffect(() => {
    // 設定値は Go 側で正規化済み（LoadSettings が不正値をデフォルトへ補正して
    // 常に完全な Settings を返す）ため、フロントエンドでのフォールバックは行わない
    const settingsReady = Promise.all([GetServerURL(), GetSettings()]).then(([url, s]) => {
      const p = s.playback
      setVolume(p.volume)
      setMuted(p.muted)
      setThumbEnabled(p.thumbnailEnabled)
      thumbEnabledRef.current = p.thumbnailEnabled
      setLanguage(p.language)
      setActiveColor(p.activeColor)
      setAlwaysOnTop(s.app.alwaysOnTop)
      acceptInactiveRef.current  = s.app.acceptInactiveClick
      clickTimeoutMsRef.current  = s.controls.clickTimeoutMs
      doubleClickSeekRef.current = s.controls.doubleClickSeekSecs
      fastSeekSecsRef.current    = s.controls.fastSeekSecs
      uiHideDelayRef.current      = s.controls.uiHideDelayMs
      uiHideLeaveDelayRef.current = s.controls.uiHideOnLeaveDelayMs
      // VR設定と起動時モードを反映
      vrFovRef.current         = s.vr.fov
      vrSensitivityRef.current = s.vr.dragSensitivity
      vrScrollSpeedRef.current = s.vr.scrollSpeed
      const initPitch = deg2rad(s.vr.initialPitch)
      const initYaw   = deg2rad(s.vr.initialYaw)
      const initPos   = { x: s.vr.positionX, y: s.vr.positionY, z: s.vr.positionZ }
      vrInitPitchRef.current = initPitch
      vrInitYawRef.current   = initYaw
      vrInitPosRef.current   = { ...initPos }
      vrPitchRef.current     = initPitch
      vrYawRef.current       = initYaw
      vrPosRef.current       = { ...initPos }
      setVrView({
        pitch: s.vr.initialPitch, yaw: s.vr.initialYaw, fov: s.vr.fov,
        posX: initPos.x, posY: initPos.y, posZ: initPos.z,
      })
      setVrStart(s.vr.defaultStart)
      vrStartRef.current = s.vr.defaultStart
      setMode(p.defaultMode)
      setMiniProgress(s.app.miniProgressBar)
      setServerUrl(url)
      if (videoRef.current) {
        videoRef.current.volume = p.volume
        videoRef.current.muted  = p.muted
      }
      loadLanguages(url, p.language).then(langs => setAvailableLangs(langs))
    })
    // 音量・ミュート設定の適用と並走させると、反映前に再生が始まり
    // 一瞬音が出ることがあるため、ファイルの読み込みは設定適用後に行う
    settingsReady.then(() => GetInitialFile()).then(loadFilePath)

    const unsub = Events.On('open-file', (event) => {
      settingsReady.then(() => loadFilePath(event.data))
    })
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

  useEffect(() => {
    let frameSeeking = false
    const onSeeked = () => { frameSeeking = false }
    const video = videoRef.current
    video?.addEventListener('seeked', onSeeked)

    const onKeyDown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (!video?.src) return
      e.preventDefault()
      const forward = e.key === 'ArrowRight'
      if (video.paused) {
        if (frameSeeking) return
        frameSeeking = true
        const fps = detectedFpsRef.current > 1 ? detectedFpsRef.current : 30
        const step = 1 / fps
        // シークで timeupdate が発火し、SeekBarArea 等が追従する
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (forward ? step : -step)))
      } else {
        if (e.repeat) return
        doZoneSeek(5, forward)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      video?.removeEventListener('seeked', onSeeked)
    }
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

  // Wails3ランタイム（drag.js）のリサイズ判定と同じ境界でカーソル種別を計算する。
  // 自前オーバーレイ（タイトルバー/ドロップ領域）が独自の cursor を指定していると
  // document.body 側のリサイズカーソルが隠れてしまうため、明示的に上書きする。
  const computeResizeCursor = (e) => {
    const edge = 6
    const corner = 16
    const left   = e.clientX < edge
    const right  = e.clientX > window.innerWidth  - edge
    const top    = e.clientY < edge
    const bottom = e.clientY > window.innerHeight - edge
    const leftC   = e.clientX < corner
    const rightC  = e.clientX > window.innerWidth  - corner
    const topC    = e.clientY < corner
    const bottomC = e.clientY > window.innerHeight - corner
    if (rightC && bottomC) return 'nwse-resize'
    if (leftC  && bottomC) return 'nesw-resize'
    if (leftC  && topC)    return 'nwse-resize'
    if (topC   && rightC)  return 'nesw-resize'
    if (left || right) return 'ew-resize'
    if (top || bottom)  return 'ns-resize'
    return null
  }

  const handleMouseMove = (e) => {
    setResizeCursor(computeResizeCursor(e))
    const inZone = e.clientY <= 80 || e.clientY >= window.innerHeight - 160 || e.clientX >= window.innerWidth - 80
    if (inZone) {
      clearTimeout(hideTimer.current)
      setShowUI(true)
    } else if (showUI) {
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setShowUI(false), uiHideDelayRef.current)
    }
    // シークオーバーレイのゾーン検出（seekOverlay state が設定された後＝800ms経過後のみ）
    if (seekOverlay && isMouseHeldRef.current) {
      const dx = e.clientX - seekOverlay.x
      const dy = Math.abs(e.clientY - seekOverlay.y)
      if (dy > 55) {
        stopZoneSeek()
      } else if (dx > 75) {
        startZoneSeek(fastSeekSecsRef.current, true)
      } else if (dx > 20) {
        startZoneSeek(doubleClickSeekRef.current, true)
      } else if (dx < -75) {
        startZoneSeek(fastSeekSecsRef.current, false)
      } else if (dx < -20) {
        startZoneSeek(doubleClickSeekRef.current, false)
      } else {
        stopZoneSeek()
      }
    }
  }

  const handleMouseLeave = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setShowUI(false), uiHideLeaveDelayRef.current)
    if (seekOverlayRef.current) hideSeekOverlay()
    setResizeCursor(null)
  }

  const handlePlayPause = () => {
    const video = videoRef.current
    if (!video.src) return
    if (video.paused) { safePlay(video); setPaused(false) }
    else              { video.pause(); setPaused(true) }
  }

  const handleVolumeChange = (_, v) => {
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
  }

  // ドラッグ中の毎ティック保存を避け、確定時のみディスクへ書き込む
  const handleVolumeCommitted = (_, v) => {
    UpdatePlaybackSettings(v, muted, thumbEnabledRef.current, language)
  }

  const handleReset = () => {
    const camera   = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return

    if (mode === 'vr') {
      // 保存済みの既定の向き・位置に戻す
      vrPitchRef.current = vrInitPitchRef.current
      vrYawRef.current   = vrInitYawRef.current
      vrPosRef.current   = { ...vrInitPosRef.current }
      applyHeadRotation(headGroupRef.current, vrYawRef.current, vrPitchRef.current)
      applySpherePosition(sphereRef.current, vrPosRef.current)
      camera.fov = vrFovRef.current
      camera.updateProjectionMatrix()
    } else if (mode === 'normal') {
      const video = videoRef.current
      if (video?.videoWidth && video?.videoHeight) {
        if (rotation % 180) {
          Window.SetSize(video.videoHeight, video.videoWidth)
        } else {
          Window.SetSize(video.videoWidth, video.videoHeight)
        }
      }
    } else {
      camera.position.set(0, 0, 9)
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()
    }
    requestRenderRef.current?.()
  }

  const doZoneSeek = (seconds, forward) => {
    const video = videoRef.current
    if (!video?.src) return
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (forward ? seconds : -seconds)))
    seekFeedbackKeyRef.current++
    setSeekFeedback({ forward, seconds, key: seekFeedbackKeyRef.current, overlayPos: seekOverlayRef.current ?? null })
  }

  const startZoneSeek = (seconds, forward) => {
    const cur = seekZoneRef.current
    if (cur?.seconds === seconds && cur?.forward === forward) return
    clearTimeout(seekZoneTimerRef.current)
    seekZoneRef.current = { seconds, forward }
    setSeekZoneActive({ seconds, forward })
    doZoneSeek(seconds, forward)
    const tick = () => {
      if (!seekZoneRef.current) return
      doZoneSeek(seekZoneRef.current.seconds, seekZoneRef.current.forward)
      seekZoneTimerRef.current = setTimeout(tick, 1000)
    }
    seekZoneTimerRef.current = setTimeout(tick, 1000)
  }

  const stopZoneSeek = () => {
    clearTimeout(seekZoneTimerRef.current)
    seekZoneRef.current = null
    setSeekZoneActive(null)
  }

  const hideSeekOverlay = () => {
    isMouseHeldRef.current = false
    seekOverlayRef.current = null
    setSeekOverlay(null)
    stopZoneSeek()
  }

  // ダブルクリック: 即座に単純な早送り/巻き戻しを実行（コントローラーは出さない）
  // シングルクリックでも一定時間（800ms）保持し続けたらコントローラー（オーバーレイ）を表示する
  const handleCanvasMouseDown = (e) => {
    if (e.button !== 0) return
    const pos = { x: e.clientX, y: e.clientY }
    const now = Date.now()
    const isDouble = e.detail >= 2 || (now - lastPointerDownTimeRef.current) <= clickTimeoutMsRef.current
    lastPointerDownTimeRef.current = isDouble ? 0 : now

    // 中央25%はデッドゾーン（再生/停止の誤操作防止）
    const cx = window.innerWidth / 2
    const deadZone = window.innerWidth * 0.125
    const inDeadZone = pos.x > cx - deadZone && pos.x < cx + deadZone
    if (inDeadZone) return

    if (isDouble) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      doZoneSeek(doubleClickSeekRef.current, pos.x > cx)
    }

    clearTimeout(holdTimerRef.current)
    holdTimerRef.current = setTimeout(() => {
      wasHoldRef.current = true
      isMouseHeldRef.current = true
      seekOverlayRef.current = pos
      setSeekOverlay(pos)
    }, 400)
  }

  const handleCanvasMouseUp = () => {
    clearTimeout(holdTimerRef.current)
    if (isMouseHeldRef.current) hideSeekOverlay()
  }

  const handleCanvasClick = (e) => {
    if (wasHoldRef.current) {
      wasHoldRef.current = false
      return
    }
    if (justFocusedRef.current && !acceptInactiveRef.current) {
      justFocusedRef.current = false
      clearTimeout(focusTimerRef.current)
      return
    }
    justFocusedRef.current = false
    const video = videoRef.current
    if (!video?.src) return
    if (e.detail > 1) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      return
    }
    clearTimeout(clickTimerRef.current)
    const willPlay = video.paused
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      handlePlayPause()
      feedbackKeyRef.current++
      setClickFeedback({ type: willPlay ? 'play' : 'pause', key: feedbackKeyRef.current })
    }, clickTimeoutMsRef.current)
  }

  const handleSnapshot = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const vw = video.videoWidth, vh = video.videoHeight
    const m = modeRef.current
    const rot = rotation

    let sx = 0, sy = 0, sw = vw, sh = vh
    if (m === 'vr') {
      const cfg = VR_START[vrStartRef.current] ?? VR_START.left
      sw = vw * cfg.repeat[0]
      sh = vh * cfg.repeat[1]
      sx = vw * cfg.offset[0]
      sy = vh * (1 - cfg.offset[1] - cfg.repeat[1])
    }

    const rotated = rot % 180 !== 0
    const dw = rotated ? sh : sw
    const dh = rotated ? sw : sh

    const c = document.createElement('canvas')
    c.width = dw; c.height = dh
    const ctx = c.getContext('2d')
    if (rot) {
      ctx.translate(dw / 2, dh / 2)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.translate(-sw / 2, -sh / 2)
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)

    // toDataURL の巨大な base64 文字列を避け、Blob 経由で保存する
    c.toBlob((blob) => {
      if (!blob) return
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `egov_${Date.now()}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    }, 'image/png')
  }

  const handleLoopToggle = () => {
    const next = !loop
    setLoop(next)
    if (videoRef.current) videoRef.current.loop = next
  }

  const handleRangeLoopToggle = () => setRangeLoop(r => !r)

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

  const handleModeChange = (v) => {
    if (v === 'vr' && rotation) setRotation(0)
    setMode(v)
  }

  const handleRotate = () => {
    const next = (rotation + 90) % 360
    if (mode === 'normal' && (rotation % 180 === 0) !== (next % 180 === 0)) {
      Window.SetSize(window.innerHeight, window.innerWidth)
    }
    setRotation(next)
  }

  const handleAlwaysOnTopToggle = () => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    Window.SetAlwaysOnTop(next)
    UpdateAlwaysOnTop(next)
  }

  return (
    <div
      data-file-drop-target
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        background: '#000',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        ref={mountRef}
        style={{
          ...(mode === 'normal' && rotation % 180
            ? {
                position: 'absolute',
                top: '50%', left: '50%',
                width: '100vh',
                height: '100vw',
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              }
            : {
                width: '100%', height: '100%',
                transform: mode === 'normal' && rotation ? `rotate(${rotation}deg)` : undefined,
              }),
        }}
        onClick={handleCanvasClick}
        onMouseDown={handleCanvasMouseDown}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onContextMenu={e => e.preventDefault()}
      />

      {seekFeedback && (
        <SeekFeedback feedback={seekFeedback} onDone={() => setSeekFeedback(null)} />
      )}

      {seekOverlay && (
        <SeekZoneOverlay
          overlay={seekOverlay}
          active={seekZoneActive}
          activeColor={activeColor}
          fastSeekSecs={fastSeekSecsRef.current}
          doubleClickSeekSecs={doubleClickSeekRef.current}
        />
      )}

      {clickFeedback && (
        <ClickFeedback feedback={clickFeedback} onDone={() => setClickFeedback(null)} />
      )}

      {videoError && <VideoErrorOverlay error={videoError} />}

      {!fileName && <EmptyState resizeCursor={resizeCursor} />}

      {dragging && <DropHint />}

      <input id="file-input" type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
      <video ref={thumbVideoRef} muted preload="metadata" crossOrigin="anonymous" style={{ display: 'none' }} />
      <canvas ref={thumbCanvasRef} style={{ display: 'none' }} />

      {startOpen && (
        <VrViewpointOverlay
          onClose={() => setStartOpen(false)}
          vrStart={vrStart}
          onVrStartChange={setVrStart}
          vrView={vrView}
          onChange={applyVrView}
          onCommit={persistVRView}
        />
      )}

      <TitleBar
        showUI={showUI}
        resizeCursor={resizeCursor}
        mode={mode}
        onModeChange={handleModeChange}
        rotation={rotation}
        onRotate={handleRotate}
        alwaysOnTop={alwaysOnTop}
        onAlwaysOnTopToggle={handleAlwaysOnTopToggle}
        activeColor={activeColor}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenVrOverlay={openVrOverlay}
      />

      {/* ミニプログレスバー */}
      {miniProgress && !showUI && duration > 0 && (
        <MiniProgressBar video={videoEl} duration={duration} activeColor={activeColor} />
      )}

      <ControlBar
        showUI={showUI}
        video={videoEl}
        duration={duration}
        paused={paused}
        onPlayPause={handlePlayPause}
        muted={muted}
        onMuteToggle={handleMuteToggle}
        volume={volume}
        onVolumeChange={handleVolumeChange}
        onVolumeCommitted={handleVolumeCommitted}
        fileName={fileName}
        fullscreen={fullscreen}
        onFullscreenToggle={handleFullscreenToggle}
        loop={loop}
        onLoopToggle={handleLoopToggle}
        rangeLoop={rangeLoop}
        onRangeLoopToggle={handleRangeLoopToggle}
        activeColor={activeColor}
        thumbVideoRef={thumbVideoRef}
        thumbCanvasRef={thumbCanvasRef}
        thumbEnabledRef={thumbEnabledRef}
        modeRef={modeRef}
        vrStartRef={vrStartRef}
      />

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
          opacity: showUI ? 0.6 : 0,
          pointerEvents: showUI ? 'auto' : 'none',
          transition: 'opacity 0.3s',
          '&:hover': { opacity: showUI ? 1 : 0 },
        }}
      >
        <Tooltip title={t('controls.snapshot')} placement="left">
          <IconButton onClick={handleSnapshot} sx={{ color: 'white', width: 56, height: 56 }}>
            <CameraAltIcon sx={{ fontSize: 40 }} />
          </IconButton>
        </Tooltip>
        <Tooltip
          title={mode === 'vr' ? t('controls.resetCamera') : mode === 'normal' ? t('controls.fitWindow') : t('controls.resetView')}
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
        acceptInactiveClick={acceptInactiveRef.current}
        onAcceptInactiveClickChange={(next) => { acceptInactiveRef.current = next }}
        miniProgressBar={miniProgress}
        onMiniProgressBarChange={(next) => setMiniProgress(next)}
        thumbEnabled={thumbEnabled}
        onThumbEnabledChange={(next) => {
          setThumbEnabled(next)
          thumbEnabledRef.current = next
          if (!next) {
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
