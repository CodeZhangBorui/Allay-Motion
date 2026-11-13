import type { TemplateDiagnostic } from '@allay/template-sdk';
import { PREVIEW_INSET } from '@allay/ui/editor';
import { ICON, ICON_WEIGHT } from '@allay/ui/lib/icons';
import { WarningCircle } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDevStore } from '../../stores/devStore';

// 模板开发模式的错误浮层（docs/08-milestones.md MD）：热重载没有通过时，按诊断的种类、错误码和行号列号列出原因。
// 浮层贴在预览上沿，不挡画面中央：预览保留上一帧，上一个能运行的版本照常播放。修好并保存后自动消失。

/** 一条诊断的说明文字（种类、错误码对应的文案；没有文案的错误码原样显示） */
export function diagnosticTitle(t: TFunction, d: TemplateDiagnostic): string {
  const key = `dev.codes.${d.code}`;
  return t(key, { defaultValue: d.code });
}

export function diagnosticPosition(t: TFunction, d: TemplateDiagnostic): string | null {
  if (d.line === undefined) return null;
  return d.column === undefined ? t('dev.positionLine', { line: d.line }) : t('dev.position', { line: d.line, column: d.column });
}

function Row({ d }: { d: TemplateDiagnostic }) {
  const { t } = useTranslation();
  const position = diagnosticPosition(t, d);
  const at = 't' in d && typeof d.t === 'number' ? t('dev.atTime', { t: Math.round(d.t * 1000) / 1000 }) : null;
  return (
    <li
      className="flex flex-col gap-1 border-t border-divider py-2 first:border-t-0 first:pt-0 last:pb-0"
      data-testid="dev-diagnostic"
      data-kind={d.kind}
      data-code={d.code}
      data-line={d.line ?? ''}
      data-column={d.column ?? ''}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="rounded-[4px] bg-control px-1.5 text-[11px] leading-[18px] text-fg-muted">{t(`dev.kinds.${d.kind}`)}</span>
        <span className="font-medium text-foreground">{diagnosticTitle(t, d)}</span>
        {position && (
          <span className="num text-xs text-primary-text" data-testid="dev-diagnostic-position">
            {position}
          </span>
        )}
        {at && <span className="num text-xs text-fg-subtle">{at}</span>}
      </div>
      <p className="line-clamp-3 num text-xs break-words text-fg-muted">{d.message}</p>
    </li>
  );
}

export function DevOverlay() {
  const { t } = useTranslation();
  const diagnostics = useDevStore((s) => s.diagnostics);
  if (diagnostics.length === 0) return null;
  const shown = diagnostics.slice(0, 5);
  return (
    <section
      role="alert"
      aria-label={t('dev.overlay.region')}
      data-testid="dev-overlay"
      className="absolute z-20 mx-auto flex max-h-[45%] max-w-xl flex-col gap-2 overflow-auto rounded-xl bg-surface-2 p-3 text-sm shadow-float"
      style={{ top: PREVIEW_INSET.top, left: PREVIEW_INSET.left, right: PREVIEW_INSET.right }}
    >
      <header className="flex items-start gap-2">
        <WarningCircle size={ICON.md} weight={ICON_WEIGHT.active} className="mt-px shrink-0 text-danger" />
        <div className="flex min-w-0 flex-col">
          <p className="font-semibold text-foreground">{t('dev.overlay.title')}</p>
          <p className="text-xs text-fg-subtle">{t('dev.overlay.kept')}</p>
        </div>
      </header>
      <ul className="flex flex-col pl-6">
        {shown.map((d, i) => (
          <Row key={`${d.kind}-${d.code}-${i}`} d={d} />
        ))}
      </ul>
    </section>
  );
}
