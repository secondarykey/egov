import { useEffect, useRef, useState } from 'react'
import { GetSettings, UpdateVRSettings } from '../../bindings/egov/api'
import { VR_FOV_MAX, VR_FOV_MIN, VR_SHIFT_LIMIT, VR_START, clamp, deg2rad, rad2deg } from './utils'
import { dispProjIndex, fitSrcFov, projScaleFor, setVrRotation, srcProjIndex } from './vrShader'

// オーバーレイのスライダーは度・比率なので単位を変換する
const toOverlay = (v) => ({
  pitch: rad2deg(v.pitch), yaw: rad2deg(v.yaw), roll: rad2deg(v.roll),
  fov: v.fov, srcFov: v.srcFov, srcProj: v.srcProj, dispProj: v.dispProj,
  shiftX: v.shift.x, shiftY: v.shift.y,
})

// VR の視点（始点・向き・平行移動・画角・投影方式）と、その保存・リセット・
// オーバーレイ・マウス操作。
//
// 視点の値はここの ref を単一の真実とし、シェーダの uniform へは syncVrView() で反映する。
// 保存とリセットは currentVrView() / restoreVrView() の1オブジェクトで対称に扱う。
// 個別の ref に分けて扱うと、項目を足したときに片側だけ忘れる。
//
// 返す関数は ref と state の setter しか使わないので、一度だけ登録するリスナー
// （設定の読み込みなど）から初回の関数を呼んでもよい。
export default function useVrView({ mode, mountRef, vrUniformsRef, syncVrSizeRef, requestRenderRef, vrInputRef }) {
  const [vrStart,     setVrStart]     = useState('left')
  const [overlayOpen, setOverlayOpen] = useState(false)
  // オーバーレイ表示用の視点パラメータ。角度はすべて度。
  const [vrView, setVrView] = useState({
    pitch: 0, yaw: 0, roll: 0, fov: 75,
    srcFov: 180, srcProj: 'equirect', dispProj: 'rectilinear',
    shiftX: 0, shiftY: 0,
  })

  const vrStartRef    = useRef('left')
  const vrYawRef      = useRef(0)   // 現在の頭の向き（ラジアン、セッション中保持）
  const vrPitchRef    = useRef(0)
  const vrRollRef     = useRef(0)   // 素材の水平傾き補正（ラジアン）
  const vrShiftRef    = useRef({ x: 0, y: 0 })   // 描画結果の平行移動（画面半分=1.0）
  const vrFovRef      = useRef(75)          // 表示側の垂直画角（度）
  const vrSrcFovRef   = useRef(180)         // 素材の画角（度）
  const vrSrcProjRef  = useRef('equirect')  // 素材の投影方式
  const vrDispProjRef = useRef('rectilinear')
  // 個別の ref に分けると保存・リセットのどちらかで項目を取りこぼすため、
  // どちらも currentVrView() が返す形のまま丸ごと持つ。
  //   vrSavedRef    … settings.json に保存されている既定値
  //   vrDefaultsRef … Reset Camera の戻り先。保存済みの既定値に、開いている
  //                   ファイルから推定した素材の形式（DetectVRFormat）を重ねたもの
  const vrSavedRef    = useRef(null)
  const vrDefaultsRef = useRef(null)

  // VR視点の ref をすべてシェーダの uniform へ反映する。変更点はすべてここを通す。
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
    start:    vrStartRef.current,
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
    vrStartRef.current    = v.start
    setVrStart(v.start)
    vrPitchRef.current    = v.pitch
    vrYawRef.current      = v.yaw
    vrRollRef.current     = v.roll
    vrShiftRef.current    = { ...v.shift }
    vrFovRef.current      = v.fov
    vrSrcFovRef.current   = fitSrcFov(v.srcProj, v.srcFov)
    vrSrcProjRef.current  = v.srcProj
    vrDispProjRef.current = v.dispProj
    syncVrView()
  }

  // 始点はオーバーレイのスライダーではなくボタン（onVrStartChange）で変わる
  const fromOverlay = (o) => ({
    start: vrStartRef.current,
    pitch: deg2rad(o.pitch), yaw: deg2rad(o.yaw), roll: deg2rad(o.roll),
    shift: { x: o.shiftX, y: o.shiftY },
    fov: o.fov, srcFov: o.srcFov, srcProj: o.srcProj, dispProj: o.dispProj,
  })

  // settings.vr に保存されている既定値を読み込み、今の視点とリセットの戻り先にする（起動時）
  const loadSavedVrView = (s) => {
    const saved = {
      start:    s.defaultStart,
      pitch:    deg2rad(s.initialPitch),
      yaw:      deg2rad(s.initialYaw),
      roll:     deg2rad(s.initialRoll),
      shift:    { x: s.shiftX, y: s.shiftY },
      fov:      s.fov,
      srcFov:   s.sourceFov,
      srcProj:  s.sourceProjection,
      dispProj: s.displayProjection,
    }
    vrSavedRef.current    = saved
    vrDefaultsRef.current = saved
    restoreVrView(saved)
    setVrView(toOverlay(saved))
  }

  // ファイルから推定した素材の形式（DetectVRFormat の結果）を反映する。
  // 推定できた項目だけを保存済みの既定値に重ね、それを Reset Camera の戻り先にする。
  // 向き・表示画角などの見方の好みには触れない。ディスクへは書かない。
  // 推定できなかった項目は保存済みの既定値へ戻す——前のファイルの推定結果
  // （例: 360°モノラル）を次のファイルへ持ち越さないため。
  const applySourceFormat = (f) => {
    const saved = vrSavedRef.current
    if (!saved) return
    const srcProj = f.projection || saved.srcProj
    const format  = {
      start:   f.start || saved.start,
      srcProj,
      srcFov:  fitSrcFov(srcProj, f.fov || saved.srcFov),
    }
    vrDefaultsRef.current = { ...saved, ...format }
    restoreVrView({ ...currentVrView(), ...format })
    setVrView(toOverlay(currentVrView()))
  }

  // Reset Camera。向き・平行移動・画角だけでなく始点や素材／表示の投影方式も含めて
  // 既定へ全項目を戻す（保存が全項目を焼くので対称にする）。
  // 戻り先は保存済みの既定値に、開いているファイルの推定結果を重ねたもの。
  const resetVrView = () => restoreVrView(vrDefaultsRef.current)

  // 現在の始点・視点・投影設定を既定として保存する（オーバーレイの「既定として保存」だけから呼ぶ）。
  // 他のVR設定（感度等）は保存済みの値を維持する。
  const persistVRView = async () => {
    const v = currentVrView()
    vrSavedRef.current    = v
    vrDefaultsRef.current = v
    const s = await GetSettings()
    UpdateVRSettings({
      ...s.vr,
      defaultStart:      v.start,
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
    setOverlayOpen(true)
  }

  // オーバーレイの変更を即時反映する
  const applyVrView = (next) => {
    setVrView(next)
    restoreVrView(fromOverlay(next))
  }

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
        const sensitivity = vrInputRef.current.dragSensitivity
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
      vrFovRef.current = clamp(vrFovRef.current + e.deltaY * vrInputRef.current.scrollSpeed, VR_FOV_MIN, VR_FOV_MAX)
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

  return {
    vrStart, setVrStart, vrStartRef,
    syncVrView, loadSavedVrView, applySourceFormat, resetVrView,
    // VR視点オーバーレイ（VrViewpointOverlay）
    vrView, overlayOpen, openVrOverlay, closeVrOverlay: () => setOverlayOpen(false),
    applyVrView, persistVRView,
  }
}
