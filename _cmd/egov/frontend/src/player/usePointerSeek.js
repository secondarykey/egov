import { useEffect, useRef, useState } from 'react'
import { isResizeEdge } from './utils'

// 押し込み中にこの距離（px）を超えて動いたらドラッグ操作とみなし、
// シークコントローラーは表示しない（free/vr モードの視点操作を邪魔しないため）
const HOLD_MOVE_TOLERANCE = 8

// 映像の上での左ボタン操作。
//   クリック      … 再生/一時停止（クリック判定時間だけ待ってからダブルクリックと区別する）
//   ダブルクリック … 画面の左右半分で前後へシーク（コントローラーは出さない）
//   長押し        … ゾーンシークのコントローラー（SeekZoneOverlay）を出し、移動量で早送り/巻き戻し
//
// 設定値は controlSettingsRef / appSettingsRef から読む。doZoneSeek は ref と
// state の setter しか使わないので、一度だけ登録するリスナー（矢印キー）から
// 初回の関数を呼んでもよい。
export default function usePointerSeek({ videoRef, controlSettingsRef, appSettingsRef, onPlayPause }) {
  const [clickFeedback,  setClickFeedback]  = useState(null)
  const [seekFeedback,   setSeekFeedback]   = useState(null)
  const [seekOverlay,    setSeekOverlay]    = useState(null)   // { x, y } or null
  const [seekZoneActive, setSeekZoneActive] = useState(null)   // { seconds, forward } or null

  const feedbackKeyRef         = useRef(0)
  const seekFeedbackKeyRef     = useRef(0)
  const clickTimerRef          = useRef(null)
  const holdTimerRef           = useRef(null)
  const holdOriginRef          = useRef(null)   // 押し込み開始座標。オーバーレイ表示までの移動量判定に使う
  const wasHoldRef             = useRef(false)
  const lastPointerDownTimeRef = useRef(0)
  const isMouseHeldRef         = useRef(false)
  const seekZoneTimerRef       = useRef(null)
  const seekZoneRef            = useRef(null)
  const seekOverlayRef         = useRef(null)
  const justFocusedRef         = useRef(false)
  const focusTimerRef          = useRef(null)

  // 非アクティブなウィンドウへのクリック（フォーカスを取るだけのクリック）を
  // 再生/一時停止にしないための判定（設定 acceptInactiveClick で無効にできる）
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

  // ウィンドウ全体の mousemove から呼ぶ
  const onPointerMove = (e) => {
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
    // シークオーバーレイのゾーン検出（seekOverlay state が設定された後＝長押し成立後のみ）
    if (seekOverlay && isMouseHeldRef.current) {
      const { fastSeekSecs, dragSeekSecs } = controlSettingsRef.current
      const dx = e.clientX - seekOverlay.x
      const dy = Math.abs(e.clientY - seekOverlay.y)
      if (dy > 55) {
        stopZoneSeek()
      } else if (dx > 75) {
        startZoneSeek(fastSeekSecs, true)
      } else if (dx > 20) {
        startZoneSeek(dragSeekSecs, true)
      } else if (dx < -75) {
        startZoneSeek(fastSeekSecs, false)
      } else if (dx < -20) {
        startZoneSeek(dragSeekSecs, false)
      } else {
        stopZoneSeek()
      }
    }
  }

  // ウィンドウ全体の mouseleave から呼ぶ
  const onPointerLeave = () => {
    if (seekOverlayRef.current) hideSeekOverlay()
  }

  // ダブルクリック: 即座に単純な早送り/巻き戻しを実行（コントローラーは出さない）
  // シングルクリックでも一定時間保持し続けたらコントローラー（オーバーレイ）を表示する
  const onMouseDown = (e) => {
    if (e.button !== 0) return
    // 動画が無い（未選択・画像表示中）ときは長押しシークもダブルクリックシークも無い
    if (!videoRef.current?.src) return
    // ウィンドウ枠のリサイズ域では何もしない（utils.isResizeEdge 参照）。
    // ここで長押しオーバーレイを開くと、リサイズ中は mouseup が
    // ランタイムに握り潰されるため閉じられず、早送りが続いてしまう。
    if (isResizeEdge(e.clientX, e.clientY)) return
    // 前回のジェスチャで click が来ないまま残った抑止フラグを引きずらない
    wasHoldRef.current = false
    const pos = { x: e.clientX, y: e.clientY }
    const now = Date.now()
    const isDouble = e.detail >= 2 || (now - lastPointerDownTimeRef.current) <= controlSettingsRef.current.clickTimeoutMs
    lastPointerDownTimeRef.current = isDouble ? 0 : now

    // 画面中央（x > cx で前方向）を境にダブルクリックシークの方向を決める
    const cx = window.innerWidth / 2

    if (isDouble) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      doZoneSeek(controlSettingsRef.current.doubleClickSeekSecs, pos.x > cx)
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

  const onMouseUp = () => {
    clearTimeout(holdTimerRef.current)
    holdOriginRef.current = null
    if (isMouseHeldRef.current) hideSeekOverlay()
  }

  const onClick = (e) => {
    // 枠を掴んだつもりの操作で再生/一時停止が切り替わらないよう、
    // mousedown と同じ領域をクリックでも無視する
    if (isResizeEdge(e.clientX, e.clientY)) return
    if (wasHoldRef.current) {
      wasHoldRef.current = false
      return
    }
    if (justFocusedRef.current && !appSettingsRef.current.acceptInactiveClick) {
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
      onPlayPause()
      feedbackKeyRef.current++
      setClickFeedback({ type: willPlay ? 'play' : 'pause', key: feedbackKeyRef.current })
    }, controlSettingsRef.current.clickTimeoutMs)
  }

  return {
    doZoneSeek,
    onPointerMove,
    onPointerLeave,
    // 映像（mount）の要素に付けるハンドラ。外へ出たら押し込みを終える
    canvasHandlers: { onClick, onMouseDown, onMouseUp, onMouseLeave: onMouseUp },
    clickFeedback, clearClickFeedback: () => setClickFeedback(null),
    seekFeedback,  clearSeekFeedback:  () => setSeekFeedback(null),
    seekOverlay,
    seekZoneActive,
  }
}
