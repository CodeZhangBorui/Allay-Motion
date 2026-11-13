import { AllayProgress } from '@allay/mascot';
import { Button } from '@allay/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@allay/ui/components/dialog';
import { ToggleGroup, ToggleGroupItem } from '@allay/ui/components/misc';
import { Clapperboard } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportErrorCode, ExportPreset, FfmpegInfo } from '../../../shared/export';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { localized } from '../../templates/catalog';
import { ExportRun, QUALITY_SUBFRAMES, type ExportOutcome, type ExportProgress, type QualityLevel } from './exportRunner';

// M1 的最小导出对话框（M4 套上新的视觉规范）：格式（ProRes 4444 / PNG 序列）、画质、进度、取消、结果。
// 完整的设置页、进度页、完成页（720×520、格式卡片、剪辑点说明、体积估算、AllayProgress 的完整编排）在 M7。

type Phase = { kind: 'settings' } | { kind: 'running'; progress: ExportProgress } | { kind: 'finished'; outcome: ExportOutcome };

const PRESETS: ExportPreset[] = ['prores4444', 'png-sequence'];
const QUALITIES = Object.keys(QUALITY_SUBFRAMES) as QualityLevel[];

/** 每个错误码对应的文案键 */
export const EXPORT_ERROR_KEYS: Record<ExportErrorCode, string> = {
  'ffmpeg-missing': 'export.errors.ffmpegMissing',
  'output-not-writable': 'export.errors.outputNotWritable',
  'disk-full': 'export.errors.diskFull',
  'encoder-unavailable': 'export.errors.encoderUnavailable',
  'ffmpeg-failed': 'export.errors.ffmpegFailed',
  'frame-mismatch': 'export.errors.frameMismatch',
  'template-failed': 'export.errors.templateFailed',
  'template-unresponsive': 'export.errors.templateUnresponsive',
};

export function ExportDialog({ onClose }: { onClose(): void }) {
  const { t, i18n } = useTranslation();
  const saved = useProjectStore((s) => s.exportSettings);
  const [preset, setPresetState] = useState<ExportPreset>(saved.preset === 'png-sequence' ? 'png-sequence' : 'prores4444');
  const [quality, setQualityState] = useState<QualityLevel>(saved.quality);
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' });
  const [info, setInfo] = useState<FfmpegInfo | null>(null);
  const runRef = useRef<ExportRun | null>(null);

  // 选择记进工程（1.9 的 export 字段）
  const setPreset = (p: ExportPreset) => {
    setPresetState(p);
    useProjectStore.getState().setExportSettings({ preset: p });
  };
  const setQuality = (q: QualityLevel) => {
    setQualityState(q);
    useProjectStore.getState().setExportSettings({ quality: q });
  };

  useEffect(() => {
    // 导出是模态的：预览停下来
    useTransportStore.getState().setPlaying(false);
    let alive = true;
    void window.allay.export.ffmpegInfo().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
      void runRef.current?.cancel();
    };
  }, []);

  const start = async () => {
    const { template, params, output, name: projectName } = useProjectStore.getState();
    if (!template) return;
    const name = `${projectName ?? t('project.untitled')}_${localized(template.manifest.name, i18n.language)}_${output.width}x${output.height}_${output.fps}fps`;
    const run = new ExportRun({ template, params, output, preset, quality, shutterAngle: 180, suggestedName: name }, (progress) =>
      setPhase({ kind: 'running', progress }),
    );
    runRef.current = run;
    setPhase({ kind: 'running', progress: { written: 0, total: 0 } });
    const outcome = await run.run();
    runRef.current = null;
    setPhase({ kind: 'finished', outcome });
  };

  const cancel = () => void runRef.current?.cancel();
  const presetAvailable = (p: ExportPreset) => info === null || info.presets[p];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // 导出进行中不能点外面或按 Esc 关掉：要用“取消”
        if (!open && phase.kind !== 'running') onClose();
      }}
    >
      <DialogContent showClose={phase.kind !== 'running'} closeLabel={t('common.close')} className="w-[460px]" data-testid="export-dialog">
        <DialogTitle>{t('export.title')}</DialogTitle>

        {phase.kind === 'settings' && (
          <>
            {info && !info.available && (
              <p role="alert" className="text-sm text-danger">
                {t('export.errors.ffmpegMissing')}
              </p>
            )}
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-2 font-px12 text-fg-muted">{t('export.format')}</legend>
              {PRESETS.map((p) => (
                <label
                  key={p}
                  className="flex h-9 cursor-pointer items-center gap-2.5 blk blk-raised px-3 text-sm hover:bg-surface-3 has-checked:blk-sunken has-checked:blk-edge-ring has-disabled:cursor-default has-disabled:opacity-50"
                >
                  <input type="radio" name="preset" value={p} checked={preset === p} disabled={!presetAvailable(p)} onChange={() => setPreset(p)} className="size-4 shrink-0 appearance-none blk-sunken shadow-[0_0_0_2px_var(--input-border)] checked:bg-primary checked:shadow-[0_0_0_2px_var(--ring),inset_0_0_0_3px_var(--well)]" />
                  {t(`export.presets.${p === 'prores4444' ? 'prores' : 'png'}`)}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <span className="font-px12 text-fg-muted" id="export-quality-label">
                {t('export.quality')}
              </span>
              <ToggleGroup value={[quality]} onValueChange={(v) => v[0] && setQuality(v[0] as QualityLevel)} aria-labelledby="export-quality-label" className="w-full" data-testid="export-quality">
                {QUALITIES.map((q) => (
                  <ToggleGroupItem key={q} value={q} data-testid={`export-quality-${q}`} title={t(`export.qualities.${q}`)}>
                    {t(`export.qualityShort.${q}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="text-xs text-fg-muted">{t(`export.qualities.${quality}`)}</span>
            </div>
            <DialogFooter>
              <Button variant="secondary" size="lg" onClick={onClose} data-testid="export-dismiss">
                {t('export.close')}
              </Button>
              <Button size="lg" data-testid="export-start" disabled={info !== null && !info.presets[preset]} onClick={() => void start()}>
                {t('export.start')}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase.kind === 'running' && (
          <>
            <div className="flex flex-col gap-2">
              <AllayProgress
                value={phase.progress.total > 0 ? phase.progress.written / phase.progress.total : 0}
                phase="rendering"
                label={t('export.progressLabel')}
                carry={<Clapperboard className="size-4 text-foreground" />}
              />
              <span data-testid="export-progress" className="font-px12 text-fg-muted">
                {t('export.progress', { written: phase.progress.written, total: phase.progress.total })}
              </span>
            </div>
            <DialogFooter>
              <Button variant="secondary" size="lg" data-testid="export-cancel" onClick={cancel}>
                {t('export.cancel')}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase.kind === 'finished' && (
          <>
            <ExportResult outcome={phase.outcome} />
            <DialogFooter>
              <Button size="lg" data-testid="export-close" onClick={onClose}>
                {t('export.close')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExportResult({ outcome }: { outcome: ExportOutcome }) {
  const { t } = useTranslation();
  if (outcome.kind === 'canceled') {
    return (
      <p data-testid="export-result" data-kind="canceled" className="text-sm">
        {t('export.canceled')}
      </p>
    );
  }
  if (outcome.kind === 'failed') {
    return (
      <div data-testid="export-result" data-kind="failed" data-code={outcome.error.code} role="alert" className="flex flex-col gap-1 text-sm">
        <p className="text-danger">{t(EXPORT_ERROR_KEYS[outcome.error.code])}</p>
        {outcome.frame !== null && <p className="text-xs text-fg-muted">{t('export.failedAtFrame', { frame: outcome.frame })}</p>}
      </div>
    );
  }
  return (
    <div data-testid="export-result" data-kind="done" className="flex flex-col gap-1 text-sm">
      <p className="font-px24">{t('export.doneTitle')}</p>
      <p>{t('export.done', { frames: outcome.frames, seconds: outcome.seconds.toFixed(1) })}</p>
      <p data-testid="export-path" className="text-xs break-all text-fg-muted select-text">
        {outcome.path}
      </p>
      {outcome.cutFrame !== null && <p className="text-xs">{t('export.cutFrame', { frame: outcome.cutFrame })}</p>}
    </div>
  );
}
