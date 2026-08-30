import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Alert, Box, CircularProgress, IconButton, Snackbar, Tooltip } from '@mui/material'
import CameraAltIcon from '@mui/icons-material/CameraAlt'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import GridViewIcon from '@mui/icons-material/GridView'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import { Dialogs, Events, Window } from '@wailsio/runtime'
import { CanExtract, ExtractRange, SuggestExtractTarget, GetInitialFile, GetServerURL, GetSettings, UpdateAlwaysOnTop, UpdatePlaybackSettings, UpdateVRSettings } from '../bindings/egov/api'
import { useTranslation } from 'react-i18next'
import { loadLanguages } from './languages'
import SettingsDialog from './SettingsDialog'
import useThreeScene from './player/useThreeScene'
import TitleBar from './player/TitleBar'
import ControlBar from './player/ControlBar'
import MiniProgressBar from './player/MiniProgressBar'
import ThumbnailGrid from './player/ThumbnailGrid'
import VrViewpointOverlay from './player/VrViewpointOverlay'
import DiagnosticsOverlay from './player/DiagnosticsOverlay'
import { ClickFeedback, DropHint, EmptyState, SeekFeedback, SeekZoneOverlay, VideoErrorOverlay } from './player/Overlays'
import { VR_SHIFT_LIMIT, VR_START, barStyle, clamp, deg2rad, fmt, rad2deg } from './player/utils'
import { dispProjIndex, projScaleFor, setVrRotation, srcProjIndex } from './player/vrShader'

// 押し込み中にこの距離（px）を超えて動いたらドラッグ操作とみなし、
// シークコントローラーは表示しない（free/vr モードの視点操作を邪魔しないため）
const HOLD_MOVE_TOLERANCE = 8

// プレイヤー本体。状態・設定・入力処理のオーケストレーターとして働き、
// 描画は useThreeScene（Three.jsシーン）と player/ 以下の各コンポーネントに委譲する。
export default function Player() {
  const { t } = useTranslation()
  const modeRef      = useRef('normal')
  const dragCounter  = useRef(0)
  const dragTimer    = useRef(null)
  const hideTimer    = useRef(null)
  const thumbVideoRef   = useRef(null)
  const thumbCanvasRef  = useRef(null)
  const thumbEnabledRef = useRef(true)
  const thumbCacheRef   = useRef(null)   // { key, thumbs } 同一動画・分割数・回転のサムネイル一覧キャッシュ
  const vrStartRef      = useRef('left')
  const vrYawRef        = useRef(0)   // 現在の頭の向き（ラジアン、セッション中保持）
  const vrPitchRef      = useRef(0)
  const vrRollRef       = useRef(0)   // 素材の水平傾き補正（ラジアン）
  const vrShiftRef      = useRef({ x: 0, y: 0 })   // 描画結果の平行移動（画面半分=1.0）
  // 保存済みの既定値。個別の ref に分けると保存・リセットのどちらかで
  // 項目を取りこぼすため、currentVrView() が返す形のまま丸ごと持つ。
  const vrDefaultsRef   = useRef(null)
  const feedbackKeyRef      = useRef(0)
  const clickTimerRef           = useRef(null)
  const holdTimerRef            = useRef(null)
  const holdOriginRef           = useRef(null)   // 押し込み開始座標。オーバーレイ表示までの移動量判定に使う
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
  const dragSeekSecsRef     = useRef(10)
  const arrowSeekSecsRef    = useRef(5)
  const thumbGridSizeRef    = useRef(4)
  const justFocusedRef      = useRef(false)
  const focusTimerRef       = useRef(null)
  const acceptInactiveRef   = useRef(false)
  const vrFovRef            = useRef(75)          // 表示側の垂直画角（度）
  const vrSrcFovRef         = useRef(180)         // 素材の画角（度）
  const vrSrcProjRef        = useRef('equirect')  // 素材の投影方式
  const vrDispProjRef       = useRef('rectilinear')
  const vrSensitivityRef    = useRef(0.004)
  const vrScrollSpeedRef    = useRef(0.05)
  const uiHideDelayRef      = useRef(1500)
  const uiHideLeaveDelayRef = useRef(800)
  const lastPlayErrorRef    = useRef(null)   // 直近の play() 拒否理由（診断用）
  const filePathRef         = useRef('')     // 再生中ファイルのローカルパス（切り出し元）
  const rangeRef            = useRef(null)   // SeekBarArea が公開する { start, end }
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
  // オーバーレイ表示用の視点パラメータ。角度はすべて度。
  const [vrView, setVrView] = useState({
    pitch: 0, yaw: 0, roll: 0, fov: 75,
    srcFov: 180, srcProj: 'equirect', dispProj: 'rectilinear',
    shiftX: 0, shiftY: 0,
  })
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
  const [thumbGridOpen,  setThumbGridOpen]  = useState(false)
  const [diagOpen,       setDiagOpen]       = useState(false)   // Ctrl+Shift+D の診断オーバーレイ
  const [canExtract,     setCanExtract]     = useState(false)   // 無劣化切り出しが可能なコンテナか
  const [extracting,     setExtracting]     = useState(false)
  const [extractMsg,     setExtractMsg]     = useState(null)    // { severity, text }

  // Three.js シーン（生成・破棄・描画ループはフック側が担う）
  const {
    mountRef, videoRef, cameraRef, controlsRef, planeRef,
    textureRef, fitCameraRef, rendererRef,
    vrUniformsRef, syncVrSizeRef,
    requestRenderRef, objectUrlRef, detectedFpsRef,
    frameCountRef, renderCountRef, renderPathRef,
  } = useThreeScene({
    modeRef,
    onDuration: setDuration,
    onVideoEl: setVideoEl,
    onVideoError: setVideoError,
  })

  // VR視点の ref をすべてシェーダの uniform へ反映する。
  // VRの状態は Player 側の ref を単一の真実とし、変更点はすべてここを通す。
  const syncVrView = () => {
    const u = vrUniformsRef.current
    if (!u) return
    setVrRotation(u.uRot.value, vrYawRef.current, vrPitchRef.current, vrRollRef.current)
    u.uProjScale.value  = projScaleFor(vrDispProjRef.current, deg2rad(vrFovRef.current) / 2)
    u.uDispProj.value   = dispProjIndex(vrDispProjRef.current)
    u.uSrcProj.value    = srcProjIndex(vrSrcProjRef.current)
    u.uSrcHalfFov.value = deg2rad(vrSrcFovRef.current) / 2
    u.uShift.value.set(vrShiftRef.current.x, vrShiftRef.current.y)
    requestRenderRef.current?.()
  }

  // VR視点の全パラメータを1つのオブジェクトにまとめる／書き戻す。
  // 保存・リセット・オーバーレイはすべてこの形を経由するので、
  // 項目を足したときに片側だけ忘れることがない。
  const currentVrView = () => ({
    pitch:    vrPitchRef.current,
    yaw:      vrYawRef.current,
    roll:     vrRollRef.current,
    shift:    { ...vrShiftRef.current },
    fov:      vrFovRef.current,
    srcFov:   vrSrcFovRef.current,
    srcProj:  vrSrcProjRef.current,
    dispProj: vrDispProjRef.current,
  })

  const restoreVrView = (v) => {
    if (!v) return
    vrPitchRef.current    = v.pitch
    vrYawRef.current      = v.yaw
    vrRollRef.current     = v.roll
    vrShiftRef.current    = { ...v.shift }
    vrFovRef.current      = v.fov
    vrSrcFovRef.current   = v.srcFov
    vrSrcProjRef.current  = v.srcProj
    vrDispProjRef.current = v.dispProj
    syncVrView()
  }

  // オーバーレイのスライダーは度・比率なので単位を変換する
  const toOverlay = (v) => ({
    pitch: rad2deg(v.pitch), yaw: rad2deg(v.yaw), roll: rad2deg(v.roll),
    fov: v.fov, srcFov: v.srcFov, srcProj: v.srcProj, dispProj: v.dispProj,
    shiftX: v.shift.x, shiftY: v.shift.y,
  })

  const fromOverlay = (o) => ({
    pitch: deg2rad(o.pitch), yaw: deg2rad(o.yaw), roll: deg2rad(o.roll),
    shift: { x: o.shiftX, y: o.shiftY },
    fov: o.fov, srcFov: o.srcFov, srcProj: o.srcProj, dispProj: o.dispProj,
  })

  // カメラ・コントロール切替
  useEffect(() => {
    modeRef.current = mode
    if (!planeRef.current || !cameraRef.current || !controlsRef.current) return

    const camera   = cameraRef.current
    const controls = controlsRef.current

    const mount = mountRef.current
    if (mount) {
      camera.aspect = mount.clientWidth / mount.clientHeight
      rendererRef.current?.setSize(mount.clientWidth, mount.clientHeight)
    }

    if (mode === 'vr') {
      // VRはシェーダ側で投影するため PerspectiveCamera は使わない。
      // セッション中の頭の向きを維持して復帰する。
      controls.enabled = false
      syncVrSizeRef.current?.()
      syncVrView()
    } else if (mode === 'free') {
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

  // VR始点（SBSのどの半分を使うか）の切替。
  // 平面モードは同じテクスチャを等倍で使うため、texture.repeat/offset は
  // 触らず、切り出しはVRシェーダの uniform 側だけで行う。
  useEffect(() => {
    vrStartRef.current = vrStart
    const u = vrUniformsRef.current
    if (!u) return
    const { repeat, offset } = VR_START[vrStart]
    u.uSrcRepeat.value.set(...repeat)
    u.uSrcOffset.value.set(...offset)
    syncVrSizeRef.current?.()
    requestRenderRef.current?.()
  }, [mode, vrStart])

  // VRモード: 右ドラッグで平行移動、中ドラッグで首振り、ホイールで画角。
  // 右＝平行移動 / ホイール＝寄る引く は free モードと揃えてある。
  useEffect(() => {
    if (mode !== 'vr') return
    const canvas = mountRef.current?.querySelector('canvas')
    if (!canvas) return

    let startX = 0, startY = 0, drag = null   // 'shift' | 'look' | null

    const onPointerDown = (e) => {
      const kind = e.button === 2 ? 'shift' : e.button === 1 ? 'look' : null
      if (!kind) return
      startX = e.clientX; startY = e.clientY; drag = kind
      canvas.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    const onPointerMove = (e) => {
      if (!drag) return
      const dx = e.clientX - startX, dy = e.clientY - startY
      startX = e.clientX; startY = e.clientY

      if (drag === 'shift') {
        // uShift は「1.0 = ウィンドウの半分」。画面座標を同じ単位へ直すと
        // 映像がカーソルに1:1で追従する。uShift.y は上が正なので dy は反転。
        const { width, height } = canvas.getBoundingClientRect()
        const cur = vrShiftRef.current
        vrShiftRef.current = {
          x: clamp(cur.x + (2 * dx) / width,  -VR_SHIFT_LIMIT, VR_SHIFT_LIMIT),
          y: clamp(cur.y - (2 * dy) / height, -VR_SHIFT_LIMIT, VR_SHIFT_LIMIT),
        }
      } else {
        const sensitivity = vrSensitivityRef.current
        // 向きは ref に保持し、モード切替やスライダー調整と整合させる
        vrYawRef.current   -= dx * sensitivity
        vrPitchRef.current  = clamp(vrPitchRef.current - dy * sensitivity, -Math.PI / 2, Math.PI / 2)
      }
      syncVrView()
    }
    const onPointerUp = () => { drag = null }

    // 中ボタンの既定動作（オートスクロール）を抑止する
    const onAuxClick = (e) => { if (e.button === 1) e.preventDefault() }

    const onWheel = (e) => {
      e.preventDefault()
      vrFovRef.current = clamp(vrFovRef.current + e.deltaY * vrScrollSpeedRef.current, 20, 100)
      syncVrView()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('auxclick', onAuxClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('auxclick', onAuxClick)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [mode])

  // 現在の視点・投影設定を既定として保存する。
  // 他のVR設定（感度等）は保存済みの値を維持する。
  const persistVRView = async () => {
    const v = currentVrView()
    vrDefaultsRef.current = v
    const s = await GetSettings()
    UpdateVRSettings({
      ...s.vr,
      initialPitch:      rad2deg(v.pitch),
      initialYaw:        rad2deg(v.yaw),
      initialRoll:       rad2deg(v.roll),
      fov:               v.fov,
      sourceFov:         v.srcFov,
      sourceProjection:  v.srcProj,
      displayProjection: v.dispProj,
      shiftX:            v.shift.x,
      shiftY:            v.shift.y,
    })
  }

  // VR視点オーバーレイを開く。スライダーへ現在値を反映する。
  const openVrOverlay = () => {
    setVrView(toOverlay(currentVrView()))
    setStartOpen(true)
  }

  // オーバーレイの変更を即時反映する
  const applyVrView = (next) => {
    setVrView(next)
    restoreVrView(fromOverlay(next))
  }

  // 範囲の解除・初期化は SeekBarArea 側の effect が行う
  const resetRangeLoop = () => setRangeLoop(false)

  // play() は自動再生ポリシー等で拒否されることがある。
  // 拒否時は楽観的に false にした paused 状態を停止へ戻す。
  //
  // 特に Linux の WebKitGTK はミュートしていないメディアの自動再生に
  // ユーザー操作を要求するため、ファイルを開いた直後の play() は
  // NotAllowedError で必ず拒否される（Wails v3 alpha2.114 時点で
  // EnableAutoplayWithoutUserAction は darwin/iOS 専用でLinuxには無い）。
  // この場合クリック等の操作で再生できるので、停止状態に戻すだけでよい。
  const safePlay = (video) => {
    video.play().catch((err) => {
      lastPlayErrorRef.current = `${err?.name || 'Error'}: ${err?.message || err}`
      console.warn('video.play() rejected:', err)
      setPaused(true)
    })
  }

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('video/')) return
    const video = videoRef.current
    // Three.js の初期化に失敗している場合は video 要素が存在しない。
    // ここで例外にせず、初期化失敗のエラー表示をそのまま残す。
    if (!video) return
    const url   = URL.createObjectURL(file)
    // 前のファイルの Object URL を解放（Blob 参照のリーク防止）
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = url
    setVideoError(null)
    thumbCacheRef.current = null
    video.src = url
    if (thumbEnabledRef.current && thumbVideoRef.current) thumbVideoRef.current.src = url
    safePlay(video)
    setPaused(false)
    setFileName(file.name)
    // Blob 経由なのでローカルパスが無く、Go 側で切り出せない
    filePathRef.current = ''
    setCanExtract(false)
    resetRangeLoop()
  }

  const loadFilePath = (fileUrl) => {
    if (!fileUrl) return
    const video = videoRef.current
    if (!video) return
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setVideoError(null)
    thumbCacheRef.current = null
    video.src = fileUrl
    if (thumbEnabledRef.current && thumbVideoRef.current) thumbVideoRef.current.src = fileUrl
    safePlay(video)
    setPaused(false)
    const filePath = new URL(fileUrl).searchParams.get('path') ?? ''
    setFileName(filePath.split(/[\\/]/).pop())
    filePathRef.current = filePath
    setCanExtract(false)
    if (filePath) CanExtract(filePath).then(setCanExtract)
    resetRangeLoop()
  }

  // 操作系設定を ref に反映する。起動時と設定ダイアログ保存時の両方から呼ばれる。
  const applyControlSettings = (c) => {
    clickTimeoutMsRef.current   = c.clickTimeoutMs
    doubleClickSeekRef.current  = c.doubleClickSeekSecs
    dragSeekSecsRef.current     = c.dragSeekSecs
    fastSeekSecsRef.current     = c.fastSeekSecs
    arrowSeekSecsRef.current    = c.arrowSeekSecs
    thumbGridSizeRef.current    = c.thumbnailGridSize
    uiHideDelayRef.current      = c.uiHideDelayMs
    uiHideLeaveDelayRef.current = c.uiHideOnLeaveDelayMs
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
      applyControlSettings(s.controls)
      // VR設定と起動時モードを反映
      vrSensitivityRef.current = s.vr.dragSensitivity
      vrScrollSpeedRef.current = s.vr.scrollSpeed
      const saved = {
        pitch:    deg2rad(s.vr.initialPitch),
        yaw:      deg2rad(s.vr.initialYaw),
        roll:     deg2rad(s.vr.initialRoll),
        shift:    { x: s.vr.shiftX, y: s.vr.shiftY },
        fov:      s.vr.fov,
        srcFov:   s.vr.sourceFov,
        srcProj:  s.vr.sourceProjection,
        dispProj: s.vr.displayProjection,
      }
      vrDefaultsRef.current = saved
      restoreVrView(saved)
      setVrView(toOverlay(saved))
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
      // ドロップ経由の場合、Linux では DOM の drop/dragleave が来ず
      // ドロップ表示が消えないため、ここで確実に解除する
      clearTimeout(dragTimer.current)
      dragTimer.current = null
      dragCounter.current = 0
      setDragging(false)
      settingsReady.then(() => loadFilePath(event.data))
    })
    return () => {
      unsub()
      clearTimeout(dragTimer.current)
    }
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

  // 診断オーバーレイの開閉。Three.js の初期化が失敗していても使えるよう、
  // video 要素に依存しない独立した effect にしている。
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault()
        setDiagOpen(o => !o)
      } else if (e.key === 'Escape') {
        setDiagOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    let frameSeeking = false
    let frameSeekTimer = 0
    // seeked を待つラッチ。解除されないままだと以後のコマ送り/戻しが
    // すべて無視されるため、読み込み直しやエラーでも必ず解除する。
    const clearFrameSeek = () => {
      frameSeeking = false
      clearTimeout(frameSeekTimer)
    }
    const video = videoRef.current
    video?.addEventListener('seeked', clearFrameSeek)
    video?.addEventListener('emptied', clearFrameSeek)
    video?.addEventListener('error', clearFrameSeek)

    const onKeyDown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (!video?.src) return
      e.preventDefault()
      const forward = e.key === 'ArrowRight'
      if (video.paused) {
        if (frameSeeking) return
        // メタデータ未取得だと duration が NaN。代入しても seeked は来ない
        if (!Number.isFinite(video.duration)) return
        const fps = detectedFpsRef.current > 1 ? detectedFpsRef.current : 30
        const step = 1 / fps
        const target = Math.max(0, Math.min(video.duration, video.currentTime + (forward ? step : -step)))
        // 先頭/終端でクランプされると currentTime が変化せず seeked が飛ばない。
        // ここでラッチすると復帰不能になるので、シーク自体を行わない。
        if (Math.abs(target - video.currentTime) < 1e-6) return
        frameSeeking = true
        // seeked が届かない状況への保険。ラッチが永久に残るのを防ぐ
        frameSeekTimer = setTimeout(() => { frameSeeking = false }, 1000)
        // シークで timeupdate が発火し、SeekBarArea 等が追従する
        video.currentTime = target
      } else {
        if (e.repeat) return
        doZoneSeek(arrowSeekSecsRef.current, forward)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(frameSeekTimer)
      video?.removeEventListener('seeked', clearFrameSeek)
      video?.removeEventListener('emptied', clearFrameSeek)
      video?.removeEventListener('error', clearFrameSeek)
    }
  }, [])

  const handleFileChange = (e) => loadFile(e.target.files[0])

  // ドラッグ表示の解除は dragleave だけに頼れない。
  // Linux(WebKitGTK)/macOS では relatedTarget=null の dragleave が即座に飛んでくるので
  // 数えるとカウンタが狂い、Windows ではウィンドウ外へ抜けたときの dragleave も
  // relatedTarget=null なので無視すると表示が残り続ける。
  // dragover はドラッグ中ずっと（静止していても）発火し続けるため、
  // 一定時間 dragover が来なくなったら「通り過ぎた」とみなして解除する。
  const clearDragWatchdog = () => {
    clearTimeout(dragTimer.current)
    dragTimer.current = null
  }
  const endDrag = () => {
    clearDragWatchdog()
    dragCounter.current = 0
    setDragging(false)
  }
  const armDragWatchdog = () => {
    clearTimeout(dragTimer.current)
    dragTimer.current = setTimeout(endDrag, 700)
  }
  const handleDragEnter = (e) => {
    e.preventDefault()
    dragCounter.current++
    setDragging(true)
    armDragWatchdog()
  }
  const handleDragLeave = (e) => {
    e.preventDefault()
    if (e.relatedTarget === null) {
      // ウィンドウ外かネイティブ横取りかを区別できないので、
      // ウォッチドッグに判定を委ねる（dragover が続けば表示は維持される）
      armDragWatchdog()
      return
    }
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) endDrag()
  }
  const handleDragOver = (e) => {
    e.preventDefault()
    if (dragging) armDragWatchdog()
  }

  // ファイルの読み込みは行わない。Wails がネイティブ側でドロップを横取りし、
  // Go の WindowFilesDropped → open-file イベントとして配送される。
  // Linux/macOS ではそもそも drop イベントが来ず、Windows でも
  // ランタイムが Go へ転送するため、ここで dataTransfer を読むと二重読み込みになる。
  const handleDrop = (e) => {
    e.preventDefault()
    endDrag()
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
    // 押し込み待機中に動かした場合はドラッグ（視点操作）とみなして表示を取り消す。
    // 「ぐっと押し込んでほぼ動かさない」ときだけコントローラーを出す。
    if (holdOriginRef.current) {
      const o = holdOriginRef.current
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > HOLD_MOVE_TOLERANCE) {
        clearTimeout(holdTimerRef.current)
        holdOriginRef.current = null
        wasHoldRef.current = true   // ドラッグ終了時のクリック（再生/一時停止）も抑止する
      }
    }
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
        startZoneSeek(dragSeekSecsRef.current, true)
      } else if (dx < -75) {
        startZoneSeek(fastSeekSecsRef.current, false)
      } else if (dx < -20) {
        startZoneSeek(dragSeekSecsRef.current, false)
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
      // 保存済みの既定へ全項目を戻す。向き・平行移動・画角だけでなく
      // 素材／表示の投影方式も含める（保存が全項目を焼くので対称にする）。
      restoreVrView(vrDefaultsRef.current)
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
    // 前回のジェスチャで click が来ないまま残った抑止フラグを引きずらない
    wasHoldRef.current = false
    const pos = { x: e.clientX, y: e.clientY }
    const now = Date.now()
    const isDouble = e.detail >= 2 || (now - lastPointerDownTimeRef.current) <= clickTimeoutMsRef.current
    lastPointerDownTimeRef.current = isDouble ? 0 : now

    // 画面中央（x > cx で前方向）を境にダブルクリックシークの方向を決める
    const cx = window.innerWidth / 2

    if (isDouble) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      doZoneSeek(doubleClickSeekRef.current, pos.x > cx)
    }

    clearTimeout(holdTimerRef.current)
    holdOriginRef.current = pos
    holdTimerRef.current = setTimeout(() => {
      // 表示後は移動量でゾーン（早送り/巻き戻し）を選ぶので判定を解除する
      holdOriginRef.current = null
      wasHoldRef.current = true
      isMouseHeldRef.current = true
      seekOverlayRef.current = pos
      setSeekOverlay(pos)
    }, 400)
  }

  const handleCanvasMouseUp = () => {
    clearTimeout(holdTimerRef.current)
    holdOriginRef.current = null
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

  // 範囲ループのマーカー区間を無劣化で切り出す。実処理は Go 側（mp4cut）。
  // 保存先はネイティブの保存ダイアログで選ばせる（別フォルダにも出せるようにするため）。
  // 開始点は直前のキーフレームまで戻るため、結果の実範囲を通知に出す。
  const handleExtract = async () => {
    const path  = filePathRef.current
    // ダイアログを開いた時点の範囲で固定する（待っている間にマーカーが動いても影響させない）
    const range = rangeRef.current ? { ...rangeRef.current } : null
    if (!canExtract || !path || !range || extracting) return
    if (range.end - range.start < 0.1) {
      setExtractMsg({ severity: 'warning', text: t('extract.rangeTooShort') })
      return
    }
    try {
      const target = await SuggestExtractTarget(path, range.start, range.end)
      const dst = await Dialogs.SaveFile({
        Title: t('extract.title'),
        Filename: target.fileName,
        Directory: target.dir,
        Filters: [{ DisplayName: t('extract.filterName'), Pattern: '*.mp4;*.m4v;*.mov' }],
        ButtonText: t('extract.run'),
      })
      if (!dst) return   // キャンセル
      setExtracting(true)
      setExtractMsg({ severity: 'info', text: t('extract.running'), busy: true })
      const res = await ExtractRange(path, range.start, range.end, dst)
      setExtractMsg({
        severity: 'success',
        text: t('extract.done', { name: res.fileName, start: fmt(res.startSec), end: fmt(res.endSec) }),
      })
    } catch (err) {
      console.error('extract failed:', err)
      setExtractMsg({ severity: 'error', text: t('extract.failed', { msg: err?.message ?? String(err) }) })
    } finally {
      setExtracting(false)
    }
  }

  const handleThumbGridToggle = () => {
    const video = videoRef.current
    if (!video?.src || !video.duration) return
    setThumbGridOpen(o => !o)
  }

  const handleThumbGridSeek = (time) => {
    const video = videoRef.current
    if (video?.src) video.currentTime = time
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
    if (v !== 'normal') setThumbGridOpen(false)
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

  // サムネイル一覧キャッシュのキー（動画src・分割数・回転が一致すれば再利用）
  const thumbCacheKey = `${videoRef.current?.src ?? ''}|${thumbGridSizeRef.current}|${rotation}`
  const cachedThumbs  = thumbCacheRef.current?.key === thumbCacheKey ? thumbCacheRef.current.thumbs : null
  // 表示用アスペクト比（回転で縦横入れ替わる）
  const thumbVw = videoRef.current?.videoWidth  || 0
  const thumbVh = videoRef.current?.videoHeight || 0
  const thumbAspect = thumbVw && thumbVh ? (rotation % 180 ? thumbVh / thumbVw : thumbVw / thumbVh) : 16 / 9

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
          dragSeekSecs={dragSeekSecsRef.current}
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
        rangeRef={rangeRef}
      />

      {/* 切り出しの進行中／結果通知。busy の間は自分では閉じない */}
      <Snackbar
        open={!!extractMsg}
        autoHideDuration={extractMsg?.busy ? null : extractMsg?.severity === 'error' ? 8000 : 5000}
        onClose={() => setExtractMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 120, sm: 120 } }}
      >
        <Alert
          severity={extractMsg?.severity ?? 'info'}
          variant="filled"
          icon={extractMsg?.busy ? <CircularProgress size={18} color="inherit" /> : undefined}
          onClose={extractMsg?.busy ? undefined : () => setExtractMsg(null)}
          sx={{ maxWidth: '70vw' }}
        >
          {extractMsg?.text}
        </Alert>
      </Snackbar>

      {/* 右サイドパネル（切り出し・スナップショット） */}
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
        {/* 範囲切り出し。範囲ループのマーカーを in/out 点として使うため、
            範囲ループが有効なときだけ押せる */}
        <Tooltip
          title={!canExtract ? t('controls.extractUnsupported')
            : !rangeLoop     ? t('controls.extractNeedsRange')
            : (
              <>
                {t('controls.extract')}
                {/* キーフレーム単位でしか切れないことは押す直前に伝えないと
                    「指定した位置と違う」という驚きになる */}
                <Box component="span" sx={{ display: 'block', mt: 0.5, opacity: 0.75 }}>
                  {t('controls.extractKeyframeNote')}
                </Box>
              </>
            )}
          placement="left"
        >
          <span>
            <IconButton
              onClick={handleExtract}
              disabled={!canExtract || !rangeLoop || extracting}
              sx={{ color: 'white', width: 56, height: 56, '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' } }}
            >
              {extracting
                ? <CircularProgress size={30} sx={{ color: activeColor }} />
                : <ContentCutIcon sx={{ fontSize: 36 }} />
              }
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('controls.snapshot')} placement="left">
          <IconButton onClick={handleSnapshot} sx={{ color: 'white', width: 56, height: 56 }}>
            <CameraAltIcon sx={{ fontSize: 40 }} />
          </IconButton>
        </Tooltip>
        {mode === 'normal' && (
          <Tooltip title={t('controls.thumbnailGrid')} placement="left">
            <IconButton onClick={handleThumbGridToggle} sx={{ color: 'white', width: 56, height: 56 }}>
              <GridViewIcon sx={{ fontSize: 36 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip
          title={mode === 'vr' ? t('controls.resetCamera') : mode === 'normal' ? t('controls.fitWindow') : t('controls.resetView')}
          placement="left"
        >
          <IconButton onClick={handleReset} sx={{ color: 'white', width: 56, height: 56 }}>
            <FitScreenIcon sx={{ fontSize: 40 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {thumbGridOpen && mode === 'normal' && (
        <ThumbnailGrid
          src={videoRef.current?.src}
          duration={duration}
          rotation={rotation}
          gridSize={thumbGridSizeRef.current}
          aspect={thumbAspect}
          activeColor={activeColor}
          initialThumbs={cachedThumbs}
          onSeek={handleThumbGridSeek}
          onClose={() => setThumbGridOpen(false)}
          onComplete={(thumbs) => { thumbCacheRef.current = { key: thumbCacheKey, thumbs } }}
        />
      )}

      {diagOpen && (
        <DiagnosticsOverlay
          videoRef={videoRef}
          rendererRef={rendererRef}
          frameCountRef={frameCountRef}
          renderCountRef={renderCountRef}
          renderPathRef={renderPathRef}
          lastPlayErrorRef={lastPlayErrorRef}
          onClose={() => setDiagOpen(false)}
        />
      )}

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
        onControlsChange={applyControlSettings}
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
