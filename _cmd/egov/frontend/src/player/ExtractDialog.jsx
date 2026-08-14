import { useEffect, useRef, useState } from 'react'
import {
  Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, TextField, Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { SuggestExtractName } from '../../bindings/egov/api'
import { fmt } from './utils'

// 範囲切り出しの確認ダイアログ。保存先は元ファイルと同じフォルダ固定なので
// 入力させるのはファイル名のみ。既定値は Go 側に作らせる（衝突回避込み）。
export default function ExtractDialog({
  open, filePath, range, activeColor, extracting, error, onExtract, onClose,
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const inputRef = useRef(null)

  // 開くたびに現在の範囲に対する既定名を取り直し、拡張子を除いた部分を選択して
  // そのまま打ち換えられるようにする（OS のファイル名変更と同じ挙動）
  useEffect(() => {
    if (!open || !filePath || !range) return
    let alive = true
    setName('')
    SuggestExtractName(filePath, range.start, range.end)
      .then((n) => {
        if (!alive) return
        setName(n)
        requestAnimationFrame(() => {
          const el = inputRef.current
          if (!el) return
          const dot = n.lastIndexOf('.')
          el.focus()
          el.setSelectionRange(0, dot > 0 ? dot : n.length)
        })
      })
      .catch(() => { if (alive) setName('') })
    return () => { alive = false }
  }, [open, filePath, range])

  const submit = () => {
    if (!name.trim() || extracting) return
    onExtract(name.trim())
  }

  return (
    <Dialog
      open={open}
      onClose={extracting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{t('extract.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
            {range ? `${fmt(range.start)} - ${fmt(range.end)}` : ''}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('extract.keyframeNote')}
          </Typography>
          <TextField
            inputRef={inputRef}
            autoFocus
            fullWidth
            size="small"
            label={t('extract.fileName')}
            value={name}
            disabled={extracting}
            error={!!error}
            helperText={error ?? t('extract.sameFolder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Player 側のキー操作（コマ送り・シーク）へ抜けないよう止める
              e.stopPropagation()
              if (e.key === 'Enter') submit()
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={extracting} sx={{ color: 'text.secondary' }}>
          {t('settings.cancel')}
        </Button>
        <Button
          onClick={submit}
          disabled={extracting || !name.trim()}
          variant="contained"
          sx={{ bgcolor: activeColor, '&:hover': { bgcolor: activeColor, filter: 'brightness(1.1)' } }}
          startIcon={extracting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {extracting ? t('extract.running') : t('extract.run')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
