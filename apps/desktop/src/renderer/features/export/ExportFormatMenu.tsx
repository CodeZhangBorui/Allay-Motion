import { DropdownMenuItem, DropdownMenuItemIcon } from '@allay/ui/components/dropdown-menu';
import { FileVideo, FilmSlate, ImagesSquare, MonitorPlay, type Icon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ExportPreset } from '../../../shared/export';
import { PRESET_KEY, PRESET_STATE_KEYS, presetState, useEnsureExportInfo, useExportInfo } from './exportInfo';

/** 各导出格式在菜单里的图标：ProRes 给剪辑软件的母版、PNG 序列、网页用的 WebM、绿幕 MP4 */
const PRESET_ICON: Record<ExportPreset, Icon> = {
  prores4444: FilmSlate,
  'png-sequence': ImagesSquare,
  'webm-vp9': FileVideo,
  'greenscreen-mp4': MonitorPlay,
};

/** 顶栏“导出”分体按钮的格式下拉：列出全部预设，不可用的置灰并说明原因（6.4） */
export function ExportFormatItems({ presets, onPick }: { presets: readonly ExportPreset[]; onPick(p: ExportPreset): void }) {
  const { t } = useTranslation();
  const info = useEnsureExportInfo();
  const probing = useExportInfo((s) => s.probing);
  return presets.map((p) => {
    const st = presetState(info, probing, p);
    return (
      <DropdownMenuItem key={p} onClick={() => onPick(p)} disabled={st !== 'ok'} data-testid={`topbar-export-${p}`} data-state={st} className="h-auto py-1.5">
        <DropdownMenuItemIcon icon={PRESET_ICON[p]} />
        <span className="flex min-w-0 flex-col">
          <span>{t(`export.presets.${PRESET_KEY[p]}`)}</span>
          <span className="text-xs text-fg-subtle">{st === 'ok' ? t(`export.presetFor.${PRESET_KEY[p]}`) : t(PRESET_STATE_KEYS[st])}</span>
        </span>
      </DropdownMenuItem>
    );
  });
}
