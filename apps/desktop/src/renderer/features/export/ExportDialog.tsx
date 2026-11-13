import { Button } from '@allay/ui/components/button';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportErrorCode, ExportPreset, FfmpegInfo } from '../../../shared/export';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { localized } from '../../templates/builtin';
import { ExportRun, QUALITY_SUBFRAMES, type ExportOutcome, type ExportProgress, type QualityLevel } from './exportRunner';

// M1 的最小导出对话框：格式（ProRes 4444 / PNG 序列）、画质、进度、取消、结果。
// 完整的设置页、进度页、完成页（AllayProgress、剪辑点说明、体积估算）在 M7。

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
  const [preset, setPreset] = useState<ExportPreset>('prores4444');
  const [quality, setQuality] = useState<QualityLevel>('standard');
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' });
  const [info, setInfo] = useState<FfmpegInfo | null>(null);
  const runRef = useRef<ExportRun | null>(null);

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
    const { template, params, output } = useProjectStore.getState();
    const name = `${t('topbar.project')}_${localized(template.manifest.name, i18n.language)}_${output.width}x${output.height}_${output.fps}fps`;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="export-dialog">
      <div role="dialog" aria-modal="true" aria-labelledby="export-title" className="flex w-[420px] flex-col gap-4 rounded-lg border bg-surface-2 p-5 shadow-lg">
        <h2 id="export-title" className="text-base font-semibold">
          {t('export.title')}
        </h2>

        {phase.kind === 'settings' && (
          <>
            {info && !info.available && (
              <p role="alert" className="text-sm text-danger">
                {t('export.errors.ffmpegMissing')}
              </p>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs text-fg-muted">{t('export.format')}</legend>
              {PRESETS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="preset" value={p} checked={preset === p} disabled={!presetAvailable(p)} onChange={() => setPreset(p)} />
                  {t(`export.presets.${p === 'prores4444' ? 'prores' : 'png'}`)}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-fg-muted">{t('export.quality')}</span>
              <select
                className="h-7 rounded-md border bg-surface-1 px-2"
                value={quality}
                data-testid="export-quality"
                onChange={(e) => setQuality(e.target.value as QualityLevel)}
              >
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {t(`export.qualities.${q}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="lg" onClick={onClose}>
                {t('export.close')}
              </Button>
              <Button size="lg" data-testid="export-start" disabled={info !== null && !info.presets[preset]} onClick={() => void start()}>
                {t('export.start')}
              </Button>
            </div>
          </>
        )}

        {phase.kind === 'running' && (
          <>
            <div className="flex flex-col gap-2">
              <progress className="w-full" max={Math.max(1, phase.progress.total)} value={phase.progress.written} />
              <span data-testid="export-progress" className="tabular-nums text-xs text-fg-muted">
                {t('export.progress', { written: phase.progress.written, total: phase.progress.total })}
              </span>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" size="lg" data-testid="export-cancel" onClick={cancel}>
                {t('export.cancel')}
              </Button>
            </div>
          </>
        )}

        {phase.kind === 'finished' && (
          <>
            <ExportResult outcome={phase.outcome} />
            <div className="flex justify-end">
              <Button size="lg" data-testid="export-close" onClick={onClose}>
                {t('export.close')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
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
      <p>{t('export.done', { frames: outcome.frames, seconds: outcome.seconds.toFixed(1) })}</p>
      <p data-testid="export-path" className="break-all text-xs text-fg-muted">
        {outcome.path}
      </p>
      {outcome.cutFrame !== null && <p className="text-xs">{t('export.cutFrame', { frame: outcome.cutFrame })}</p>}
    </div>
  );
}
