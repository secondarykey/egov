// アニメーション画像（WebP / GIF / APNG）を HTMLVideoElement と同じ顔で再生するプレーヤー。
//
// フレームは Go 側（API.OpenAnimation）で合成済みの RGBA として保持されており、
// /animframe から1枚ずつ取り寄せて自前の canvas へ描く。Player は videoRef.current を
// これに差し替えるだけで、シークバー・時間表示・範囲ループ・ダブルクリックシークなど
// video 要素前提の処理をそのまま使える。対応しているのはそれらが触る範囲
// （currentTime / duration / paused / loop / play() / pause() と
// play・pause・seeked・timeupdate・ended・loadeddata イベント）だけ。
// 音声は無いので volume / muted は値を保持するだけ。

const CACHE_FRAMES   = 8     // 取り寄せ済みフレームの保持数（シーク往復・ループ先頭用）
const TIMEUPDATE_MS  = 250   // video 要素と同程度の頻度で timeupdate を出す

export default class AnimPlayer extends EventTarget {
  // info: API.OpenAnimation の戻り値 / frameUrl(i): フレーム取得URL
  // onFrame(): canvas を描き換えた直後に呼ぶ（テクスチャ更新用）
  constructor({ info, src, frameUrl, loop, onFrame, onError }) {
    super()
    this.src         = src
    this.videoWidth  = info.width
    this.videoHeight = info.height
    this.loop        = loop
    this.volume      = 1
    this.muted       = false
    this.paused      = true
    this.ended       = false
    this.readyState  = 0
    this.error       = null

    this.canvas = document.createElement('canvas')
    this.canvas.width  = info.width
    this.canvas.height = info.height
    this._ctx = this.canvas.getContext('2d')

    // 各フレームの開始時刻（秒）。最後の要素が全体の長さ
    this._starts = [0]
    for (const ms of info.durationsMs) this._starts.push(this._starts.at(-1) + ms / 1000)
    this.duration = this._starts.at(-1)
    this.frameCount = info.durationsMs.length

    this._frameUrl = frameUrl
    this._onFrame  = onFrame
    this._onError  = onError
    this._time     = 0
    this._shown    = -1       // canvas に描いてあるフレーム
    this._want     = 0        // 表示したいフレーム
    this._loading  = -1       // 取り寄せ中のフレーム
    this._cache    = new Map()   // i -> ImageData（挿入順を LRU に使う）
    this._seekPending = false
    this._clockBase   = 0     // 再生中: performance.now() - currentTime*1000
    this._raf         = null
    this._lastTimeupdate = 0
    this._disposed    = false

    this._request(0)
  }

  get currentTime() { return this._time }
  set currentTime(t) {
    if (this._disposed) return
    this._time  = Math.max(0, Math.min(this.duration, Number(t) || 0))
    this.ended  = false
    if (!this.paused) this._clockBase = performance.now() - this._time * 1000
    // video 要素は同じフレームへのシークでも seeked を出すので揃える
    this._seekPending = true
    this._request(this._frameAt(this._time))
  }

  // Player のコマ送り（←/→）用。一時停止中に1フレームずつ動かす
  stepFrame(dir) {
    const i = Math.max(0, Math.min(this.frameCount - 1, this._frameAt(this._time) + dir))
    this.currentTime = this._starts[i]
  }

  play() {
    if (this._disposed) return Promise.resolve()
    if (this.ended || this._time >= this.duration) this._time = 0
    this.ended  = false
    if (this.paused) {
      this.paused = false
      this._clockBase = performance.now() - this._time * 1000
      this._emit('play')
      this._emit('playing')
      this._raf = requestAnimationFrame(this._tick)
    }
    return Promise.resolve()
  }

  pause() {
    if (this.paused) return
    this.paused = true
    cancelAnimationFrame(this._raf)
    this._raf = null
    this._emit('pause')
  }

  dispose() {
    this.pause()
    this._disposed = true
    this._cache.clear()
  }

  _tick = (now) => {
    if (this.paused || this._disposed) return
    let t = (now - this._clockBase) / 1000
    if (t >= this.duration) {
      if (this.loop) {
        t %= this.duration
        this._clockBase = now - t * 1000
      } else {
        this._time = this.duration
        this.paused = true
        this.ended  = true
        this._raf   = null
        this._request(this.frameCount - 1)
        this._emit('timeupdate')
        this._emit('pause')
        this._emit('ended')
        return
      }
    }
    this._time = t
    this._request(this._frameAt(t))
    if (now - this._lastTimeupdate >= TIMEUPDATE_MS) {
      this._lastTimeupdate = now
      this._emit('timeupdate')
    }
    this._raf = requestAnimationFrame(this._tick)
  }

  _frameAt(t) {
    // _starts[i] <= t < _starts[i+1] となる i
    let lo = 0, hi = this.frameCount - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this._starts[mid] <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  _request(i) {
    this._want = i
    if (i === this._shown) {
      this._settleSeek()
      return
    }
    const cached = this._cache.get(i)
    if (cached) {
      this._draw(i, cached)
      return
    }
    this._fetch(i, false)
  }

  // 取り寄せは常に1本だけ。届いたときに一番新しい要求（_want）へ追いつく。
  // prefetch=true で取ったフレームはキャッシュに入れるだけで描かない。
  async _fetch(i, prefetch) {
    if (this._loading !== -1) return
    this._loading = i
    let img
    try {
      const res = await fetch(this._frameUrl(i))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const expected = this.videoWidth * this.videoHeight * 4
      if (buf.byteLength !== expected) throw new Error(`frame ${i}: ${buf.byteLength} bytes, want ${expected}`)
      img = new ImageData(new Uint8ClampedArray(buf), this.videoWidth, this.videoHeight)
    } catch (err) {
      this._loading = -1
      if (this._disposed) return
      this.error = { code: 4, message: String(err?.message ?? err) }
      this._onError?.(`ANIM_FRAME_FAILED: ${this.error.message}`)
      this._emit('error')
      return
    }
    this._loading = -1
    if (this._disposed) return
    this._cache.set(i, img)
    if (this._cache.size > CACHE_FRAMES) this._cache.delete(this._cache.keys().next().value)

    const want = this._want
    if (want === i && !prefetch) {
      this._draw(i, img)
    } else if (!prefetch && !this.paused) {
      // 再生が取り寄せより速い。遅れていても届いた絵は出す（止まって見えるよりよい）
      this._draw(i, img)
    } else if (want !== this._shown) {
      this._request(want)
    }
  }

  _draw(i, img) {
    if (this._disposed) return
    this._ctx.putImageData(img, 0, 0)
    this._shown = i
    this._onFrame?.()
    if (this.readyState < 4) {
      this.readyState = 4
      this._emit('loadeddata')
    }
    if (this._want !== i) {
      this._request(this._want)
      return
    }
    this._settleSeek()
    // 再生中は次のフレーム（末尾ならループ先頭）を先読みしておく
    if (!this.paused) {
      const next = (i + 1) % this.frameCount
      if (!this._cache.has(next)) this._fetch(next, true)
    }
  }

  _settleSeek() {
    if (!this._seekPending) return
    this._seekPending = false
    this._emit('seeked')
    this._emit('timeupdate')
  }

  _emit(type) {
    this.dispatchEvent(new Event(type))
  }
}
