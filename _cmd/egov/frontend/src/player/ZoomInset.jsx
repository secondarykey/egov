import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { clamp, isResizeEdge } from './utils'

// 小窓ズーム（normal / free モード）。
// 主画面と同じシーン（同じ VideoTexture を貼った平面）を2つ目のカメラで小窓の大きさの
// オフスクリーンへ描き、縁ほど透明にして主画面へ重ねる。デコードも GPU への転送も
// 1回のままで、増えるのは小窓の面積ぶんの描画2回（オフスクリーンと合成）だけ。
//
// 切り抜く範囲はワールド座標（平面上の位置）で持つので、free モードで主画面を
// 動かしても小窓は同じ場所を映し続ける。主画面には範囲を示す枠を出さない。
//
// 見た目は設定（settings.zoomInset）で選ぶ: 枠線を出すか、出さずに縁を透かすか（透かす幅も設定）。
//
// 操作は free / vr と揃える: 右ドラッグ＝平行移動、ホイール＝寄る/引く。
// 左ドラッグは小窓そのものの移動（四隅のつまみでリサイズ）。

const MIN_W = 160
const MIN_H = 90
const KEEP_VISIBLE = 48            // 画面端からはみ出させても、見失わないよう画面内に残す幅
const MIN_REGION_H = 9 / 50        // 平面の高さ（9）の 1/50 まで寄れる
const WHEEL_SPEED = 0.0015

// リサイズのつまみ（見た目は出さず、カーソルの形だけで示す）。x / y は動かす辺（-1＝左・上、1＝右・下）
const CORNERS = {
  nw: { x: -1, y: -1, cursor: 'nwse-resize' },
  ne: { x:  1, y: -1, cursor: 'nesw-resize' },
  sw: { x: -1, y:  1, cursor: 'nesw-resize' },
  se: { x:  1, y:  1, cursor: 'nwse-resize' },
}
const HANDLE_SIZE = 16

const COMPOSITE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// オフスクリーンの中身は乗算済みアルファ（透明の上に通常合成で描いたため）。
// 出力の色空間変換は乗算前の色に掛けてから、縁のマスクと一緒にアルファを掛け直す。
const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uSize;
  uniform float uFeather;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tMap, vUv);
    vec2 px = vUv * uSize;
    vec2 edge = min(px, uSize - px);
    // smoothstep は edge0 == edge1 で未定義なので、透かさないときは分ける
    float mask = uFeather > 0.0
      ? smoothstep(0.0, uFeather, edge.x) * smoothstep(0.0, uFeather, edge.y)
      : 1.0;
    float a = texel.a * mask;
    gl_FragColor = vec4(texel.rgb / max(texel.a, 1e-4), 1.0);
    #include <colorspace_fragment>
    gl_FragColor = vec4(gl_FragColor.rgb * a, a);
  }
`

// 平面がワールド座標で占める範囲の半分。free モードの回転（90°単位）で縦横が入れ替わる
const planeExtent = (plane) => {
  const hw = 8 * plane.scale.x
  const hh = 4.5 * plane.scale.y
  return Math.abs(Math.sin(plane.rotation.z)) > 0.5 ? { hw: hh, hh: hw } : { hw, hh }
}

// 画面上の移動量を mount 内の座標へ直す。normal モードの回転は mount ごと CSS で回している。
const toLocal = (dx, dy, deg) => {
  const r = THREE.MathUtils.degToRad(deg)
  const c = Math.cos(r), s = Math.sin(r)
  return [c * dx + s * dy, -s * dx + c * dy]
}

// 主カメラで画面の 1px がワールド座標（平面 z=0 上）でいくつか。
// normal / free ではカメラは回転せず常に -z を向いている。
const worldPerPx = (camera, height) =>
  (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / height

// 切り抜く範囲の高さの上限。小窓が主画面の等倍より小さく映らないようにする
// （引いても主画面と同じ大きさで止まる）。素材全体より広くもしない。
const maxRegionH = (plane, rect, mainWpp) => {
  const { hw, hh } = planeExtent(plane)
  return Math.min(2 * Math.max(hw, hh), rect.h * mainWpp)
}

const clampRegion = (region, plane, maxH) => {
  const { hw, hh } = planeExtent(plane)
  region.h  = clamp(region.h, MIN_REGION_H, maxH)
  region.cx = clamp(region.cx, -hw, hw)
  region.cy = clamp(region.cy, -hh, hh)
}

// stateRef は Player が持つ。VR へ切り替えてこのコンポーネントが外れても、
// 戻ったときに同じ位置・同じ範囲で出すため。
//   rect   … 小窓の位置と大きさ（mount 内の CSS px、左上原点）
//   region … 切り抜く範囲の中心（ワールド座標）と高さ。幅は小窓の縦横比で決まる
//   border  … 枠線を出す（縁は透かさない）
//   feather … 枠線なしのとき縁を透かす幅（小窓の短辺に対する割合）
export default function ZoomInset({ stateRef, mountRef, planeRef, planePassRef, requestRenderRef, cssRotation, border, feather }) {
  const boxRef    = useRef(null)
  const rotRef    = useRef(cssRotation)
  const featherRef = useRef(0)
  const mainWppRef = useRef(Infinity)   // 主画面の 1px あたりのワールド長（等倍の基準）
  rotRef.current = cssRotation
  featherRef.current = border ? 0 : feather

  const render = () => requestRenderRef.current?.()

  useEffect(() => { render() }, [border, feather])

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
    const clearColor = new THREE.Color()

    // sRGB のレンダーターゲットにすると書き込みで符号化・読み出しで復号されるので、
    // 暗部の階調が潰れず、合成側は線形のまま扱える
    const target = new THREE.WebGLRenderTarget(1, 1)
    target.texture.colorSpace = THREE.SRGBColorSpace

    const composite = new THREE.ShaderMaterial({
      uniforms: {
        tMap:     { value: target.texture },
        uSize:    { value: new THREE.Vector2(1, 1) },
        uFeather: { value: 1 },
      },
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composite)
    quad.frustumCulled = false
    const quadScene  = new THREE.Scene().add(quad)
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)   // 頂点シェーダが直接 NDC を出すので形だけ

    // 毎フレーム呼ばれるので、位置が変わったときだけ DOM に書く
    let placed = ''
    const place = (el, x, y, w, h) => {
      if (!el) return
      const key = `${x},${y},${w},${h}`
      if (placed === key) return
      placed = key
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

      // 小窓はウィンドウより大きくしない
      rect.w = clamp(rect.w, Math.min(MIN_W, W), W)
      rect.h = clamp(rect.h, Math.min(MIN_H, H), H)
      // 画面端からははみ出してよい（mount の overflow: hidden で切れる）。ただし一部は画面内に残す
      rect.x = clamp(rect.x, Math.min(KEEP_VISIBLE, W) - rect.w, W - Math.min(KEEP_VISIBLE, W))
      rect.y = clamp(rect.y, Math.min(KEEP_VISIBLE, H) - rect.h, H - Math.min(KEEP_VISIBLE, H))
      mainWppRef.current = worldPerPx(camera, H)
      clampRegion(region, plane, maxRegionH(plane, rect, mainWppRef.current))

      insetCamera.aspect = rect.w / rect.h
      insetCamera.updateProjectionMatrix()
      insetCamera.position.set(region.cx, region.cy, region.h / 2 / tanHalf)

      // 1) 小窓の中身をオフスクリーンへ描く。映像の外は透明にして、引いたときも主画面が透ける
      const pr = renderer.getPixelRatio()
      const tw = Math.max(1, Math.round(rect.w * pr))
      const th = Math.max(1, Math.round(rect.h * pr))
      if (target.width !== tw || target.height !== th) target.setSize(tw, th)
      renderer.getClearColor(clearColor)
      const clearAlpha = renderer.getClearAlpha()
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(target)
      renderer.render(scene, insetCamera)
      renderer.setRenderTarget(null)
      renderer.setClearColor(clearColor, clearAlpha)

      // 2) 縁ほど透明にして主画面へ重ねる。viewport は左下原点の CSS px（three.js が pixelRatio を掛ける）
      composite.uniforms.uSize.value.set(rect.w, rect.h)
      composite.uniforms.uFeather.value = Math.min(rect.w, rect.h) * featherRef.current
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.setViewport(rect.x, H - rect.y - rect.h, rect.w, rect.h)
      renderer.render(quadScene, quadCamera)
      renderer.setViewport(0, 0, W, H)
      renderer.autoClear = autoClear

      place(boxRef.current, rect.x, rect.y, rect.w, rect.h)
    }
    render()

    return () => {
      planePassRef.current = null
      render()   // 小窓を消した画で描き直す
      target.dispose()
      composite.dispose()
      quad.geometry.dispose()
    }
  }, [])

  // ポインタを捕まえてドラッグする。onMove には mount 内の座標系での移動量を渡す。
  const drag = (e, onMove) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let lastX = e.clientX, lastY = e.clientY
    const move = (ev) => {
      const [dx, dy] = toLocal(ev.clientX - lastX, ev.clientY - lastY, rotRef.current)
      lastX = ev.clientX
      lastY = ev.clientY
      onMove(dx, dy)
      render()
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
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
    const maxH = maxRegionH(planeRef.current, rect, mainWppRef.current)
    region.h = clamp(region.h * Math.exp(deltaY * WHEEL_SPEED), MIN_REGION_H, maxH)
    const after = region.h / rect.h
    region.cx = px - ox * after
    region.cy = py + oy * after
    render()
  }

  // wheel は React だと passive で登録され preventDefault できないので自前で付ける
  useEffect(() => {
    const box = boxRef.current
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const r = box.getBoundingClientRect()   // 回転しても中心は変わらない
      const [ox, oy] = toLocal(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), rotRef.current)
      zoomRegion(e.deltaY, ox, oy)
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [])

  const onBoxPointerDown = (e) => {
    if (isResizeEdge(e.clientX, e.clientY)) return
    e.stopPropagation()
    const { rect, region } = stateRef.current
    const corner = CORNERS[e.target.dataset.corner]
    if (e.button === 0 && corner) {
      const mount = mountRef.current
      // 反対側の辺を固定したまま、つまんだ角の辺だけを動かす
      drag(e, (dx, dy) => {
        if (corner.x > 0) {
          rect.w = clamp(rect.w + dx, MIN_W, mount.clientWidth)
        } else {
          const right = rect.x + rect.w
          rect.x = clamp(rect.x + dx, right - mount.clientWidth, right - MIN_W)
          rect.w = right - rect.x
        }
        if (corner.y > 0) {
          rect.h = clamp(rect.h + dy, MIN_H, mount.clientHeight)
        } else {
          const bottom = rect.y + rect.h
          rect.y = clamp(rect.y + dy, bottom - mount.clientHeight, bottom - MIN_H)
          rect.h = bottom - rect.y
        }
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

  // 主画面の再生/一時停止・長押しシーク・ダブルクリックシークに入らないよう止める
  const stop = (e) => e.stopPropagation()

  return (
    <div
      ref={boxRef}
      onPointerDown={onBoxPointerDown}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      style={{
        position: 'absolute',
        zIndex: 1,
        cursor: 'move',
        ...(border && {
          boxSizing: 'border-box',
          border: '1px solid rgba(255,255,255,0.6)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
        }),
      }}
    >
      {Object.entries(CORNERS).map(([key, c]) => (
        <div
          key={key}
          data-corner={key}
          style={{
            position: 'absolute',
            [c.x > 0 ? 'right' : 'left']: 0,
            [c.y > 0 ? 'bottom' : 'top']: 0,
            width: HANDLE_SIZE, height: HANDLE_SIZE,
            cursor: c.cursor,
          }}
        />
      ))}
    </div>
  )
}
