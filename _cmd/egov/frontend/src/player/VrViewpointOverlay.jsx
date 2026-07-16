import { Box, Button, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material'
import ArrowUpwardIcon   from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowBackIcon     from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon  from '@mui/icons-material/ArrowForward'
import RestartAltIcon    from '@mui/icons-material/RestartAlt'
import { useTranslation } from 'react-i18next'

// 始点選択オーバーレイ内のボタン定義（コンパス配置）
const startButtons = [
  { value: 'top',    Icon: ArrowUpwardIcon,   col: 2, row: 1 },
  { value: 'left',   Icon: ArrowBackIcon,     col: 1, row: 2 },
  { value: 'right',  Icon: ArrowForwardIcon,  col: 3, row: 2 },
  { value: 'bottom', Icon: ArrowDownwardIcon, col: 2, row: 3 },
]

// VR始点選択＋視点調整オーバーレイ。
// vrView（度・半径比）の変更は onChange で即時反映、onCommit で既定として保存する。
export default function VrViewpointOverlay({
  onClose, vrStart, onVrStartChange, vrView, onChange, onCommit,
}) {
  const { t } = useTranslation()

  const sliderRows = [
    { key: 'pitch', label: t('vr.pitch'), min: -90,  max: 90,  step: 0.5,   reset: 0,  format: v => `${v.toFixed(1)}°` },
    { key: 'posY',  label: t('vr.posY'),  min: -0.9, max: 0.9, step: 0.005, reset: 0,  format: v => `${(v * 100).toFixed(1)}%` },
    { key: 'yaw',   label: t('vr.yaw'),   min: -180, max: 180, step: 0.5,   reset: 0,  format: v => `${v.toFixed(1)}°` },
    { key: 'posX',  label: t('vr.posX'),  min: -0.9, max: 0.9, step: 0.005, reset: 0,  format: v => `${(v * 100).toFixed(1)}%` },
    { key: 'fov',   label: t('vr.fov'),   min: 20,   max: 100, step: 1,     reset: 75, format: v => `${v.toFixed(0)}°` },
    { key: 'posZ',  label: t('vr.posZ'),  min: -0.9, max: 0.9, step: 0.005, reset: 0,  format: v => `${(v * 100).toFixed(1)}%` },
  ]

  return (
    <Box
      sx={{
        position: 'absolute', inset: 0, zIndex: 50,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 2,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)', letterSpacing: 4 }}>
        {t('vr.selectViewpoint')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 110px)',
          gridTemplateRows: 'repeat(3, 110px)',
          gap: 1.5,
        }}
        onClick={e => e.stopPropagation()}
      >
        {startButtons.map(({ value, Icon, col, row }) => (
          <Button
            key={value}
            onClick={() => onVrStartChange(value)}
            sx={{
              gridColumn: col, gridRow: row,
              width: '100%', height: '100%',
              color: vrStart === value ? '#000' : 'white',
              bgcolor: vrStart === value ? '#4fc3f7' : 'rgba(255,255,255,0.08)',
              border: '1px solid',
              borderColor: vrStart === value ? '#4fc3f7' : 'rgba(255,255,255,0.25)',
              borderRadius: 2,
              '&:hover': {
                bgcolor: vrStart === value ? '#81d4fa' : 'rgba(255,255,255,0.18)',
              },
            }}
          >
            <Icon sx={{ fontSize: 40 }} />
          </Button>
        ))}
      </Box>
      <Box
        sx={{
          width: 520, mt: 2,
          display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 3,
        }}
        onClick={e => e.stopPropagation()}
      >
        {sliderRows.map(({ key, label, min, max, step, reset, format }) => (
          <Box key={key} sx={{ mb: 1 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                {label}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: 'white', fontFamily: 'monospace' }}>
                  {format(vrView[key] ?? 0)}
                </Typography>
                <Tooltip title={t('vr.resetToZero')} placement="top">
                  <IconButton
                    size="small"
                    sx={{ color: 'rgba(255,255,255,0.4)', width: 18, height: 18, '&:hover': { color: 'white' } }}
                    onClick={() => {
                      onChange({ ...vrView, [key]: reset })
                      onCommit()
                    }}
                  >
                    <RestartAltIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
            <Slider
              min={min} max={max} step={step}
              value={vrView[key] ?? 0}
              onChange={(_, v) => onChange({ ...vrView, [key]: v })}
              onChangeCommitted={() => onCommit()}
              sx={{
                color: '#4fc3f7',
                '& .MuiSlider-thumb': { width: 16, height: 16 },
              }}
            />
          </Box>
        ))}
        <Button
          fullWidth
          size="small"
          sx={{
            mt: 0.5, gridColumn: '1 / -1', color: 'white',
            bgcolor: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.25)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
          }}
          onClick={() => onCommit()}
        >
          {t('vr.saveView')}
        </Button>
      </Box>
      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', mt: 1 }}>
        {t('vr.clickToClose')}
      </Typography>
    </Box>
  )
}
