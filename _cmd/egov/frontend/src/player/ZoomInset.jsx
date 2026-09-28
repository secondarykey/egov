import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { clamp, isResizeEdge } from './utils'

// 小窓ズーム（normal / free モード）。
// 主画面と同じシーン（同じ VideoTexture を貼った平面）を、2つ目のカメラで
// 小窓の範囲だけ scissor して描き直す。デコードも GPU への転送も1回のままで、
// 増えるのは小窓の面積ぶんの描画だけ。
//
// 切り抜く範囲はワールド座標（平面上の位置）で持つので、free モードで主画面を
// 動かしても小窓は同じ場所を映し続ける。主画面の枠は描画のたびに主カメラから求め直す。
//
// 操作は free / vr と揃える: 右ドラッグ＝平行移動、ホイール＝寄る/引く。
// 左ドラッグは小窓そのものの移動（角のつまみでリサイズ）、主画面の枠の左ドラッグは切り抜く位置の移動。

const MIN_W = 160
const MIN_H = 90
const MIN_REGION_H = 9 / 50        // 平面の高さ（9）の 1/50 まで寄れる
const WHEEL_SPEED = 0.0015
const CLICK_TOLERANCE = 4          // これ以上動いたら枠のドラッグとみなし、クリック（再生/一時停止）にしない

// 平面がワールド座標で占める範囲の半分。free モードの回転（90°単位）で縦横が入れ替わる
const planeExtent = (plane) => {
  const hw = 8 * plane.scale.x
  const hh = 4.5 * plane.scale.y
  return Math.abs(Math.sin(plane.rotation.z)) > 0.5 ? { hw: hh, hh: hw } : { hw, hh }
}

// 主カメラで画面の 1px がワールド座標（平面 z=0 上）でいくつか。
// normal / free ではカメラは回転せず常に -z を向いている。
const worldPerPx = (camera, height) =>
  (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / height

// 画面上の移動量を mount 内の座標へ直す。normal モードの回転は mount ごと CSS で回している。
const toLocal = (dx, dy, deg) => {
  const r = THREE.MathUtils.degToRad(deg)
  const c = Math.cos(r), s = Math.sin(r)
  return [c * dx + s * dy, -s * dx + c * dy]
}

const clampRegion = (region, plane) => {
  const { hw, hh } = planeExtent(plane)
  region.h  = clamp(region.h, MIN_REGION_H, 2 * Math.max(hw, hh))
  region.cx = clamp(region.cx, -hw, hw)
  region.cy = clamp(region.cy, -hh, hh)
}

// stateRef は Player が持つ。VR へ切り替えてこのコンポーネントが外れても、
// 戻ったときに同じ位置・同じ範囲で出すため。
//   rect   … 小窓の位置と大きさ（mount 内の CSS px、左上原点）
//   region … 切り抜く範囲の中心（ワールド座標）と高さ。幅は小窓の縦横比で決まる
export default function ZoomInset({ stateRef, mountRef, cameraRef, planeRef, planePassRef, requestRenderRef, cssRotation, activeColor }) {
  const boxRef    = useRef(null)
  const handleRef = useRef(null)
  const frameRef  = useRef(null)
  const rotRef    = useRef(cssRotation)
  const frameDraggedRef = useRef(false)
  rotRef.current = cssRotation

  const render = () => requestRenderRef.current?.()

  useEffect(() => {
    const mount  = mountRef.current
    const plane  = planeRef.current
    if (!mount || !plane) return

    if (!stateRef.current) {
      const w = clamp(Math.round(mount.clientWidth * 0.32), MIN_W, 560)
      stateRef.current = {
        rect:   { x: 16, y: 48, w, h: Math.round((w * 9) / 16) },
        region: { cx: 0, cy: 0, h: 9 / 4 },
      }
    }

    const insetCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(insetCamera.fov) / 2)
    const size = new THREE.Vector2()

    // 毎フレーム呼ばれるので、位置が変わったときだけ DOM に書く
    const placed = new Map()
    const place = (el, x, y, w, h) => {
      if (!el) return
      const key = `${x},${y},${w},${h}`
      if (placed.get(el) === key) return
      placed.set(el, key)
      el.style.left   = `${x}px`
      el.style.top    = `${y}px`
      el.style.width  = `${w}px`
      el.style.height = `${h}px`
    }

    planePassRef.current = (renderer, scene, camera) => {
      renderer.getSize(size)
      const W = size.x, H = size.y
      if (!W || !H) return
      const { rect, region } = stateRef.current

      // ウィンドウが縮んだら小窓を内側へ収める
      rect.w = clamp(rect.w, Math.min(MIN_W, W), W)
      rect.h = clamp(rect.h, Math.min(MIN_H, H), H)
      rect.x = clamp(rect.x, 0, W - rect.w)
      rect.y = clamp(rect.y, 0, H - rect.h)
      clampRegion(region, plane)

      insetCamera.aspect = rect.w / rect.h
      insetCamera.updateProjectionMatrix()
      insetCamera.position.set(region.cx, region.cy, region.h / 2 / tanHalf)

      // viewport / scissor は左下原点の CSS px（three.js が pixelRatio を掛ける）
      const vy = H - rect.y - rect.h
      renderer.setViewport(rect.x, vy, rect.w, rect.h)
      renderer.setScissor(rect.x, vy, rect.w, rect.h)
      renderer.setScissorTest(true)
      renderer.render(scene, insetCamera)
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, W, H)

      place(boxRef.current, rect.x, rect.y, rect.w, rect.h)

      // 切り抜いている範囲を主画面に枠で示す
      const wpp = worldPerPx(camera, H)
      const fw  = (region.h * rect.w) / rect.h
      place(frameRef.current,
        W / 2 + (region.cx - fw / 2 - camera.position.x) / wpp,
        H / 2 - (region.cy + region.h / 2 - camera.position.y) / wpp,
        fw / wpp,
        region.h / wpp,
      )
    }
    render()

    return () => {
      planePassRef.current = null
      render()   // 小窓を消した画で描き直す
    }
  }, [])

  // ポインタを捕まえてドラッグする。onMove には mount 内の座標系での移動量を渡す。
  const drag = (e, onMove, onEnd) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX, startY = e.clientY
    let lastX = startX, lastY = startY, moved = 0
    const move = (ev) => {
      const [dx, dy] = toLocal(ev.clientX - lastX, ev.clientY - lastY, rotRef.current)
      lastX = ev.clientX
      lastY = ev.clientY
      moved = Math.max(moved, Math.hypot(ev.clientX - startX, ev.clientY - startY))
      onMove(dx, dy)
      render()
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      onEnd?.(moved)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  const zoomRegion = (deltaY, ox, oy) => {
    const { rect, region } = stateRef.current
    // カーソル位置（小窓の中心からのずれ ox, oy）の下にある点を動かさずに寄る/引く
    const before = region.h / rect.h
    const px = region.cx + ox * before
    const py = region.cy - oy * before
    const { hw, hh } = planeExtent(planeRef.current)
    region.h = clamp(region.h * Math.exp(deltaY * WHEEL_SPEED), MIN_REGION_H, 2 * Math.max(hw, hh))
    const after = region.h / rect.h
    region.cx = px - ox * after
    region.cy = py + oy * after
    render()
  }

  // wheel は React だと passive で登録され preventDefault できないので自前で付ける
  useEffect(() => {
    const box = boxRef.current, frame = frameRef.current
    const onBoxWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const r = box.getBoundingClientRect()   // 回転しても中心は変わらない
      const [ox, oy] = toLocal(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), rotRef.current)
      zoomRegion(e.deltaY, ox, oy)
    }
    const onFrameWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      zoomRegion(e.deltaY, 0, 0)
    }
    box.addEventListener('wheel', onBoxWheel, { passive: false })
    frame.addEventListener('wheel', onFrameWheel, { passive: false })
    return () => {
      box.removeEventListener('wheel', onBoxWheel)
      frame.removeEventListener('wheel', onFrameWheel)
    }
  }, [])

  const onBoxPointerDown = (e) => {
    if (isResizeEdge(e.clientX, e.clientY)) return
    e.stopPropagation()
    const { rect, region } = stateRef.current
    if (e.button === 0 && e.target === handleRef.current) {
      const mount = mountRef.current
      drag(e, (dx, dy) => {
        rect.w = clamp(rect.w + dx, MIN_W, mount.clientWidth  - rect.x)
        rect.h = clamp(rect.h + dy, MIN_H, mount.clientHeight - rect.y)
      })
    } else if (e.button === 0) {
      drag(e, (dx, dy) => {
        rect.x += dx
        rect.y += dy
      })
    } else if (e.button === 2) {
      // 映像がカーソルに付いてくるように、範囲は逆向きに動かす
      drag(e, (dx, dy) => {
        const k = region.h / rect.h
        region.cx -= dx * k
        region.cy += dy * k
      })
    }
  }

  const onFramePointerDown = (e) => {
    if (e.button !== 0 || isResizeEdge(e.clientX, e.clientY)) return
    e.stopPropagation()
    frameDraggedRef.current = false
    const { region } = stateRef.current
    drag(e, (dx, dy) => {
      const k = worldPerPx(cameraRef.current, mountRef.current.clientHeight)
      region.cx += dx * k
      region.cy -= dy * k
    }, (moved) => { frameDraggedRef.current = moved > CLICK_TOLERANCE })
  }

  // 主画面の長押しシーク・ダブルクリックシークに入らないよう mousedown は止める。
  // 枠の上でのクリック（動かしていない）は再生/一時停止として主画面へ流す。
  const stop = (e) => e.stopPropagation()
  const onFrameClick = (e) => {
    if (frameDraggedRef.current) {
      frameDraggedRef.current = false
      e.stopPropagation()
    }
  }

  return (
    <>
      <div
        ref={frameRef}
        onPointerDown={onFramePointerDown}
        onMouseDown={stop}
        onClick={onFrameClick}
        style={{
          position: 'absolute',
          zIndex: 1,
          boxSizing: 'border-box',
          border: `1px dashed ${activeColor}`,
          cursor: 'move',
        }}
      />
      <div
        ref={boxRef}
        onPointerDown={onBoxPointerDown}
        onMouseDown={stop}
        onClick={stop}
        onDoubleClick={stop}
        style={{
          position: 'absolute',
          zIndex: 2,
          boxSizing: 'border-box',
          border: `1px solid ${activeColor}`,
          boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
          cursor: 'move',
        }}
      >
        <div
          ref={handleRef}
          style={{
            position: 'absolute',
            right: 0, bottom: 0,
            width: 14, height: 14,
            boxSizing: 'border-box',
            borderRight:  '3px solid rgba(255,255,255,0.8)',
            borderBottom: '3px solid rgba(255,255,255,0.8)',
            cursor: 'nwse-resize',
          }}
        />
      </div>
    </>
  )
}
