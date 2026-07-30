import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { VR_RADIUS } from './utils'

// Three.js シーンの生成・破棄と描画ループを担うフック。
// マウント時に一度だけ初期化し、生成物は ref 経由で Player に公開する。
// モード切替や VR 視点操作などの「状態→シーン」反映は Player 側の
// effect が返却された ref を使って行う。
//
// onDuration / onVideoEl / onVideoError には setState 関数（安定参照）を渡すこと。
export default function useThreeScene({ modeRef, vrScrollSpeedRef, onDuration, onVideoEl, onVideoError }) {
  const mountRef       = useRef(null)
  const videoRef       = useRef(null)
  const cameraRef      = useRef(null)
  const controlsRef    = useRef(null)
  const sphereRef      = useRef(null)
  const planeRef       = useRef(null)
  const textureRef     = useRef(null)
  const fitCameraRef   = useRef(null)
  const headGroupRef   = useRef(null)
  const rendererRef    = useRef(null)
  const requestRenderRef = useRef(null)   // 単発レンダーを要求（操作・状態変化時）
  const objectUrlRef   = useRef(null)     // loadFile で作成した Object URL（解放用）
  const detectedFpsRef = useRef(0)
  const frameCountRef  = useRef(0)        // テクスチャに取り込んだ動画フレーム数（診断用）
  const renderCountRef = useRef(0)        // WebGL描画回数（診断用）
  const renderPathRef  = useRef('rvfc')   // 実際に使っている描画経路 'rvfc' | 'raf'（診断用）

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

    // WebGLコンテキストの生成はドライバ・環境に依存して失敗しうる
    // （LinuxのWebKitGTKでGPUアクセラレーションが使えない場合など）。
    // 失敗を握り潰すと「UIは出るが映像だけ真っ黒」になり原因が分からないため、
    // エラーオーバーレイに出して切り分け可能にする。
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch (err) {
      onVideoError(`WEBGL_INIT_FAILED: ${err?.message || err}`)
      return
    }
    // HiDPI: OSスケーリング環境（Windowsの125%〜200%等）でCSSピクセル解像度の
    // まま描画すると動画がにじむため、デバイスピクセル比で内部バッファを確保する
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // コンテキストロスト後は描画が止まったまま黒画面になる。無言で壊れないよう通知する。
    const onContextLost = (e) => {
      e.preventDefault()
      onVideoError('WEBGL_CONTEXT_LOST')
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)

    const video = document.createElement('video')
    video.loop        = true    // Player 側 loop state の初期値と一致させる
    video.muted       = false
    video.crossOrigin = 'anonymous'
    video.volume      = 0.5
    videoRef.current  = video
    onVideoEl(video)

    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace
    textureRef.current = texture

    // VR: 半球内側
    const sGeo = new THREE.SphereGeometry(VR_RADIUS, 60, 40, 0, Math.PI)
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

    // --- レンダーオンデマンド ---
    // 常時 60fps で回す代わりに、実フレーム到着時と操作・状態変化時だけ描画する。
    const renderOnce = () => {
      controls.update()
      renderer.render(scene, camera)
      renderCountRef.current++
    }

    let renderScheduled = false
    const requestRender = () => {
      if (renderScheduled) return
      renderScheduled = true
      requestAnimationFrame(() => {
        renderScheduled = false
        renderOnce()
      })
    }
    requestRenderRef.current = requestRender

    // OrbitControls（ズーム・パン・回転）の変化で再描画
    controls.addEventListener('change', requestRender)

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
      camera.fov = Math.max(20, Math.min(100, camera.fov + e.deltaY * vrScrollSpeedRef.current))
      camera.updateProjectionMatrix()
      requestRender()
    }
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      // DPIの異なるモニタ間を移動するとデバイスピクセル比が変わるため毎回反映する
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      if (modeRef.current === 'normal') fitCamera()
      requestRender()
    }
    window.addEventListener('resize', onResize)

    video.addEventListener('loadedmetadata', () => {
      onDuration(video.duration)
      if (video.videoWidth && video.videoHeight) {
        const aspect = video.videoWidth / video.videoHeight
        plane.scale.set(aspect / (16 / 9), 1, 1)
        if (modeRef.current === 'normal') fitCamera()
      }
      requestRender()
    })

    // loadedmetadata 時点は readyState=HAVE_METADATA でフレーム実体がまだ無く、
    // ここで描画しても黒画のままになる。最初のフレームが揃う loadeddata で
    // 明示的にテクスチャを更新して描画する。
    //
    // これが無いと「再生が始まらない環境では永久に真っ黒」になる。
    // 例: LinuxのWebKitGTKは自動再生にユーザー操作を要求するため play() が
    // NotAllowedError で拒否され、play イベント起点の rVFC ループが回らない。
    const onLoadedData = () => {
      texture.needsUpdate = true
      requestRender()
    }
    video.addEventListener('loadeddata', onLoadedData)
    video.addEventListener('error', () => {
      if (!video.src || video.src === location.href) return
      const e = video.error
      const messages = {
        [MediaError.MEDIA_ERR_ABORTED]:  'MEDIA_ERR_ABORTED',
        [MediaError.MEDIA_ERR_NETWORK]:  'MEDIA_ERR_NETWORK',
        [MediaError.MEDIA_ERR_DECODE]:   'MEDIA_ERR_DECODE',
        [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
      }
      onVideoError(messages[e?.code] || `UNKNOWN_ERROR (code: ${e?.code})`)
    })

    // 再生中: 新しい動画フレームが提示されたときのみ描画する。
    // requestVideoFrameCallback 対応環境では一時停止中に一切描画しない。
    //
    // ただし rVFC は「メソッドは存在するがコールバックが発火しない」環境がある
    // （LinuxのWebKitGTK）。three.js の VideoTexture も内部で rVFC を使って
    // needsUpdate を立てるため、この場合は自前ループと three.js 側が同時に
    // 沈黙し、デコードもシークも正常なのに映像だけ静止する。
    // 存在チェックだけでは検出できないので、再生開始後に実際にフレームが
    // 来たかを監視し、来なければ rAF ループへ恒久的に切り替える。
    const hasRVFC = typeof video.requestVideoFrameCallback === 'function'
    const RVFC_WATCHDOG_MS = 800
    renderPathRef.current = hasRVFC ? 'rvfc' : 'raf'
    let rvfcId       = null
    let rafId        = null
    let watchdogId   = null
    let framesRunning = false
    let useRaf       = !hasRVFC

    let prevMediaTime = -1
    const onVideoFrame = (_now, metadata) => {
      texture.needsUpdate = true
      frameCountRef.current++
      renderOnce()
      if (metadata && prevMediaTime >= 0 && metadata.mediaTime > prevMediaTime) {
        const delta = metadata.mediaTime - prevMediaTime
        if (delta > 0.001 && delta < 0.2) {
          detectedFpsRef.current = 1 / delta
        }
      }
      if (metadata) prevMediaTime = metadata.mediaTime
      if (!video.paused && !video.ended) {
        rvfcId = video.requestVideoFrameCallback(onVideoFrame)
      } else {
        framesRunning = false
      }
    }

    // フォールバック: 再生中のみ rAF ループで描画する。
    // 停止時は自然に抜けるので、一時停止中はCPUを消費しない。
    const rafLoop = () => {
      if (video.paused || video.ended) {
        rafId = null
        return
      }
      texture.needsUpdate = true
      frameCountRef.current++
      renderOnce()
      rafId = requestAnimationFrame(rafLoop)
    }
    const startRaf = () => {
      if (rafId != null) return
      rafId = requestAnimationFrame(rafLoop)
    }

    // rVFC を登録しても発火しない環境の検出。
    // 再生位置が進んでいるのにフレームが1枚も来ていなければ壊れていると判断する。
    // 誤検出しても rAF ループに落ちるだけで、描画は正しく行われる。
    const armWatchdog = () => {
      if (useRaf || watchdogId != null) return
      const baseFrames = frameCountRef.current
      const baseTime   = video.currentTime
      watchdogId = setTimeout(() => {
        watchdogId = null
        if (useRaf || video.paused || video.ended) return
        if (frameCountRef.current > baseFrames) return   // 正常に発火している
        if (video.currentTime <= baseTime) return        // 再生自体が進んでいない
        console.warn('requestVideoFrameCallback did not fire; falling back to requestAnimationFrame')
        useRaf = true
        renderPathRef.current = 'raf'
        if (rvfcId != null) {
          video.cancelVideoFrameCallback(rvfcId)
          rvfcId = null
        }
        framesRunning = false
        startRaf()
      }, RVFC_WATCHDOG_MS)
    }

    const startFrames = () => {
      if (useRaf) {
        startRaf()
        return
      }
      if (!framesRunning) {
        framesRunning = true
        rvfcId = video.requestVideoFrameCallback(onVideoFrame)
      }
      armWatchdog()
    }

    // 一時停止時は保留中のコールバックを明示的に破棄してフラグを戻す。
    //
    // onVideoFrame の else 節だけに頼るとフラグが戻らない環境がある。
    // 停止するとフレームの提示が止まるため、保留中のコールバックが
    // 二度と発火しない実装では framesRunning が true のまま残り、
    // 再開時に startFrames() が早期returnして描画ループが回らなくなる
    // （音と currentTime だけ進んで画が止まる）。
    const stopFrames = () => {
      if (watchdogId != null) {
        clearTimeout(watchdogId)
        watchdogId = null
      }
      if (rvfcId != null) {
        video.cancelVideoFrameCallback(rvfcId)
        rvfcId = null
      }
      if (rafId != null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      framesRunning = false
    }

    // 一時停止中のシークでも新フレームを表示する。描画経路に関わらず
    // 停止中はループが回らないため、常に登録する。
    video.addEventListener('seeked', onLoadedData)
    video.addEventListener('play', startFrames)
    video.addEventListener('playing', startFrames)
    video.addEventListener('pause', stopFrames)
    video.addEventListener('ended', stopFrames)

    // 初期表示（黒画面）を一度描画
    renderOnce()

    return () => {
      stopFrames()
      video.removeEventListener('play', startFrames)
      video.removeEventListener('playing', startFrames)
      video.removeEventListener('pause', stopFrames)
      video.removeEventListener('ended', stopFrames)
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('seeked', onLoadedData)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.domElement.removeEventListener('wheel', onWheel)
      controls.removeEventListener('change', requestRender)
      controls.dispose()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      video.src = ''
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  return {
    mountRef, videoRef, cameraRef, controlsRef, sphereRef, planeRef,
    textureRef, fitCameraRef, headGroupRef, rendererRef,
    requestRenderRef, objectUrlRef, detectedFpsRef,
    frameCountRef, renderCountRef, renderPathRef,
  }
}
