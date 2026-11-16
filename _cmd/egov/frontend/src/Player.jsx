import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Alert, Box, CircularProgress, IconButton, Snackbar, Tooltip } from '@mui/material'
import CameraAltIcon from '@mui/icons-material/CameraAlt'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import GridViewIcon from '@mui/icons-material/GridView'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import { Dialogs, Events, Window } from '@wailsio/runtime'
import { CanExtract, CloseAnimation, DetectVRFormat, MediaFilePattern, OpenAnimation, OpenLocalFile, ExtractRange, SuggestExtractTarget, GetInitialFile, GetServerURL, GetSettings, UpdateAlwaysOnTop, UpdatePlaybackSettings } from '../bindings/egov/api'
import { useTranslation } from 'react-i18next'
import { loadLanguages } from './languages'
import SettingsDialog from './SettingsDialog'
import useThreeScene from './player/useThreeScene'
import useDropWatchdog from './player/useDropWatchdog'
import usePointerSeek from './player/usePointerSeek'
import useKeyboardShortcuts from './player/useKeyboardShortcuts'
import useVrView from './player/useVrView'
import AnimPlayer from './player/AnimPlayer'
import TitleBar from './player/TitleBar'
import ControlBar from './player/ControlBar'
import MiniProgressBar from './player/MiniProgressBar'
import ThumbnailGrid from './player/ThumbnailGrid'
import VrViewpointOverlay from './player/VrViewpointOverlay'
import DiagnosticsOverlay from './player/DiagnosticsOverlay'
import ZoomInset from './player/ZoomInset'
import { ClickFeedback, DropHint, EmptyState, SeekFeedback, SeekZoneOverlay, VideoErrorOverlay } from './player/Overlays'
import { barStyle, clamp, fmt, isImagePath, mayBeAnimatedPath } from './player/utils'

// 再生中のデコードエラーからの自動復旧。この時間内に RECOVER_MAX 回を超えて
// 落ちるならファイル側の問題とみなし、エラー表示（手動の読み込み直し）に任せる
const RECOVER_MAX       = 3
const RECOVER_WINDOW_MS = 60_000
// 同じ位置で続けて落ちたときに読み飛ばす秒数（回数ごとに増やす）
const RECOVER_SKIP_SECS = 2

// 設定を読み込むまでの暫定値（Go の defaultSettings() と同じ値）。
// 読み込み後は Go 側で正規化済みの値で丸ごと置き換わる
const INITIAL_CONTROLS = {
  clickTimeoutMs: 300, doubleClickSeekSecs: 10, dragSeekSecs: 10,
  fastSeekSecs: 60, arrowSeekSecs: 5, thumbnailGridSize: 4,
  uiHideDelayMs: 1500, uiHideOnLeaveDelayMs: 800,
}
const INITIAL_VR_INPUT = { dragSensitivity: 0.004, scrollSpeed: 0.05 }

// プレイヤー本体。状態・設定・入力処理のオーケストレーターとして働き、
// 描画は useThreeScene（Three.jsシーン）と player/ 以下の各コンポーネントに委譲する。
export default function Player() {
  const { t } = useTranslation()
  const modeRef      = useRef('normal')
  const hideTimer    = useRef(null)
  const thumbVideoRef   = useRef(null)
  const thumbCanvasRef  = useRef(null)
  const thumbEnabledRef = useRef(true)
  const thumbCacheRef   = useRef(null)   // { key, thumbs } 同一動画・分割数・回転のサムネイル一覧キャッシュ
  const loadSeqRef      = useRef(0)     // 形式推定の応答が前のファイルのものでないかの判定用
  // 設定の写し。一度だけ登録するリスナーからも最新の値を読めるよう ref に持つ。
  // 項目ごとに分けず、設定の形のまま丸ごと差し替える（applyControlSettings など）
  const controlSettingsRef = useRef(INITIAL_CONTROLS)    // settings.controls
  const vrInputRef         = useRef(INITIAL_VR_INPUT)    // settings.vr の dragSensitivity / scrollSpeed
  const appSettingsRef     = useRef({ acceptInactiveClick: false })   // settings.app
  const lastPlayErrorRef    = useRef(null)   // 直近の play() 拒否理由（診断用）
  const filePathRef         = useRef('')     // 再生中ファイルのローカルパス（切り出し元）
  const rangeRef            = useRef(null)   // SeekBarArea が公開する { start, end }
  const mediaKindRef        = useRef('video')   // 'video' | 'image' | 'anim'（アニメーション画像）
  const animRef             = useRef(null)   // 再生中の AnimPlayer
  const thumbHoverRef       = useRef(true)   // シークバーのホバーサムネイルを出すか（設定 ON かつ本物の動画）
  const zoomInsetStateRef   = useRef(null)   // 小窓ズームの位置と切り抜く範囲（VR を挟んでも保つ）
  // デコードエラーからの復旧状態（reloadMedia）。ファイルを開くたびに作り直す
  //   loaded   … このファイルで一度でもフレームが出たか（出ていなければ復旧しない）
  //   attempts / at … 直近の自動復旧の回数と時刻
  //   failPos  … 前回落ちた再生位置（同じ所で落ち続けるなら読み飛ばす）
  //   resumeAt … 読み込み直し中の再開位置。読み込み直しの途中で再び落ちたときに使う
  //   onMeta   … 読み込み直し後に位置を戻す loadedmetadata のリスナー
  const newRecovery = () => ({ loaded: false, attempts: 0, at: 0, failPos: -1, resumeAt: null, onMeta: null })
  const recoveryRef         = useRef(newRecovery())
  const reloadMediaRef      = useRef(null)
  const [miniProgress, setMiniProgress] = useState(false)

  const [paused,      setPaused]      = useState(true)
  const [duration,    setDuration]    = useState(0)
  const [videoEl,     setVideoEl]     = useState(null)   // 子コンポーネントが timeupdate を購読するため
  const [volume,      setVolume]      = useState(0.5)
  const [muted,       setMuted]       = useState(false)
  const [fileName,    setFileName]    = useState('')
  const [showUI,      setShowUI]      = useState(false)
  const [resizeCursor, setResizeCursor] = useState(null)   // Wails3リサイズ判定領域内で明示すべきカーソル種別
  const [mode,        setMode]        = useState('normal')   // normal=ウィンドウフィット / free=自由パン・ズーム / vr
  const [thumbEnabled, setThumbEnabled] = useState(true)
  const [language,     setLanguage]     = useState('en')
  const [availableLangs, setAvailableLangs] = useState([])
  const [serverUrl,      setServerUrl]      = useState('')
  const [settingsOpen,   setSettingsOpen]   = useState(false)
  const [activeColor,    setActiveColor]    = useState('#4fc3f7')
  const [alwaysOnTop,    setAlwaysOnTop]    = useState(false)
  const [fullscreen,     setFullscreen]     = useState(false)
  const [loop,           setLoop]           = useState(true)
  const [videoError,     setVideoError]     = useState(null)
  const [rangeLoop,      setRangeLoop]      = useState(false)
  const [rotation,       setRotation]       = useState(0)
  const [thumbGridOpen,  setThumbGridOpen]  = useState(false)
  const [diagOpen,       setDiagOpen]       = useState(false)   // Ctrl+Shift+D の診断オーバーレイ
  const [canExtract,     setCanExtract]     = useState(false)   // 無劣化切り出しが可能なコンテナか
  const [extracting,     setExtracting]     = useState(false)
  const [notice,         setNotice]         = useState(null)    // Snackbar 通知 { severity, text, busy? }
  const [isImage,        setIsImage]        = useState(false)   // 静止画を表示中か（VR・再生系UIを無効にする）
  const [isAnim,         setIsAnim]         = useState(false)   // アニメーション画像を再生中か（VR・サムネイル系を無効にする）
  const [zoomInset,      setZoomInset]      = useState(false)   // 小窓ズーム（normal / free のみ）
  const [zoomLook,       setZoomLook]       = useState({ border: false, feather: 0.12 })   // 小窓ズームの見た目（settings.zoomInset）

  // video 要素のエラー。useThreeScene はマウント時の関数を持ち続けるので、
  // 安定参照にして最新の reloadMedia へは ref 経由で届ける
  const [handleSceneError] = useState(() => (msg) => {
    if (reloadMediaRef.current?.(false)) return
    setVideoError(msg)
  })

  // Three.js シーン（生成・破棄・描画ループはフック側が担う）
  const {
    mountRef, videoRef, cameraRef, controlsRef, planeRef,
    textureRef, fitCameraRef, rendererRef,
    vrUniformsRef, syncVrSizeRef,
    requestRenderRef, captureRef, detectedFpsRef,
    frameCountRef, renderCountRef, renderPathRef,
    showImageRef, showVideoRef, showCanvasRef, refreshCanvasRef, mediaSizeRef,
    videoElRef, planePassRef,
  } = useThreeScene({
    modeRef,
    onDuration: setDuration,
    onVideoEl: setVideoEl,
    onVideoError: handleSceneError,
  })

  const { dragging, endDrag, dropHandlers } = useDropWatchdog()

  // 映像の上のクリック・ダブルクリック・長押しシーク。handlePlayPause は下で定義するので
  // 呼ぶ時点で解決する
  const pointerSeek = usePointerSeek({
    videoRef, controlSettingsRef, appSettingsRef,
    onPlayPause: () => handlePlayPause(),
  })
  const { doZoneSeek } = pointerSeek

  useKeyboardShortcuts({ videoRef, videoElRef, detectedFpsRef, controlSettingsRef, doZoneSeek, setDiagOpen })

  // VR の視点・保存・リセット・オーバーレイ・マウス操作
  const vr = useVrView({ mode, mountRef, vrUniformsRef, syncVrSizeRef, requestRenderRef, vrInputRef })
  const { vrStart, syncVrView } = vr

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

  // 再生途中のデコードエラーから復旧する。返り値 true = 読み込み直した（エラーは出さない）。
  //
  // 負荷が高いときなどに途中でデコーダが落ちると（MEDIA_ERR_DECODE）、video 要素は
  // エラー状態のまま固まり、以後の play() もシークも一切効かなくなる。
  // 同じ src で load() し直し、落ちた位置から再開する。
  // manual=true はエラー表示のボタンや再生操作から。回数制限を外して必ず読み直す。
  const reloadMedia = (manual) => {
    const video = videoElRef.current
    const r = recoveryRef.current
    if (!video || mediaKindRef.current !== 'video' || !video.getAttribute('src')) return false

    // 読み込み直しの途中で落ちた場合は currentTime が 0 に戻っているので、目指していた位置を使う
    let pos = r.resumeAt ?? video.currentTime
    if (!Number.isFinite(pos)) pos = 0

    if (manual) {
      r.attempts = 0
    } else {
      const code = video.error?.code
      if (code !== MediaError.MEDIA_ERR_DECODE && code !== MediaError.MEDIA_ERR_NETWORK) return false
      // 一度も映せていないファイルは中身が壊れているか未対応なので、読み直しても同じ
      if (!r.loaded) return false
      const now = Date.now()
      if (now - r.at > RECOVER_WINDOW_MS) r.attempts = 0
      if (r.attempts >= RECOVER_MAX) return false
      r.attempts++
      r.at = now
      // 前回落ちた所から先へ進めていないならデータ自体が壊れている。少しずつ先へ読み飛ばす
      if (r.attempts > 1 && Math.abs(pos - r.failPos) < RECOVER_SKIP_SECS * r.attempts) {
        pos = r.failPos + RECOVER_SKIP_SECS * (r.attempts - 1)
      } else {
        r.failPos = pos
      }
    }
    if (Number.isFinite(video.duration)) pos = Math.min(pos, Math.max(0, video.duration - 0.5))

    // 手動のときは再生を望んでいるとみなす。自動のときは落ちる前の状態に戻す
    const resumePlay = manual || !video.paused
    const seq = loadSeqRef.current
    if (r.onMeta) video.removeEventListener('loadedmetadata', r.onMeta)
    r.resumeAt = pos
    r.onMeta = () => {
      r.onMeta = null
      if (seq !== loadSeqRef.current) return   // 待っている間に別のファイルが開かれた
      r.resumeAt = null
      video.currentTime = pos
      if (resumePlay) { safePlay(video); setPaused(false) }
      else            setPaused(true)
    }
    video.addEventListener('loadedmetadata', r.onMeta, { once: true })
    video.load()
    setVideoError(null)
    if (!manual) setNotice({ severity: 'info', text: t('error.recovered') })
    return true
  }
  reloadMediaRef.current = reloadMedia

  // ファイルから素材の形式（始点・投影方式・画角）を推定し、VR の既定へ重ねる（useVrView.applySourceFormat）
  const applyDetectedFormat = async (pathOrName, seq) => {
    let f = {}
    try {
      f = await DetectVRFormat(pathOrName) ?? {}
    } catch (err) {
      console.warn('DetectVRFormat failed:', err)
    }
    if (seq !== loadSeqRef.current) return
    vr.applySourceFormat(f)
  }

  // 動画・画像の読み込みの共通部分。
  // 画像のときは video 要素を空にする。以後の再生・シーク・コマ送り・サムネイルは
  // すべて video.src の有無で早期 return するので、個別に分岐しなくて済む。
  //
  // アニメーション画像（WebP / GIF / APNG）は Go 側で全フレームを展開し、AnimPlayer（video 要素と同じ
  // インターフェース）を videoRef.current に差し替えて動画として扱う。
  const openMedia = async ({ url, name, path, image }) => {
    const video = videoElRef.current
    // Three.js の初期化に失敗している場合は video 要素が存在しない。
    // ここで例外にせず、初期化失敗のエラー表示をそのまま残す。
    if (!video) return
    const seq = ++loadSeqRef.current

    let anim = null
    if (image && path && mayBeAnimatedPath(path)) {
      try {
        const info = await OpenAnimation(path)
        if (info?.animated) anim = info
        // アニメーション AVIF は中身が MP4 と同じ構造で、video 要素がそのまま再生できる
        if (info?.asVideo) image = false
      } catch (err) {
        console.warn('OpenAnimation failed:', err)
        setNotice({ severity: 'warning', text: t('anim.fallback', { msg: err?.message ?? String(err) }) })
      }
      if (seq !== loadSeqRef.current) return
    } else if (mediaKindRef.current === 'anim') {
      CloseAnimation()   // 展開済みフレームを解放する
    }
    const kind = anim ? 'anim' : image ? 'image' : 'video'

    animRef.current?.dispose()
    animRef.current = null
    if (recoveryRef.current.onMeta) video.removeEventListener('loadedmetadata', recoveryRef.current.onMeta)
    recoveryRef.current = newRecovery()
    mediaKindRef.current = kind
    thumbHoverRef.current = thumbEnabledRef.current && kind === 'video'
    setVideoError(null)
    thumbCacheRef.current = null
    setFileName(name)
    filePathRef.current = path
    setCanExtract(false)
    setIsImage(kind === 'image')
    setIsAnim(kind === 'anim')
    resetRangeLoop()

    if (kind !== 'video') {
      video.pause()
      video.removeAttribute('src')
      video.load()
      const thumb = thumbVideoRef.current
      if (thumb?.getAttribute('src')) {
        thumb.removeAttribute('src')
        thumb.load()
      }
      setThumbGridOpen(false)
      // 画像・アニメーションは VR に対応しない（VRシェーダは VideoTexture 前提）
      setMode(m => (m === 'vr' ? 'normal' : m))
    }

    if (kind === 'anim') {
      const u = new URL(url)
      const token = u.searchParams.get('token')
      const player = new AnimPlayer({
        info: anim,
        src: url,
        loop: video.loop,   // ループ設定は video 要素側にも揃えて持っている（handleLoopToggle）
        frameUrl: (i) => `${u.origin}/animframe?token=${encodeURIComponent(token)}&id=${anim.id}&i=${i}`,
        onFrame: () => refreshCanvasRef.current?.(),
        onError: setVideoError,
      })
      animRef.current  = player
      videoRef.current = player
      setVideoEl(player)
      showCanvasRef.current?.(player.canvas)
      setDuration(player.duration)
      safePlay(player)
      setPaused(false)
      return
    }

    videoRef.current = video
    setVideoEl(video)

    if (kind === 'image') {
      setPaused(true)
      setDuration(0)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = url
      img.decode().then(
        () => { if (seq === loadSeqRef.current) showImageRef.current?.(img) },
        () => { if (seq === loadSeqRef.current) setVideoError('IMAGE_DECODE_FAILED') },
      )
      return
    }

    showVideoRef.current?.()
    video.src = url
    if (thumbEnabledRef.current && thumbVideoRef.current) thumbVideoRef.current.src = url
    safePlay(video)
    setPaused(false)
    if (path) CanExtract(path).then(setCanExtract)
    applyDetectedFormat(path || name, seq)
  }

  // ファイル選択ダイアログ。<input type="file"> はブラウザの制約でパスが取れず
  // （中身の Blob しか渡らない）、アニメーション画像の展開・無劣化切り出し・
  // VR形式の推定といった Go 側の処理ができないため、Wails のダイアログでパスを受け取る。
  // 見た目はどちらも OS 標準のダイアログ。
  const handleOpenFile = async () => {
    try {
      const path = await Dialogs.OpenFile({
        Title: t('menu.openFile'),
        Filters: [{ DisplayName: t('menu.mediaFiles'), Pattern: await MediaFilePattern() }],
        CanChooseFiles: true,
      })
      if (!path) return   // キャンセル
      loadFilePath(await OpenLocalFile(path))
    } catch (err) {
      console.error('open file failed:', err)
      setNotice({ severity: 'error', text: t('menu.openFailed', { msg: err?.message ?? String(err) }) })
    }
  }

  const loadFilePath = (fileUrl) => {
    if (!fileUrl) return
    if (!videoRef.current) return
    const filePath = new URL(fileUrl).searchParams.get('path') ?? ''
    openMedia({
      url: fileUrl,
      name: filePath.split(/[\\/]/).pop(),
      path: filePath,
      image: isImagePath(filePath),
    })
  }

  // 操作系設定を ref に反映する。起動時と設定ダイアログ保存時の両方から呼ばれる。
  const applyControlSettings = (c) => { controlSettingsRef.current = c }

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
      appSettingsRef.current = s.app
      applyControlSettings(s.controls)
      // VR設定と起動時モードを反映
      vrInputRef.current = { dragSensitivity: s.vr.dragSensitivity, scrollSpeed: s.vr.scrollSpeed }
      vr.loadSavedVrView(s.vr)
      setMode(p.defaultMode)
      setMiniProgress(s.app.miniProgressBar)
      setZoomLook(s.zoomInset)
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
      endDrag()
      settingsReady.then(() => loadFilePath(event.data))
    })
    return unsub
  }, [])

  // 一度でもフレームが出たファイルだけをデコードエラーからの自動復旧の対象にする（reloadMedia）
  useEffect(() => {
    const video = videoElRef.current
    if (!video) return
    const onLoadedData = () => { recoveryRef.current.loaded = true }
    video.addEventListener('loadeddata', onLoadedData)
    return () => video.removeEventListener('loadeddata', onLoadedData)
  }, [])

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
      hideTimer.current = setTimeout(() => setShowUI(false), controlSettingsRef.current.uiHideDelayMs)
    }
    pointerSeek.onPointerMove(e)
  }

  const handleMouseLeave = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setShowUI(false), controlSettingsRef.current.uiHideOnLeaveDelayMs)
    pointerSeek.onPointerLeave()
    setResizeCursor(null)
  }

  const handlePlayPause = () => {
    const video = videoRef.current
    if (!video.src) return
    // エラーで固まった video 要素は play() が効かないので、読み込み直して再開する
    if (video.error && reloadMedia(true)) return
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

  // ウィンドウを素材の画素数（CSSピクセル）に合わせる。作業領域に収まらないときは
  // 縦横比を保ったまま収まる大きさへ縮め、何%表示になったかを通知する。
  // そのまま SetSize すると OS 側で片方の辺だけがクランプされ、
  // 「ウィンドウは画面いっぱいでも画像は余白付き」という中途半端な状態になる。
  const fitWindowToMedia = async (w, h) => {
    let wa = null
    try {
      wa = (await Window.GetScreen())?.WorkArea
    } catch (err) {
      console.warn('GetScreen failed:', err)
    }
    const scale = wa?.Width && wa?.Height ? Math.min(1, wa.Width / w, wa.Height / h) : 1
    const tw = Math.floor(w * scale)
    const th = Math.floor(h * scale)
    await Window.SetSize(tw, th)
    if (scale >= 1) return
    // 縮めても位置によっては画面外にはみ出すので作業領域の内側へ寄せる
    const pos = await Window.Position()
    await Window.SetPosition(
      clamp(pos.x, wa.X, wa.X + wa.Width  - tw),
      clamp(pos.y, wa.Y, wa.Y + wa.Height - th),
    )
    setNotice({ severity: 'info', text: t('controls.fitTooLarge', { percent: Math.floor(scale * 100) }) })
  }

  const handleReset = () => {
    const camera   = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return

    if (mode === 'vr') {
      vr.resetVrView()
    } else if (mode === 'normal') {
      const { w, h } = mediaSizeRef.current
      if (w && h) {
        if (rotation % 180) fitWindowToMedia(h, w)
        else                fitWindowToMedia(w, h)
      }
    } else {
      camera.position.set(0, 0, 9)
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()
    }
    requestRenderRef.current?.()
  }

  // VRは投影し直した「見えている画」を、平面モードは動画フレームそのものを保存する。
  // VRで元フレームを保存すると、正距円筒／魚眼の歪んだ半分がそのまま出てくるだけで、
  // 視点・画角・投影方式をどう合わせたかが一切残らない。
  const snapshotCanvas = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return null
    if (modeRef.current === 'vr') return captureRef.current?.() ?? null

    const vw = video.videoWidth, vh = video.videoHeight
    const rot = rotation
    const rotated = rot % 180 !== 0
    const dw = rotated ? vh : vw
    const dh = rotated ? vw : vh

    const c = document.createElement('canvas')
    c.width = dw; c.height = dh
    const ctx = c.getContext('2d')
    if (rot) {
      ctx.translate(dw / 2, dh / 2)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.translate(-vw / 2, -vh / 2)
    }
    // AnimPlayer は自前の canvas に現在のフレームを描いている
    ctx.drawImage(video.canvas ?? video, 0, 0, vw, vh, 0, 0, vw, vh)
    return c
  }

  const handleSnapshot = () => {
    const c = snapshotCanvas()
    if (!c) return

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
      setNotice({ severity: 'warning', text: t('extract.rangeTooShort') })
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
      setNotice({ severity: 'info', text: t('extract.running'), busy: true })
      const res = await ExtractRange(path, range.start, range.end, dst)
      setNotice({
        severity: 'success',
        text: t('extract.done', { name: res.fileName, start: fmt(res.startSec), end: fmt(res.endSec) }),
      })
    } catch (err) {
      console.error('extract failed:', err)
      setNotice({ severity: 'error', text: t('extract.failed', { msg: err?.message ?? String(err) }) })
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
    // 次に開く AnimPlayer はここから初期値を取るので、本物の video 要素にも持たせる
    if (videoElRef.current) videoElRef.current.loop = next
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
    if (v === 'vr' && (isImage || isAnim)) return
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
  const thumbCacheKey = `${videoRef.current?.src ?? ''}|${controlSettingsRef.current.thumbnailGridSize}|${rotation}`
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
      {...dropHandlers}
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
                position: 'relative',
                width: '100%', height: '100%',
                transform: mode === 'normal' && rotation ? `rotate(${rotation}deg)` : undefined,
              }),
          overflow: 'hidden',
          zIndex: 0,   // 小窓の zIndex を mount の中に閉じ込め、他のオーバーレイより上に出さない
        }}
        {...pointerSeek.canvasHandlers}
        onContextMenu={e => e.preventDefault()}
      >
        {/* normal モードの回転は mount ごと CSS で回すので、小窓も mount の中に置いて一緒に回す */}
        {zoomInset && mode !== 'vr' && fileName && (
          <ZoomInset
            stateRef={zoomInsetStateRef}
            mountRef={mountRef}
            planeRef={planeRef}
            planePassRef={planePassRef}
            requestRenderRef={requestRenderRef}
            cssRotation={mode === 'normal' ? rotation : 0}
            border={zoomLook.border}
            feather={zoomLook.feather}
          />
        )}
      </div>

      {pointerSeek.seekFeedback && (
        <SeekFeedback feedback={pointerSeek.seekFeedback} onDone={pointerSeek.clearSeekFeedback} />
      )}

      {pointerSeek.seekOverlay && (
        <SeekZoneOverlay
          overlay={pointerSeek.seekOverlay}
          active={pointerSeek.seekZoneActive}
          activeColor={activeColor}
          fastSeekSecs={controlSettingsRef.current.fastSeekSecs}
          dragSeekSecs={controlSettingsRef.current.dragSeekSecs}
        />
      )}

      {pointerSeek.clickFeedback && (
        <ClickFeedback feedback={pointerSeek.clickFeedback} onDone={pointerSeek.clearClickFeedback} />
      )}

      {videoError && (
        <VideoErrorOverlay
          error={videoError}
          image={isImage}
          onRetry={!isImage && !isAnim && videoElRef.current?.getAttribute('src') ? () => reloadMedia(true) : undefined}
        />
      )}

      {!fileName && <EmptyState resizeCursor={resizeCursor} onOpenFile={handleOpenFile} />}

      {dragging && <DropHint />}

      <video ref={thumbVideoRef} muted preload="metadata" crossOrigin="anonymous" style={{ display: 'none' }} />
      <canvas ref={thumbCanvasRef} style={{ display: 'none' }} />

      {vr.overlayOpen && (
        <VrViewpointOverlay
          onClose={vr.closeVrOverlay}
          vrStart={vrStart}
          onVrStartChange={vr.setVrStart}
          vrView={vr.vrView}
          onChange={vr.applyVrView}
          onCommit={vr.persistVRView}
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
        onOpenFile={handleOpenFile}
        onOpenVrOverlay={vr.openVrOverlay}
        vrDisabled={isImage || isAnim}
      />

      {/* ミニプログレスバー */}
      {miniProgress && !showUI && duration > 0 && (
        <MiniProgressBar video={videoEl} duration={duration} activeColor={activeColor} />
      )}

      <ControlBar
        showUI={showUI}
        image={isImage}
        silent={isAnim}
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
        filePath={filePathRef.current}
        fullscreen={fullscreen}
        onFullscreenToggle={handleFullscreenToggle}
        loop={loop}
        onLoopToggle={handleLoopToggle}
        rangeLoop={rangeLoop}
        onRangeLoopToggle={handleRangeLoopToggle}
        activeColor={activeColor}
        thumbVideoRef={thumbVideoRef}
        thumbCanvasRef={thumbCanvasRef}
        thumbEnabledRef={thumbHoverRef}
        modeRef={modeRef}
        vrStartRef={vr.vrStartRef}
        rangeRef={rangeRef}
      />

      {/* 切り出しの進行中／結果通知。busy の間は自分では閉じない */}
      <Snackbar
        open={!!notice}
        autoHideDuration={notice?.busy ? null : notice?.severity === 'error' ? 8000 : 5000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 120, sm: 120 } }}
      >
        <Alert
          severity={notice?.severity ?? 'info'}
          variant="filled"
          icon={notice?.busy ? <CircularProgress size={18} color="inherit" /> : undefined}
          onClose={notice?.busy ? undefined : () => setNotice(null)}
          sx={{ maxWidth: '70vw' }}
        >
          {notice?.text}
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
        {!isImage && (<>
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
        </>)}
        {mode !== 'vr' && fileName && (
          <Tooltip title={t('controls.zoomInset')} placement="left">
            <IconButton onClick={() => setZoomInset(z => !z)} sx={{ color: zoomInset ? activeColor : 'white', width: 56, height: 56 }}>
              <ZoomInIcon sx={{ fontSize: 40 }} />
            </IconButton>
          </Tooltip>
        )}
        {mode === 'normal' && !isImage && !isAnim && (
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
          gridSize={controlSettingsRef.current.thumbnailGridSize}
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
          videoRef={videoElRef}
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
        acceptInactiveClick={appSettingsRef.current.acceptInactiveClick}
        onAcceptInactiveClickChange={(next) => { appSettingsRef.current = { ...appSettingsRef.current, acceptInactiveClick: next } }}
        miniProgressBar={miniProgress}
        onMiniProgressBarChange={(next) => setMiniProgress(next)}
        onZoomInsetChange={setZoomLook}
        onControlsChange={applyControlSettings}
        thumbEnabled={thumbEnabled}
        onThumbEnabledChange={(next) => {
          setThumbEnabled(next)
          thumbEnabledRef.current = next
          thumbHoverRef.current = next && mediaKindRef.current === 'video'
          if (!next) {
            if (thumbVideoRef.current) thumbVideoRef.current.src = ''
          } else if (mediaKindRef.current === 'video' && videoRef.current?.src) {
            if (thumbVideoRef.current) thumbVideoRef.current.src = videoRef.current.src
          }
          UpdatePlaybackSettings(volume, muted, next, language)
        }}
      />
    </div>
  )
}
