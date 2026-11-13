import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@allay/ui/components/select';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';

// 输出规格（分辨率、帧率）：播放条右侧的徽标弹层和设置对话框共用。改的是当前工程的输出设置。

export const RESOLUTIONS = [
  { key: '1080p', width: 1920, height: 1080 },
  { key: '720p', width: 1280, height: 720 },
  { key: '2160p', width: 3840, height: 2160 },
  { key: 'vertical', width: 1080, height: 1920 },
  { key: 'square', width: 1080, height: 1080 },
] as const;
export const FPS_OPTIONS = [24, 25, 30, 50, 60] as const;

export function OutputSettingsForm() {
  const { t } = useTranslation();
  const output = useProjectStore((s) => s.output);
  const resKey = RESOLUTIONS.find((r) => r.width === output.width && r.height === output.height)?.key ?? '1080p';
  return (
    <div className="flex flex-col gap-3" data-testid="output-settings">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-fg-muted">{t('output.resolution')}</span>
        <Select
          value={resKey}
          onValueChange={(v) => {
            const r = RESOLUTIONS.find((x) => x.key === v);
            if (r) useProjectStore.getState().setOutput({ ...output, width: r.width, height: r.height });
          }}
        >
          <SelectTrigger className="w-44" aria-label={t('output.resolution')} data-testid="output-resolution">
            <SelectValue>{(v: unknown) => t(`output.resolutions.${String(v)}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RESOLUTIONS.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {t(`output.resolutions.${r.key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-fg-muted">{t('output.fps')}</span>
        <Select value={String(output.fps)} onValueChange={(v) => useProjectStore.getState().setOutput({ ...output, fps: Number(v) })}>
          <SelectTrigger className="w-44" aria-label={t('output.fps')} data-testid="output-fps">
            <SelectValue>{(v: unknown) => `${String(v)} fps`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FPS_OPTIONS.map((f) => (
              <SelectItem key={f} value={String(f)}>
                {f} fps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
