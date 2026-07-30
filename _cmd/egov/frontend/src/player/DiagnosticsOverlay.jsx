import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'

// 再生できない環境（特にLinux/WebKitGTK）の切り分け用オーバーレイ。
// devtoolsの無いプロダクションビルドでも Ctrl+Shift+D で開ける。
//
// 「UIは出るのに映像だけ出ない」ときに詰まりうる箇所は3つあり、
// この画面の数値だけでどれかを判別できるようにしてある：
//   1. HTTP取得/CORS  … fetch(Range) の結果と networkState
//   2. デコード        … readyState / videoWidth / currentTime / 2D drawImage
//   3. WebGLへの転送   … webgl の vendor/renderer と frames/renders カウンタ

const NETWORK_STATE = ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE']
const READY_STATE   = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA']

const CODECS = [
  ['H.264/AAC', 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'],
  ['H.265',     'video/mp4; codecs="hev1.1.6.L93.B0"'],
  ['VP9',       'video/webm; codecs="vp9"'],
  ['AV1',       'video/mp4; codecs="av01.0.05M.08"'],
]

// WebGLコンテキストからGPU情報を読む。取得できない場合は理由を返す。
function webglInfo(renderer) {
  if (!renderer) return { ok: false, detail: 'renderer なし（初期化失敗）' }
  const gl = renderer.getContext()
  if (!gl) return { ok: false, detail: 'context なし' }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    ok: true,
    version: gl.getParameter(gl.VERSION),
    vendor:  dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)   : gl.getParameter(gl.VENDOR),
    device:  dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    lost:    gl.isContextLost(),
  }
}

// video の現在フレームを2Dキャンバスへ転写して、黒以外の画素があるか調べる。
// WebGL経路と独立にデコード結果を確認でき、CORS汚染は SecurityError で判別できる。
function decodeProbe(video) {
  if (!video || !video.videoWidth) return 'videoWidth=0（フレーム未取得）'
  try {
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 32
    const ctx = c.getContext('2d')
    ctx.drawImage(video, 0, 0, 32, 32)
    const { data } = ctx.getImageData(0, 0, 32, 32)
    let max = 0
    for (let i = 0; i < data.length; i += 4) {
      max = Math.max(max, data[i], data[i + 1], data[i + 2])
    }
    return max === 0 ? 'OK（ただし全画素が黒）' : `OK（最大輝度 ${max}）`
  } catch (err) {
    // CORS失敗でキャンバスが汚染されると getImageData が SecurityError を投げる
    return `失敗: ${err?.name || ''} ${err?.message || err}`
  }
}

export default function DiagnosticsOverlay({ videoRef, rendererRef, frameCountRef, renderCountRef, lastPlayErrorRef, onClose }) {
  const [info, setInfo]   = useState(null)
  const [fetchResult, setFetchResult] = useState('未実行')

  const collect = useCallback(() => {
    const video = videoRef.current
    const gl    = webglInfo(rendererRef.current)
    setInfo({
      ua: navigator.userAgent,
      webgl: gl.ok
        ? `${gl.vendor} / ${gl.device} / ${gl.version}${gl.lost ? ' ★CONTEXT LOST' : ''}`
        : `利用不可: ${gl.detail}`,
      hasVideoEl: !!video,
      src: video?.src || '(なし)',
      networkState: video ? `${video.networkState} ${NETWORK_STATE[video.networkState] ?? ''}` : '-',
      readyState:   video ? `${video.readyState} ${READY_STATE[video.readyState] ?? ''}` : '-',
      error: video?.error ? `code=${video.error.code} ${video.error.message || ''}` : 'なし',
      size: video ? `${video.videoWidth}x${video.videoHeight}` : '-',
      time: video ? `${video.currentTime.toFixed(2)} / ${Number.isFinite(video.duration) ? video.duration.toFixed(2) : '?'}` : '-',
      playback: video ? `paused=${video.paused} muted=${video.muted} volume=${video.volume}` : '-',
      rvfc: typeof videoRef.current?.requestVideoFrameCallback === 'function' ? 'あり' : 'なし（rAFフォールバック）',
      frames: `${frameCountRef.current} frames / ${renderCountRef.current} renders`,
      decode: decodeProbe(video),
      codecs: CODECS.map(([label, type]) => `${label}: ${video?.canPlayType(type) || 'no'}`).join(' , '),
      playError: lastPlayErrorRef?.current || 'なし',
    })
  }, [videoRef, rendererRef, frameCountRef, renderCountRef, lastPlayErrorRef])

  useEffect(() => {
    collect()
    const id = setInterval(collect, 1000)
    return () => clearInterval(id)
  }, [collect])

  // ローカルHTTPサーバへの到達性とCORSを、video要素とは独立に確かめる。
  // Rangeを付けるのは実際の再生と同じ経路（206応答）を通すため。
  const runFetchTest = async () => {
    const src = videoRef.current?.src
    if (!src) {
      setFetchResult('src が未設定')
      return
    }
    setFetchResult('実行中...')
    try {
      const res = await fetch(src, { headers: { Range: 'bytes=0-1023' } })
      const buf = await res.arrayBuffer()
      setFetchResult(`status=${res.status} type=${res.type} bytes=${buf.byteLength} content-type=${res.headers.get('content-type') || '-'}`)
    } catch (err) {
      setFetchResult(`失敗（CORS/接続）: ${err?.name || ''} ${err?.message || err}`)
    }
  }

  if (!info) return null

  const rows = [
    ['UserAgent',      info.ua],
    ['WebGL',          info.webgl],
    ['video要素',      info.hasVideoEl ? 'あり' : 'なし（Three.js初期化失敗）'],
    ['src',            info.src],
    ['networkState',   info.networkState],
    ['readyState',     info.readyState],
    ['MediaError',     info.error],
    ['解像度',         info.size],
    ['再生位置',       info.time],
    ['再生状態',       info.playback],
    ['play()拒否理由', info.playError],
    ['rVFC',           info.rvfc],
    ['描画カウンタ',   info.frames],
    ['2Dデコード確認', info.decode],
    ['canPlayType',    info.codecs],
    ['HTTP取得テスト', fetchResult],
  ]

  return (
    <Box sx={{
      position: 'absolute', inset: 0, zIndex: 40,
      bgcolor: 'rgba(0,0,0,0.88)', color: 'white',
      overflow: 'auto', p: 2,
      fontFamily: 'monospace', fontSize: 12,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 'bold', flexGrow: 1 }}>
          Diagnostics
        </Typography>
        <Button size="small" variant="outlined" onClick={runFetchTest}>HTTP取得テスト</Button>
        <Button size="small" variant="outlined" onClick={onClose}>閉じる (Esc)</Button>
      </Box>
      <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <Box component="td" sx={{
                verticalAlign: 'top', pr: 2, py: 0.4, whiteSpace: 'nowrap',
                color: 'rgba(255,255,255,0.55)', borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}>{k}</Box>
              <Box component="td" sx={{
                py: 0.4, wordBreak: 'break-all',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}>{v}</Box>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  )
}
