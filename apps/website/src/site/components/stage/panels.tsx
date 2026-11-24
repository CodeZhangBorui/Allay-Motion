// 工作流交互面板：第二步真正可调参数（Slider + 图案按钮 + 翻转分段），第三步展示真实导出进度组件（AllayProgress）。
import { AllayProgress, type AllayProgressPhase } from '@allay/mascot';
import { localize, type TemplateManifest } from '@allay/template-sdk';
import { Button, buttonVariants } from '@allay/ui/components/button';
import { Slider } from '@allay/ui/components/slider';
import { ArrowCounterClockwise, ArrowSquareOut, Check, Play } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mcTextureUrl } from '../../../host/mc-pack';
import { REPO_URL } from '../../links';
import { usePrefs } from '../../prefs';

export interface TuneValues {
  cols: number;
  inPattern: string;
  spin: string;
}

export const DEFAULT_TUNE: TuneValues = {
  cols: 12,
  inPattern: 'centerOut',
  spin: 'flipY',
};

const TUNE_PATTERNS = ['centerOut', 'leftToRight', 'bottomToTop', 'diagonal', 'edgesIn', 'random'] as const;

type Param = NonNullable<TemplateManifest['params']>[number];

function param(m: TemplateManifest, key: string): Param | undefined {
  return (m.params ?? []).find((p) => p.key === key);
}

function options(p: Param | undefined): { value: string; label: Record<string, string> | string; pattern?: number[] }[] {
  return p && 'options' in p && Array.isArray(p.options) ? (p.options as { value: string; label: Record<string, string> | string; pattern?: number[] }[]) : [];
}

/** 4×4 出场顺序小格图 */
export function PatternGrid({ pattern, size = 32 }: { pattern: number[]; size?: number }) {
  return (
    <span className="grid shrink-0 grid-cols-4 gap-[2px] rounded-[5px] bg-well p-[3px]" style={{ width: size, height: size }} aria-hidden="true">
      {pattern.map((v, i) => (
        <span key={i} className="rounded-[1.5px] bg-primary" style={{ opacity: 0.2 + (1 - v) * 0.8 }} />
      ))}
    </span>
  );
}

export function TuneControls({
  manifest,
  values,
  onChange,
  onReset,
}: {
  manifest: TemplateManifest;
  values: TuneValues;
  onChange: (next: TuneValues) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const colsDef = param(manifest, 'cols');
  const inPatternDef = param(manifest, 'inPattern');
  const spinDef = param(manifest, 'spin');

  const patternOptions = options(inPatternDef).filter((o) => (TUNE_PATTERNS as readonly string[]).includes(o.value));
  const spinOptions = options(spinDef);
  const colsLabel = colsDef ? localize(colsDef.label, language) : 'Columns';

  return (
    <div className="card space-y-5 p-4 sm:p-5" data-testid="tune-controls">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold">{localize(manifest.name, language)}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onReset} data-testid="tune-reset">
          <ArrowCounterClockwise size={13} />
          {t('site.workflow.steps.tune.reset')}
        </Button>
      </div>

      <div>
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-fg-muted">{colsLabel}</span>
          <span className="t-tab font-semibold text-foreground" data-testid="tune-cols-value">
            {values.cols}
          </span>
        </div>
        <Slider
          className="mt-1"
          value={values.cols}
          min={6}
          max={28}
          step={1}
          thumbLabel={colsLabel}
          data-testid="tune-cols"
          onValueChange={(next) => onChange({ ...values, cols: next })}
        />
      </div>

      <div>
        <p className="text-[13px] text-fg-muted">{inPatternDef ? localize(inPatternDef.label, language) : 'In pattern'}</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {patternOptions.map((opt) => {
            const active = opt.value === values.inPattern;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                data-testid="tune-pattern"
                data-value={opt.value}
                onClick={() => onChange({ ...values, inPattern: opt.value })}
                className={`link-focus flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors duration-150 ${
                  active ? 'border-primary bg-control-hi font-medium text-foreground' : 'border-transparent bg-well text-fg-muted hover:bg-control hover:text-foreground'
                }`}
              >
                {opt.pattern && <PatternGrid pattern={opt.pattern} size={28} />}
                <span className="truncate">{localize(opt.label, language)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[13px] text-fg-muted">{spinDef ? localize(spinDef.label, language) : 'Spin'}</p>
        <div className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-well p-1">
          {spinOptions.map((opt) => {
            const active = opt.value === values.spin;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                data-testid="tune-spin"
                data-value={opt.value}
                onClick={() => onChange({ ...values, spin: opt.value })}
                className={`link-focus truncate rounded-md px-2 py-1.5 text-center text-[12px] transition-colors duration-150 ${
                  active ? 'bg-control-hi font-medium text-foreground' : 'text-fg-muted hover:text-foreground'
                }`}
              >
                {localize(opt.label, language)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CarryBlock() {
  const src = mcTextureUrl('minecraft:diamond_block');
  return src ? <img src={src} alt="" width={14} height={14} className="pixelated size-full rounded-[2px]" draggable={false} /> : <span className="block size-full rounded-[2px] bg-[#52D6DC]" />;
}

export function ExportPreviewPanel({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const { reducedMotion } = usePrefs();
  const [runKey, setRunKey] = useState(0);
  const [progress, setProgress] = useState(reducedMotion ? 1 : 0);
  const [phase, setPhase] = useState<AllayProgressPhase>(reducedMotion ? 'done' : 'rendering');

  useEffect(() => {
    if (!active) return;
    if (reducedMotion) {
      setProgress(1);
      setPhase('done');
      return;
    }
    setProgress(0);
    setPhase('rendering');
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed < 2200) {
        setProgress(Math.min(1, elapsed / 2200));
        setPhase('rendering');
        raf = requestAnimationFrame(step);
      } else if (elapsed < 2800) {
        setProgress(1);
        setPhase('muxing');
        raf = requestAnimationFrame(step);
      } else {
        setProgress(1);
        setPhase('done');
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, reducedMotion, runKey]);

  const statusText =
    phase === 'done'
      ? t('site.workflow.steps.export.done')
      : phase === 'muxing'
        ? t('site.workflow.steps.export.muxing')
        : t('site.workflow.steps.export.rendering');

  return (
    <div className="card space-y-4 p-4 sm:p-5" data-testid="export-preview-panel">
      <div className="flex items-center gap-2.5 rounded-[9px] bg-primary-soft px-3 py-2 text-[12.5px]">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check size={10} weight="bold" />
        </span>
        <span className="truncate font-medium">ProRes 4444 (Alpha)</span>
        <span className="t-mono ml-auto text-[10.5px] text-fg-subtle">.mov · 1920×1080</span>
      </div>

      <div className="min-h-[84px]">
        {active && <AllayProgress value={progress} phase={phase} carry={<CarryBlock />} label={t('site.workflow.steps.export.progressLabel')} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`text-[12.5px] ${phase === 'done' ? 'font-medium text-success' : 'text-fg-muted'}`}>{statusText}</span>
        <div className="flex items-center gap-2">
          {!reducedMotion && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setRunKey((k) => k + 1)}>
              <Play size={12} weight="fill" />
              {t('site.workflow.steps.export.replay')}
            </Button>
          )}
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ size: 'sm' })} data-testid="workflow-download">
            {t('site.workflow.steps.export.download')}
            <ArrowSquareOut size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}
