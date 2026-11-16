import { useEffect } from 'react'

// ウィンドウ全体のキー操作。
//   Ctrl+Shift+D … 診断オーバーレイの開閉（Escape で閉じる）
//   ← / →       … 再生中はシーク（設定 arrowSeekSecs）、一時停止中はコマ送り/戻し
//
// どちらもマウント時に一度だけ登録する。最新の値は ref から読み、渡された関数
// （doZoneSeek・setDiagOpen）は初回のものを持ち続ける。依存配列に足すと
// リスナーの付け外しのたびにコマ送りのラッチ（frameSeeking）が失われる。
export default function useKeyboardShortcuts({ videoRef, videoElRef, detectedFpsRef, controlSettingsRef, doZoneSeek, setDiagOpen }) {
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
    // コマ送りのラッチは本物の video 要素の seeked で解除する（AnimPlayer は stepFrame で別処理）
    const video = videoElRef.current
    video?.addEventListener('seeked', clearFrameSeek)
    video?.addEventListener('emptied', clearFrameSeek)
    video?.addEventListener('error', clearFrameSeek)

    const onKeyDown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const media = videoRef.current
      if (!media?.src) return
      e.preventDefault()
      const forward = e.key === 'ArrowRight'
      if (media.paused && media.stepFrame) {
        // アニメーション画像 はフレームの境界が分かっているのでそれを使う
        media.stepFrame(forward ? 1 : -1)
      } else if (media.paused) {
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
        doZoneSeek(controlSettingsRef.current.arrowSeekSecs, forward)
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
}
