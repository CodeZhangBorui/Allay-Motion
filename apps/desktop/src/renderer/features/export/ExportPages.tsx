import { AllayProgress, type AllayProgressPhase } from '@allay/mascot';
import { Button } from '@allay/ui/components/button';
import { ResourceThumb } from '@allay/ui/editor';
import { ICON } from '@allay/ui/lib/icons';
import { CheckCircle, Copy, FileVideo, FilmSlate, FolderOpen, WarningCircle } from '@phosphor-icons/react';
import type { ParamDef, ParamValues } from '@allay/template-sdk';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { frameTimecode } from '../../../shared/export';
import { dispatch } from '../../app/registry';
import { useProjectStore } from '../../stores/projectStore';
import { diagnosticsText } from './diagnostics';
import { EXPORT_ERROR_KEYS } from './labels';
import { useExportInfo } from './exportInfo';
import type { ExportTaskSnapshot } from './exportTasks';

// 导出对话框的进度页、完成页（docs/06-ui-design.md 6.4）。两页都只读导出任务的状态。
// 悦灵的进度条（ExportAllay）由对话框放在两页之上、同一个位置，进度页换成结果页时不重新挂载，
// 完成、失败、取消的编排接着进度的状态演（07-allay-mascot.md 7.6 B，decisions.md M5b、“四路合并的对接”）。

/** 剩余时间 m:ss */
export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 导出时悦灵捧着的方块（7.6 B）：模板的第一个 block 参数，或第一个 blockList 的第一项；都没有时为 null（捧胶片图标） */
export function primaryBlockId(defs: readonly ParamDef[], params: ParamValues): string | null {
  for (const p of defs) {
    const v: unknown = params[p.key];
    if (p.type === 'block' && typeof v === 'string') return v;
    if (p.type === 'blockList' && Array.isArray(v)) {
      const first: unknown = v[0];
      if (first && typeof first === 'object' && 'id' in first && typeof first.id === 'string') return first.id;
    }
  }
  return null;
}

/** 任务状态 → AllayProgress 的阶段：写完全部帧、等 FFmpeg 收尾时算“封装”；结束后完成跳舞、失败 sad、取消飞出 */
export function allayPhase(task: ExportTaskSnapshot): AllayProgressPhase {
  switch (task.status) {
    case 'done':
      return 'done';
    case 'failed':
      return 'error';
    case 'canceled':
      return 'canceled';
    case 'muxing':
      return 'muxing';
    default:
      return 'rendering';
  }
}

/**
 * 进度页和结果页共用的悦灵进度条：对话框把它放在固定的位置，换页时不重新挂载。
 * 结果页上停在最后的进度处（完成时到头）；封装阶段飞向文件图标。
 */
export function ExportAllay({ task }: { task: ExportTaskSnapshot }) {
  const { t } = useTranslation();
  const last = useRef(0);
  if (task.status === 'preparing' || task.status === 'rendering' || task.status === 'muxing') last.current = task.progress;
  const carryBlock = useProjectStore((s) => (s.template ? primaryBlockId(s.template.params, s.params) : null));
  const carry = carryBlock ? <ResourceThumb kind="block" id={carryBlock} size={16} /> : <FilmSlate size={ICON.md} className="text-foreground" />;
  return (
    <div data-testid="export-allay" data-phase={allayPhase(task)}>
      <AllayProgress
        value={task.status === 'done' ? 1 : last.current}
        phase={allayPhase(task)}
        label={t('export.progressLabel')}
        carry={carry}
        target={<FileVideo size={ICON.md} />}
      />
    </div>
  );
}

export function ExportProgressPage({ task }: { task: ExportTaskSnapshot }) {
  const { t } = useTranslation();
  const [canceling, setCanceling] = useState(false);
  const percent = Math.floor(task.progress * 100);
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 px-12" data-testid="export-progress-page" data-status={task.status}>
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-fg-muted" data-testid="export-stage">
              {t(`export.stages.${task.status}`)}
            </span>
            <span data-testid="export-progress" className="num text-xs text-fg-subtle">
              {task.total > 0 ? t('export.progress', { written: task.written, total: task.total }) : ' '}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="num text-3xl leading-none font-semibold" data-testid="export-percent">
              {percent}%
            </span>
            <span className="num text-xs text-fg-subtle" data-testid="export-eta">
              {task.etaSeconds !== null && task.status === 'rendering' ? t('export.eta', { time: formatEta(task.etaSeconds) }) : t('export.etaUnknown')}
            </span>
          </div>
        </div>
      </div>
      <div className="flex h-14 shrink-0 items-center justify-end gap-3 border-t border-divider px-5">
        <Button
          variant="secondary"
          size="lg"
          data-testid="export-cancel"
          disabled={canceling}
          onClick={() => {
            setCanceling(true);
            void dispatch('exportTask.cancel', { taskId: task.id }).finally(() => setCanceling(false));
          }}
        >
          {t('export.cancel')}
        </Button>
      </div>
    </>
  );
}

export function ExportResultPage({ task, onAgain, onClose }: { task: ExportTaskSnapshot; onAgain(): void; onClose(): void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const templateId = useProjectStore((s) => s.template?.ref.id ?? null);

  const copyDiagnostics = async () => {
    const version = (await window.allay.app.info()).version;
    await window.allay.export.copyDiagnostics(diagnosticsText(task, version, useExportInfo.getState().info, templateId));
    setCopied(true);
  };

  let body: React.ReactNode;
  let actions: React.ReactNode;
  if (task.status === 'done' && task.result) {
    const r = task.result;
    body = (
      <div data-testid="export-result" data-kind="done" className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle size={ICON.md} weight="fill" />
          <span className="text-sm text-foreground">{t('export.done', { frames: r.frames, seconds: r.seconds.toFixed(1) })}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-fg-subtle">{t('export.savedTo')}</span>
          <p data-testid="export-path" className="num rounded-md bg-well px-2.5 py-2 text-xs break-all text-fg-muted select-text">
            {r.path}
          </p>
        </div>
        {r.cutFrame !== null && (
          <p data-testid="export-cutpoint" className="rounded-md bg-control px-3 py-2.5 text-sm">
            <span className="mr-1.5 inline-block size-2 rotate-45 bg-mark align-middle" aria-hidden="true" />
            {t('export.cutPoint', { frame: r.cutFrame, timecode: frameTimecode(r.cutFrame, r.fps) })}
          </p>
        )}
        {r.encoder && (
          <p className="num text-xs text-fg-subtle" data-testid="export-encoder">
            {t('export.encoderUsed', { encoder: r.encoder })}
          </p>
        )}
      </div>
    );
    actions = (
      <>
        <Button variant="secondary" size="lg" className="mr-auto gap-1.5" data-testid="export-reveal" onClick={() => void window.allay.export.reveal(r.jobId)}>
          <FolderOpen size={ICON.sm} />
          {t('export.reveal')}
        </Button>
        <Button variant="secondary" size="lg" data-testid="export-again" onClick={onAgain}>
          {t('export.again')}
        </Button>
        <Button size="lg" data-testid="export-close" onClick={onClose}>
          {t('export.finish')}
        </Button>
      </>
    );
  } else if (task.status === 'failed' && task.error) {
    const e = task.error;
    body = (
      <div data-testid="export-result" data-kind="failed" data-code={e.code} role="alert" className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <WarningCircle size={ICON.md} weight="fill" className="mt-px shrink-0 text-danger" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">{t('export.failedTitle')}</p>
            <p className="text-sm text-danger">{t(EXPORT_ERROR_KEYS[e.code])}</p>
            {e.frame !== null && <p className="text-xs text-fg-muted">{t('export.failedAtFrame', { frame: e.frame })}</p>}
            <p className="text-xs text-fg-subtle">{t('export.noLeftovers')}</p>
          </div>
        </div>
      </div>
    );
    actions = (
      <>
        <Button variant="secondary" size="lg" className="mr-auto gap-1.5" data-testid="export-copy-diagnostics" onClick={() => void copyDiagnostics()}>
          <Copy size={ICON.sm} />
          {copied ? t('export.copied') : t('export.copyDiagnostics')}
        </Button>
        <Button variant="secondary" size="lg" data-testid="export-again" onClick={onAgain}>
          {t('export.back')}
        </Button>
        <Button size="lg" data-testid="export-close" onClick={onClose}>
          {t('export.close')}
        </Button>
      </>
    );
  } else {
    body = (
      <p data-testid="export-result" data-kind="canceled" className="text-sm">
        {t('export.canceled')}
      </p>
    );
    actions = (
      <>
        <Button variant="secondary" size="lg" data-testid="export-again" onClick={onAgain}>
          {t('export.back')}
        </Button>
        <Button size="lg" data-testid="export-close" onClick={onClose}>
          {t('export.close')}
        </Button>
      </>
    );
  }
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-8">{body}</div>
      <div className="flex h-14 shrink-0 items-center justify-end gap-3 border-t border-divider px-5">{actions}</div>
    </>
  );
}
