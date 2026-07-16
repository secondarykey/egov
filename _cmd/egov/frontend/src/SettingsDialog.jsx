import { useRef, useState, useEffect } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, IconButton, MenuItem, Paper, Select, Slider,
  Stack, Switch, Tab, Tabs, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import Draggable from 'react-draggable'
import { GetDefaultSettings, GetSettings, GetVersion, UpdateActiveColor, UpdateAppSettings, UpdateControlSettings, UpdateDefaultMode, UpdateVRSettings } from '../bindings/egov/api'
import { useTranslation } from 'react-i18next'

function DraggablePaper(props) {
  const nodeRef = useRef(null)
  return (
    <Draggable nodeRef={nodeRef} handle="#settings-dialog-title" cancel='[class*="MuiDialogContent-root"],[class*="MuiDialogActions-root"]'>
      <Paper ref={nodeRef} {...props} />
    </Draggable>
  )
}

function TabPanel({ value, index, children }) {
  return (
    <Box sx={{ pt: 2.5, display: value === index ? 'block' : 'none' }}>
      {children}
    </Box>
  )
}

function Row({ label, children }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', mb: 2.5 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', width: 180, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Stack>
  )
}

function SliderRow({ label, value, onChange, min, max, step, format }) {
  return (
    <Row label={label}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Slider min={min} max={max} step={step} value={value} onChange={(_, v) => onChange(v)} size="small" />
        <Typography variant="body2" sx={{ minWidth: 64, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {format ? format(value) : value}
        </Typography>
      </Stack>
    </Row>
  )
}

export default function SettingsDialog({ open, onClose, availableLangs, onLanguageChange, activeColor: activeColorProp, onActiveColorChange, acceptInactiveClick: acceptInactiveProp, onAcceptInactiveClickChange, miniProgressBar: miniProgressProp, onMiniProgressBarChange, thumbEnabled: thumbEnabledProp, onThumbEnabledChange, onControlsChange }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState(0)
  const [version, setVersion] = useState('')

  // defaults は「デフォルトに戻す」用。既定値の定義は Go 側 defaultSettings() に一元化されている。
  const [defaults, setDefaults] = useState(null)
  useEffect(() => {
    GetVersion().then(setVersion)
    GetDefaultSettings().then(setDefaults)
  }, [])
  const [playback, setPlayback] = useState({ defaultMode: 'normal', language: 'en', activeColor: '#4fc3f7', thumbnailEnabled: true })
  const [vr, setVr] = useState({ initialPitch: 0, initialYaw: 0, positionX: 0, positionY: 0, positionZ: 0, fov: 75, dragSensitivity: 0.004, scrollSpeed: 0.05, defaultStart: 'left' })
  const [controls, setControls] = useState({
    clickTimeoutMs: 300, doubleClickSeekSecs: 10, dragSeekSecs: 10,
    fastSeekSecs: 60, arrowSeekSecs: 5,
    uiHideDelayMs: 1500, uiHideOnLeaveDelayMs: 800,
  })
  const [origLanguage, setOrigLanguage] = useState('en')
  const [appSettings, setAppSettings] = useState({ singleInstance: false })

  useEffect(() => {
    if (!open) return
    // 設定値は Go 側で正規化済みのため、フォールバックなしでそのまま使える
    GetSettings().then(s => {
      setPlayback({ defaultMode: s.playback.defaultMode, language: s.playback.language, activeColor: s.playback.activeColor, thumbnailEnabled: thumbEnabledProp ?? s.playback.thumbnailEnabled })
      setOrigLanguage(s.playback.language)
      setVr(s.vr)
      setControls(s.controls)
      setAppSettings(s.app)
    })
  }, [open])

  const handleSave = async () => {
    await Promise.all([
      UpdateDefaultMode(playback.defaultMode),
      UpdateActiveColor(playback.activeColor),
      UpdateVRSettings(vr),
      UpdateControlSettings(controls),
      UpdateAppSettings(appSettings),
    ])
    onControlsChange?.(controls)
    if (playback.language !== origLanguage) {
      onLanguageChange?.(playback.language)
    }
    onActiveColorChange?.(playback.activeColor)
    if (playback.thumbnailEnabled !== thumbEnabledProp) {
      onThumbEnabledChange?.(playback.thumbnailEnabled)
    }
    if ((appSettings.acceptInactiveClick ?? false) !== (acceptInactiveProp ?? false)) {
      onAcceptInactiveClickChange?.(appSettings.acceptInactiveClick)
    }
    if ((appSettings.miniProgressBar ?? false) !== (miniProgressProp ?? false)) {
      onMiniProgressBarChange?.(appSettings.miniProgressBar)
    }
    onClose()
  }

  const setV = (k) => (v) => setVr(s => ({ ...s, [k]: v }))
  const setC = (k) => (v) => setControls(s => ({ ...s, [k]: v }))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperComponent={DraggablePaper}
      sx={{ '& .MuiDialog-paper': { width: 640, maxHeight: 'none' } }}
    >
      <DialogTitle
        id="settings-dialog-title"
        sx={{ pb: 1, cursor: 'move', pr: 6, userSelect: 'none' }}
      >
        {t('settings.title')}
        {version && (
          <Box component="span" sx={{ ml: 1, fontSize: '0.75rem', color: 'text.disabled', fontFamily: 'monospace', verticalAlign: 'middle' }}>
            v{version}
          </Box>
        )}
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 0, flex: 1, overflow: 'auto' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', mb: 0 }}>
          <Tab label={t('settings.tab.playback')} />
          <Tab label={t('settings.tab.vr')} />
          <Tab label={t('settings.tab.controls')} />
          <Tab label={t('settings.tab.app')} />
        </Tabs>

        <Box sx={{ minHeight: 320 }}>
        {/* Playback */}
        <TabPanel value={tab} index={0}>
          <Row label={t('settings.playback.language')}>
            <FormControl size="small" fullWidth>
              <Select value={playback.language} onChange={e => setPlayback(p => ({ ...p, language: e.target.value }))}>
                {availableLangs.map(l => (
                  <MenuItem key={l.code} value={l.code}>{l.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Row>
          <Row label={t('settings.playback.defaultMode')}>
            <FormControl size="small" fullWidth>
              <Select value={playback.defaultMode} onChange={e => setPlayback(p => ({ ...p, defaultMode: e.target.value }))}>
                <MenuItem value="normal">{t('mode.normal')}</MenuItem>
                <MenuItem value="free">{t('mode.free')}</MenuItem>
                <MenuItem value="vr">VR</MenuItem>
              </Select>
            </FormControl>
          </Row>
          <Row label={t('settings.playback.activeColor')}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box
                component="input"
                type="color"
                value={playback.activeColor}
                onChange={e => setPlayback(p => ({ ...p, activeColor: e.target.value }))}
                sx={{
                  width: 40, height: 32, p: 0, border: '1px solid',
                  borderColor: 'divider', borderRadius: 1, cursor: 'pointer',
                  bgcolor: 'transparent',
                }}
              />
              <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary', lineHeight: '32px' }}>
                {playback.activeColor}
              </Typography>
            </Stack>
          </Row>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button size="small" sx={{ whiteSpace: 'nowrap', minWidth: 'fit-content' }} onClick={() => defaults && setPlayback(p => ({ ...p, defaultMode: defaults.playback.defaultMode, activeColor: defaults.playback.activeColor }))}>
              {t('settings.resetDefaults')}
            </Button>
          </Box>
        </TabPanel>

        {/* VR */}
        <TabPanel value={tab} index={1}>
          <SliderRow label={t('settings.vr.fov')}
            value={vr.fov} onChange={setV('fov')}
            min={30} max={120} step={1}
            format={v => `${v}°`}
          />
          <SliderRow label={t('settings.vr.dragSensitivity')}
            value={vr.dragSensitivity} onChange={setV('dragSensitivity')}
            min={0.001} max={0.02} step={0.001}
            format={v => v.toFixed(3)}
          />
          <SliderRow label={t('settings.vr.scrollSpeed')}
            value={vr.scrollSpeed} onChange={setV('scrollSpeed')}
            min={0.01} max={0.3} step={0.01}
            format={v => v.toFixed(2)}
          />
          <Row label={t('settings.vr.defaultStart')}>
            <FormControl size="small" fullWidth>
              <Select value={vr.defaultStart} onChange={e => setVr(s => ({ ...s, defaultStart: e.target.value }))}>
                <MenuItem value="left">{t('vr.side.left')}</MenuItem>
                <MenuItem value="right">{t('vr.side.right')}</MenuItem>
                <MenuItem value="top">{t('vr.side.top')}</MenuItem>
                <MenuItem value="bottom">{t('vr.side.bottom')}</MenuItem>
              </Select>
            </FormControl>
          </Row>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button size="small" sx={{ whiteSpace: 'nowrap', minWidth: 'fit-content' }} onClick={() => defaults && setVr(defaults.vr)}>
              {t('settings.resetDefaults')}
            </Button>
          </Box>
        </TabPanel>

        {/* Controls */}
        <TabPanel value={tab} index={2}>
          <SliderRow label={t('settings.controls.clickTimeout')}
            value={controls.clickTimeoutMs} onChange={setC('clickTimeoutMs')}
            min={100} max={1000} step={50}
            format={v => `${v} ms`}
          />
          <SliderRow label={t('settings.controls.doubleClickSeek')}
            value={controls.doubleClickSeekSecs} onChange={setC('doubleClickSeekSecs')}
            min={1} max={60} step={1}
            format={v => `${v} s`}
          />
          <SliderRow label={t('settings.controls.dragSeek')}
            value={controls.dragSeekSecs ?? 10} onChange={setC('dragSeekSecs')}
            min={1} max={60} step={1}
            format={v => `${v} s`}
          />
          <SliderRow label={t('settings.controls.fastSeek')}
            value={controls.fastSeekSecs ?? 60} onChange={setC('fastSeekSecs')}
            min={10} max={300} step={10}
            format={v => `${v} s`}
          />
          <SliderRow label={t('settings.controls.arrowSeek')}
            value={controls.arrowSeekSecs ?? 5} onChange={setC('arrowSeekSecs')}
            min={1} max={60} step={1}
            format={v => `${v} s`}
          />
          <SliderRow label={t('settings.controls.uiHideDelay')}
            value={controls.uiHideDelayMs} onChange={setC('uiHideDelayMs')}
            min={500} max={5000} step={100}
            format={v => `${v} ms`}
          />
          <SliderRow label={t('settings.controls.uiHideOnLeave')}
            value={controls.uiHideOnLeaveDelayMs} onChange={setC('uiHideOnLeaveDelayMs')}
            min={100} max={3000} step={100}
            format={v => `${v} ms`}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button size="small" sx={{ whiteSpace: 'nowrap', minWidth: 'fit-content' }} onClick={() => defaults && setControls(defaults.controls)}>
              {t('settings.resetDefaults')}
            </Button>
          </Box>
        </TabPanel>
        {/* App */}
        <TabPanel value={tab} index={3}>
          <Row label={t('settings.app.thumbnailEnabled')}>
            <FormControlLabel
              control={
                <Switch
                  checked={playback.thumbnailEnabled}
                  onChange={e => setPlayback(p => ({ ...p, thumbnailEnabled: e.target.checked }))}
                />
              }
              label=""
            />
          </Row>
          <Row label={t('settings.app.acceptInactiveClick')}>
            <FormControlLabel
              control={
                <Switch
                  checked={appSettings.acceptInactiveClick ?? false}
                  onChange={e => setAppSettings(s => ({ ...s, acceptInactiveClick: e.target.checked }))}
                />
              }
              label=""
            />
          </Row>
          <Row label={t('settings.app.miniProgressBar')}>
            <FormControlLabel
              control={
                <Switch
                  checked={appSettings.miniProgressBar ?? false}
                  onChange={e => setAppSettings(s => ({ ...s, miniProgressBar: e.target.checked }))}
                />
              }
              label=""
            />
          </Row>
          <Row label={t('settings.app.singleInstance')}>
            <FormControlLabel
              control={
                <Switch
                  checked={appSettings.singleInstance}
                  onChange={e => setAppSettings(s => ({ ...s, singleInstance: e.target.checked }))}
                />
              }
              label=""
            />
          </Row>
          <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: -1.5 }}>
            {t('settings.app.restartRequired')}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button size="small" sx={{ whiteSpace: 'nowrap', minWidth: 'fit-content' }} onClick={() => {
              if (!defaults) return
              // alwaysOnTop はタイトルバー側の状態と連動するためリセット対象外
              setAppSettings(s => ({
                ...s,
                singleInstance:      defaults.app.singleInstance,
                acceptInactiveClick: defaults.app.acceptInactiveClick,
                miniProgressBar:     defaults.app.miniProgressBar,
              }))
              setPlayback(p => ({ ...p, thumbnailEnabled: defaults.playback.thumbnailEnabled }))
            }}>
              {t('settings.resetDefaults')}
            </Button>
          </Box>
        </TabPanel>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ whiteSpace: 'nowrap', minWidth: 100 }}>{t('settings.cancel')}</Button>
        <Button onClick={handleSave} variant="contained" sx={{ whiteSpace: 'nowrap', minWidth: 100 }}>{t('settings.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}
