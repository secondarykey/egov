import { useState } from 'react'
import {
  Box, IconButton, Menu, MenuItem, Stack,
  ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material'
import FolderOpenIcon    from '@mui/icons-material/FolderOpen'
import MenuIcon          from '@mui/icons-material/Menu'
import MinimizeIcon      from '@mui/icons-material/Minimize'
import CropSquareIcon    from '@mui/icons-material/CropSquare'
import CloseIcon         from '@mui/icons-material/Close'
import GridViewIcon      from '@mui/icons-material/GridView'
import VrpanoIcon        from '@mui/icons-material/Vrpano'
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo'
import OpenWithIcon      from '@mui/icons-material/OpenWith'
import RotateRightIcon   from '@mui/icons-material/RotateRight'
import PushPinIcon       from '@mui/icons-material/PushPin'
import SettingsIcon      from '@mui/icons-material/Settings'
import { Window } from '@wailsio/runtime'
import { Quit } from '../../bindings/egov/api'
import { useTranslation } from 'react-i18next'
import { barStyle } from './utils'

// タイトルバー。--wails-draggable: drag によるウィンドウドラッグ領域を兼ねる。
// メニューの開閉状態のみ内部で持ち、それ以外の状態は Player から受け取る。
export default function TitleBar({
  showUI, resizeCursor, mode, onModeChange, rotation, onRotate,
  alwaysOnTop, onAlwaysOnTopToggle, activeColor,
  onOpenSettings, onOpenVrOverlay,
}) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState(null)

  return (
    <Box
      sx={{
        ...barStyle,
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 48,
        display: 'flex', alignItems: 'center',
        py: 0.5, px: '10px',
        zIndex: 10,
        opacity: showUI ? 1 : 0,
        pointerEvents: showUI ? 'auto' : 'none',
        // 最上部（Wails3のリサイズ判定領域）ではリサイズカーソルを優先表示
        cursor: resizeCursor || 'grab',
        '&:active': { cursor: resizeCursor || 'grabbing' },
      }}
      style={{ '--wails-draggable': 'drag' }}
    >
      {/* ハンバーガーメニュー */}
      <Box style={{ '--wails-draggable': 'no-drag' }}>
        <IconButton sx={{ color: 'white', width: 28, height: 28 }} onClick={e => setMenuAnchor(e.currentTarget)}>
          <MenuIcon fontSize="small" />
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
        >
          <MenuItem onClick={() => { setMenuAnchor(null); document.getElementById('file-input').click() }}>
            <FolderOpenIcon fontSize="small" sx={{ mr: 1 }} />
            {t('menu.openFile')}
          </MenuItem>
          <MenuItem onClick={() => { setMenuAnchor(null); onOpenSettings() }}>
            <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
            {t('menu.settings')}
          </MenuItem>
        </Menu>
      </Box>

      {/* モード切替 */}
      <Box style={{ '--wails-draggable': 'no-drag' }} sx={{ ml: 1 }}>
        <ToggleButtonGroup
          value={mode} exclusive size="small"
          onChange={(_, v) => { if (v) onModeChange(v) }}
          sx={{
            '& .MuiToggleButton-root': {
              color: 'rgba(255,255,255,0.5)',
              borderColor: 'rgba(255,255,255,0.2)',
              py: 0.5, p: 0.5,
              minWidth: '60px',
            },
            '& .Mui-selected': {
              color: 'white !important',
              bgcolor: 'rgba(255,255,255,0.15) !important',
            },
          }}
        >
          <Tooltip title={t('mode.normal')} placement="bottom">
            <ToggleButton value="normal"><OndemandVideoIcon fontSize="small" /></ToggleButton>
          </Tooltip>
          <Tooltip title={t('mode.free')} placement="bottom">
            <ToggleButton value="free"><OpenWithIcon fontSize="small" /></ToggleButton>
          </Tooltip>
          <Tooltip title="VR" placement="bottom">
            <ToggleButton value="vr"><VrpanoIcon fontSize="small" /></ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>
      </Box>

      {/* 回転（VRモード以外） */}
      {mode !== 'vr' && (
        <Box style={{ '--wails-draggable': 'no-drag' }} sx={{ ml: 2 }}>
          <Tooltip title={`${t('controls.rotate', 'Rotate')} ${(rotation + 90) % 360}°`} placement="bottom">
            <IconButton
              sx={{ color: rotation ? activeColor : 'white', width: 28, height: 28 }}
              onClick={onRotate}
            >
              <RotateRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* VRモード時: 始点変更ボタン */}
      {mode === 'vr' && (
        <Box style={{ '--wails-draggable': 'no-drag' }} sx={{ ml: 2 }}>
          <Tooltip title={t('vr.changeViewpoint')} placement="bottom">
            <IconButton
              sx={{ color: 'white', width: 28, height: 28 }}
              onClick={onOpenVrOverlay}
            >
              <GridViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Box sx={{ flex: 1 }} />

      {/* ウィンドウ操作 */}
      <Stack direction="row" spacing={2.5} style={{ '--wails-draggable': 'no-drag' }}>
        <Tooltip title={alwaysOnTop ? t('controls.alwaysOnTopOn') : t('controls.alwaysOnTopOff')} placement="bottom">
          <IconButton
            sx={{ color: alwaysOnTop ? activeColor : 'rgba(255,255,255,0.4)', width: 28, height: 28 }}
            onClick={onAlwaysOnTopToggle}
          >
            <PushPinIcon fontSize="small" sx={{ transition: 'transform 0.2s', transform: alwaysOnTop ? 'none' : 'rotate(45deg)' }} />
          </IconButton>
        </Tooltip>
        <IconButton sx={{ color: 'white', width: 28, height: 28 }} onClick={() => Window.Minimise()}>
          <MinimizeIcon fontSize="small" />
        </IconButton>
        <IconButton sx={{ color: 'white', width: 28, height: 28 }} onClick={() => Window.ToggleMaximise()}>
          <CropSquareIcon fontSize="small" />
        </IconButton>
        <IconButton
          sx={{ color: 'white', width: 28, height: 28, '&:hover': { color: '#ef5350', bgcolor: 'rgba(239,83,80,0.15)' } }}
          onClick={() => Quit()}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  )
}
