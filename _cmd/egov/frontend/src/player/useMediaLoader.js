import { useEffect, useRef, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import { useTranslation } from 'react-i18next'
import { CanExtract, CloseAnimation, DetectVRFormat, MediaFilePattern, OpenAnimation, OpenLocalFile } from '../../bindings/egov/api'
import AnimPlayer from './AnimPlayer'
import { isImagePath, mayBeAnimatedPath } from './utils'

// 再生中のデコードエラーからの自動復旧。この時間内に RECOVER_MAX 回を超えて
// 落ちるならファイル側の問題とみなし、エラー表示（手動の読み込み直し）に任せる
const RECOVER_MAX       = 3
const RECOVER_WINDOW_MS = 60_000
// 同じ位置で続けて落ちたときに読み飛ばす秒数（回数ごとに増やす）
const RECOVER_SKIP_SECS = 2

// デコードエラーからの復旧状態（reloadMedia）。ファイルを開くたびに作り直す
//   loaded   … このファイルで一度でもフレームが出たか（出ていなければ復旧しない）
//   attempts / at … 直近の自動復旧の回数と時刻
//   failPos  … 前回落ちた再生位置（同じ所で落ち続けるなら読み飛ばす）
//   resumeAt … 読み込み直し中の再開位置。読み込み直しの途中で再び落ちたときに使う
//   onMeta   … 読み込み直し後に位置を戻す loadedmetadata のリスナー
const newRecovery = () => ({ loaded: false, attempts: 0, at: 0, failPos: -1, resumeAt: null, onMeta: null })

// メディア（動画・静止画・アニメーション画像）を開く・読み込み直す。
//
// 開いたときに Player 側で片付けるもの（サムネイル・範囲ループ・VR からの退避など）は
// onMediaChange({ kind, url }) で知らせる。kind は 'video' | 'image' | 'anim'。
//
// loadFilePath は一度だけ登録するリスナー（open-file・起動引数）から初回の関数のまま
// 呼ばれる。中で使う値は ref から読み、渡された関数（setter・applySourceFormat・
// onMediaChange）は初回のものでも動くようにしておくこと。
export default function useMediaLoader({
  videoRef, videoElRef, showImageRef, showVideoRef, showCanvasRef, refreshCanvasRef,
  setPaused, setDuration, setVideoEl, setVideoError, setNotice,
  reloadMediaRef, applySourceFormat, onMediaChange,
}) {
  const { t } = useTranslation()
  const [fileName,   setFileName]   = useState('')
  const [canExtract, setCanExtract] = useState(false)   // 無劣化切り出しが可能なコンテナか
  const [isImage,    setIsImage]    = useState(false)   // 静止画を表示中か（VR・再生系UIを無効にする）
  const [isAnim,     setIsAnim]     = useState(false)   // アニメーション画像を再生中か（VR・サムネイル系を無効にする）

  const loadSeqRef       = useRef(0)         // 非同期の応答が前のファイルのものでないかの判定用
  const filePathRef      = useRef('')        // 再生中ファイルのローカルパス（切り出し元）
  const mediaKindRef     = useRef('video')   // 'video' | 'image' | 'anim'（アニメーション画像）
  const animRef          = useRef(null)      // 再生中の AnimPlayer
  const recoveryRef      = useRef(newRecovery())
  const lastPlayErrorRef = useRef(null)      // 直近の play() 拒否理由（診断用）

  // play() は自動再生ポリシー等で拒否されることがある。
  // 拒否時は楽観的に false にした paused 状態を停止へ戻す。
  //
  // 特に Linux の WebKitGTK はミュートしていないメディアの自動再生に
  // ユーザー操作を要求するため、ファイルを開いた直後の play() は
  // NotAllowedError で必ず拒否される（Wails v3 alpha2.114 時点で
  // EnableAutoplayWithoutUserAction は darwin/iOS 専用でLinuxには無い）。
  // この場合クリック等の操作で再生できるので、停止状態に戻すだけでよい。
  const safePlay = (video) => {
    video.play().catch((err) => {
      lastPlayErrorRef.current = `${err?.name || 'Error'}: ${err?.message || err}`
      console.warn('video.play() rejected:', err)
      setPaused(true)
    })
  }

  // 再生途中のデコードエラーから復旧する。返り値 true = 読み込み直した（エラーは出さない）。
  //
  // 負荷が高いときなどに途中でデコーダが落ちると（MEDIA_ERR_DECODE）、video 要素は
  // エラー状態のまま固まり、以後の play() もシークも一切効かなくなる。
  // 同じ src で load() し直し、落ちた位置から再開する。
  // manual=true はエラー表示のボタンや再生操作から。回数制限を外して必ず読み直す。
  const reloadMedia = (manual) => {
    const video = videoElRef.current
    const r = recoveryRef.current
    if (!video || mediaKindRef.current !== 'video' || !video.getAttribute('src')) return false

    // 読み込み直しの途中で落ちた場合は currentTime が 0 に戻っているので、目指していた位置を使う
    let pos = r.resumeAt ?? video.currentTime
    if (!Number.isFinite(pos)) pos = 0

    if (manual) {
      r.attempts = 0
    } else {
      const code = video.error?.code
      if (code !== MediaError.MEDIA_ERR_DECODE && code !== MediaError.MEDIA_ERR_NETWORK) return false
      // 一度も映せていないファイルは中身が壊れているか未対応なので、読み直しても同じ
      if (!r.loaded) return false
      const now = Date.now()
      if (now - r.at > RECOVER_WINDOW_MS) r.attempts = 0
      if (r.attempts >= RECOVER_MAX) return false
      r.attempts++
      r.at = now
      // 前回落ちた所から先へ進めていないならデータ自体が壊れている。少しずつ先へ読み飛ばす
      if (r.attempts > 1 && Math.abs(pos - r.failPos) < RECOVER_SKIP_SECS * r.attempts) {
        pos = r.failPos + RECOVER_SKIP_SECS * (r.attempts - 1)
      } else {
        r.failPos = pos
      }
    }
    if (Number.isFinite(video.duration)) pos = Math.min(pos, Math.max(0, video.duration - 0.5))

    // 手動のときは再生を望んでいるとみなす。自動のときは落ちる前の状態に戻す
    const resumePlay = manual || !video.paused
    const seq = loadSeqRef.current
    if (r.onMeta) video.removeEventListener('loadedmetadata', r.onMeta)
    r.resumeAt = pos
    r.onMeta = () => {
      r.onMeta = null
      if (seq !== loadSeqRef.current) return   // 待っている間に別のファイルが開かれた
      r.resumeAt = null
      video.currentTime = pos
      if (resumePlay) { safePlay(video); setPaused(false) }
      else            setPaused(true)
    }
    video.addEventListener('loadedmetadata', r.onMeta, { once: true })
    video.load()
    setVideoError(null)
    if (!manual) setNotice({ severity: 'info', text: t('error.recovered') })
    return true
  }
  // video 要素のエラー（useThreeScene がマウント時の関数のまま呼ぶ）から最新の関数へ届ける
  reloadMediaRef.current = reloadMedia

  // 一度でもフレームが出たファイルだけをデコードエラーからの自動復旧の対象にする（reloadMedia）
  useEffect(() => {
    const video = videoElRef.current
    if (!video) return
    const onLoadedData = () => { recoveryRef.current.loaded = true }
    video.addEventListener('loadeddata', onLoadedData)
    return () => video.removeEventListener('loadeddata', onLoadedData)
  }, [])

  // ファイルから素材の形式（始点・投影方式・画角）を推定し、VR の既定へ重ねる
  const applyDetectedFormat = async (pathOrName, seq) => {
    let f = {}
    try {
      f = await DetectVRFormat(pathOrName) ?? {}
    } catch (err) {
      console.warn('DetectVRFormat failed:', err)
    }
    if (seq !== loadSeqRef.current) return
    applySourceFormat(f)
  }

  // 動画・画像の読み込みの共通部分。
  // 画像のときは video 要素を空にする。以後の再生・シーク・コマ送り・サムネイルは
  // すべて video.src の有無で早期 return するので、個別に分岐しなくて済む。
  //
  // アニメーション画像（WebP / GIF / APNG）は Go 側で全フレームを展開し、AnimPlayer（video 要素と同じ
  // インターフェース）を videoRef.current に差し替えて動画として扱う。
  const openMedia = async ({ url, name, path, image }) => {
    const video = videoElRef.current
    // Three.js の初期化に失敗している場合は video 要素が存在しない。
    // ここで例外にせず、初期化失敗のエラー表示をそのまま残す。
    if (!video) return
    const seq = ++loadSeqRef.current

    let anim = null
    if (image && path && mayBeAnimatedPath(path)) {
      try {
        const info = await OpenAnimation(path)
        if (info?.animated) anim = info
        // アニメーション AVIF は中身が MP4 と同じ構造で、video 要素がそのまま再生できる
        if (info?.asVideo) image = false
      } catch (err) {
        console.warn('OpenAnimation failed:', err)
        setNotice({ severity: 'warning', text: t('anim.fallback', { msg: err?.message ?? String(err) }) })
      }
      if (seq !== loadSeqRef.current) return
    } else if (mediaKindRef.current === 'anim') {
      CloseAnimation()   // 展開済みフレームを解放する
    }
    const kind = anim ? 'anim' : image ? 'image' : 'video'

    animRef.current?.dispose()
    animRef.current = null
    if (recoveryRef.current.onMeta) video.removeEventListener('loadedmetadata', recoveryRef.current.onMeta)
    recoveryRef.current = newRecovery()
    mediaKindRef.current = kind
    setVideoError(null)
    setFileName(name)
    filePathRef.current = path
    setCanExtract(false)
    setIsImage(kind === 'image')
    setIsAnim(kind === 'anim')

    if (kind !== 'video') {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    onMediaChange({ kind, url })

    if (kind === 'anim') {
      const u = new URL(url)
      const token = u.searchParams.get('token')
      const player = new AnimPlayer({
        info: anim,
        src: url,
        loop: video.loop,   // ループ設定は video 要素側にも揃えて持っている（handleLoopToggle）
        playbackRate: video.defaultPlaybackRate,   // 再生速度も同じ（handlePlaybackRateChange）
        frameUrl: (i) => `${u.origin}/animframe?token=${encodeURIComponent(token)}&id=${anim.id}&i=${i}`,
        onFrame: () => refreshCanvasRef.current?.(),
        onError: setVideoError,
      })
      animRef.current  = player
      videoRef.current = player
      setVideoEl(player)
      showCanvasRef.current?.(player.canvas)
      setDuration(player.duration)
      safePlay(player)
      setPaused(false)
      return
    }

    videoRef.current = video
    setVideoEl(video)

    if (kind === 'image') {
      setPaused(true)
      setDuration(0)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = url
      img.decode().then(
        () => { if (seq === loadSeqRef.current) showImageRef.current?.(img) },
        () => { if (seq === loadSeqRef.current) setVideoError('IMAGE_DECODE_FAILED') },
      )
      return
    }

    showVideoRef.current?.()
    video.src = url
    safePlay(video)
    setPaused(false)
    if (path) CanExtract(path).then(setCanExtract)
    applyDetectedFormat(path || name, seq)
  }

  // OpenLocalFile が返す URL（?path= に元のパスを持つ）を開く
  const loadFilePath = (fileUrl) => {
    if (!fileUrl) return
    if (!videoRef.current) return
    const filePath = new URL(fileUrl).searchParams.get('path') ?? ''
    openMedia({
      url: fileUrl,
      name: filePath.split(/[\\/]/).pop(),
      path: filePath,
      image: isImagePath(filePath),
    })
  }

  // ファイル選択ダイアログ。<input type="file"> はブラウザの制約でパスが取れず
  // （中身の Blob しか渡らない）、アニメーション画像の展開・無劣化切り出し・
  // VR形式の推定といった Go 側の処理ができないため、Wails のダイアログでパスを受け取る。
  // 見た目はどちらも OS 標準のダイアログ。
  const handleOpenFile = async () => {
    try {
      const path = await Dialogs.OpenFile({
        Title: t('menu.openFile'),
        Filters: [{ DisplayName: t('menu.mediaFiles'), Pattern: await MediaFilePattern() }],
        CanChooseFiles: true,
      })
      if (!path) return   // キャンセル
      loadFilePath(await OpenLocalFile(path))
    } catch (err) {
      console.error('open file failed:', err)
      setNotice({ severity: 'error', text: t('menu.openFailed', { msg: err?.message ?? String(err) }) })
    }
  }

  return {
    fileName, canExtract, isImage, isAnim,
    filePathRef, mediaKindRef, lastPlayErrorRef,
    loadFilePath, handleOpenFile, reloadMedia, safePlay,
  }
}
