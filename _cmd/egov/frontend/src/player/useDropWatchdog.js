import { useEffect, useRef, useState } from 'react'

// ファイルをドラッグしてきたときのドロップ表示（DropHint）の出し入れ。
//
// ドラッグ表示の解除は dragleave だけに頼れない。
// Linux(WebKitGTK)/macOS では relatedTarget=null の dragleave が即座に飛んでくるので
// 数えるとカウンタが狂い、Windows ではウィンドウ外へ抜けたときの dragleave も
// relatedTarget=null なので無視すると表示が残り続ける。
// dragover はドラッグ中ずっと（静止していても）発火し続けるため、
// 一定時間 dragover が来なくなったら「通り過ぎた」とみなして解除する。
//
// ファイルの読み込みはここでは行わない。Wails がネイティブ側でドロップを横取りし、
// Go の WindowFilesDropped → open-file イベントとして配送される。
// Linux/macOS ではそもそも drop イベントが来ず、Windows でも
// ランタイムが Go へ転送するため、ここで dataTransfer を読むと二重読み込みになる。
//
// 返り値の endDrag は安定した関数ではないが、ref と state の setter しか使わないので
// 一度だけ登録するリスナー（open-file）から初回の関数を呼んでもよい。
export default function useDropWatchdog() {
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)
  const dragTimer   = useRef(null)

  useEffect(() => () => clearTimeout(dragTimer.current), [])

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

  const onDragEnter = (e) => {
    e.preventDefault()
    dragCounter.current++
    setDragging(true)
    armDragWatchdog()
  }
  const onDragLeave = (e) => {
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
  const onDragOver = (e) => {
    e.preventDefault()
    if (dragging) armDragWatchdog()
  }
  const onDrop = (e) => {
    e.preventDefault()
    endDrag()
  }

  return { dragging, endDrag, dropHandlers: { onDragEnter, onDragLeave, onDragOver, onDrop } }
}
