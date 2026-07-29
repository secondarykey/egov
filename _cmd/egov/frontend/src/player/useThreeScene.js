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
    const hasRVFC = typeof video.requestVideoFrameCallback === 'function'
    let animId = null
    let framesRunning = false

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
        animId = video.requestVideoFrameCallback(onVideoFrame)
      } else {
        framesRunning = false
      }
    }
    const startFrames = () => {
      if (!hasRVFC || framesRunning) return
      framesRunning = true
      animId = video.requestVideoFrameCallback(onVideoFrame)
    }

    // フォールバック（rVFC 非対応環境）: 再生中のみ rAF ループで描画
    const rafLoop = () => {
      animId = requestAnimationFrame(rafLoop)
      if (!video.paused && !video.ended) {
        texture.needsUpdate = true
        frameCountRef.current++
        renderOnce()
      }
    }

    if (hasRVFC) {
      video.addEventListener('play', startFrames)
      // 一時停止中のシークでも新フレームを表示する
      video.addEventListener('seeked', requestRender)
    } else {
      rafLoop()
    }

    // 初期表示（黒画面）を一度描画
    renderOnce()

    return () => {
      if (hasRVFC) {
        if (animId != null) video.cancelVideoFrameCallback(animId)
        video.removeEventListener('play', startFrames)
        video.removeEventListener('seeked', requestRender)
      } else if (animId != null) {
        cancelAnimationFrame(animId)
      }
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
    frameCountRef, renderCountRef,
  }
}
