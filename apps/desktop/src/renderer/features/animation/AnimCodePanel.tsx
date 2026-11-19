// “动画代码”停靠面板（docs/animation-editor.md 5.4）：动画文档的原文，任何时候都能直接改。
// 编辑器由可选模块提供（ui.registerCodeView，CodeMirror）；没有提供者时（模块被拆掉、开发模式关着）用普通的文本框，功能不缺：
// 改完停 400 ms 就解析，解析得过就换文档（预览和其他面板随之更新），解析不过就在下面列出原因、预览保持最后一份合法的文档。
// 可视化编辑改了文档时，这里换上新的文本（光标所在的输入没有提交之前不会被覆盖）。
import type { CodeViewDiagnostic, CodeViewHandle } from '@allay/host-api';
import { Button } from '@allay/ui/components/button';
import { ICON } from '@allay/ui/lib/icons';
import { WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCodeViews } from '../../app/codeViews';
import { trigger } from '../../app/registry';
import { useProjectStore } from '../../stores/projectStore';
import { useAnimationUi } from './uiState';

const DEBOUNCE_MS = 400;

type Issue = { message: string; path: string; line?: number; column?: number };

function toDiagnostics(issues: readonly Issue[]): CodeViewDiagnostic[] {
  return issues.map((i) => ({ severity: 'error', message: i.path ? `${i.path}: ${i.message}` : i.message, ...(i.line !== undefined ? { line: i.line } : {}), ...(i.column !== undefined ? { column: i.column } : {}) }));
}

/** 没有代码编辑器模块时的文本框 */
function PlainCodeView({ text, onChange, label }: { text: string; onChange(v: string): void; label: string }) {
  const [draft, setDraft] = useState(text);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(text);
  }, [text]);
  return (
    <textarea
      aria-label={label}
      spellCheck={false}
      data-testid="anim-code-plain"
      className="size-full min-h-0 flex-1 resize-none bg-well p-3 font-mono text-xs leading-[1.55] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
      value={draft}
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false;
        onChange(draft);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

/** 可选模块提供的编辑器 */
function ProvidedCodeView({ text, onChange, label, issues }: { text: string; onChange(v: string): void; label: string; issues: readonly Issue[] }) {
  const provider = useCodeViews((s) => s.provider)!;
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<CodeViewHandle | null>(null);
  const last = useRef(text);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!ref.current) return undefined;
    const h = provider(ref.current, {
      language: 'json',
      value: last.current,
      label,
      onChange: (v) => {
        last.current = v;
        change.current(v);
      },
      onSave: (v) => change.current(v),
    });
    handle.current = h;
    return () => {
      h.dispose();
      handle.current = null;
    };
    // 换提供者时重建；其余的变化经 handle 推进去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
  useEffect(() => {
    if (text !== last.current) {
      last.current = text;
      handle.current?.setValue(text);
    }
  }, [text]);
  useEffect(() => handle.current?.setDiagnostics(toDiagnostics(issues)), [issues]);
  return <div ref={ref} className="min-h-0 flex-1 overflow-hidden" data-testid="anim-code-editor" />;
}

export function AnimCodePanel() {
  const { t } = useTranslation();
  const text = useProjectStore((s) => s.template?.animation?.text ?? '');
  const issues = useProjectStore((s) => s.template?.animation?.issues ?? []);
  const hasProvider = useCodeViews((s) => s.provider !== null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const onChange = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => trigger('animSetText', { text: v }), DEBOUNCE_MS);
  };
  const label = t('anim.code.title');
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="anim-code">
      <div className="flex h-panel-head shrink-0 items-center gap-2 pr-2 pl-3.5">
        <span className="text-[12.5px] font-semibold text-foreground">{label}</span>
        <span className="truncate text-xs text-fg-subtle">{hasProvider ? t('anim.code.editorHint') : t('anim.code.plainHint')}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" className="text-fg-subtle" aria-label={t('anim.code.close')} title={t('anim.code.close')} onClick={() => useAnimationUi.getState().setCodeOpen(false)}>
          <X size={ICON.md - 1} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-xl">
        {hasProvider ? <ProvidedCodeView text={text} onChange={onChange} label={label} issues={issues} /> : <PlainCodeView text={text} onChange={onChange} label={label} />}
      </div>
      {issues.length > 0 && (
        <ul className="flex max-h-32 shrink-0 flex-col gap-1 overflow-y-auto border-t border-divider px-3.5 py-2 text-xs" data-testid="anim-code-issues" aria-live="polite">
          <li className="flex items-center gap-1.5 text-fg-muted">
            <WarningCircle size={ICON.sm} weight="fill" className="text-danger" />
            {t('anim.code.invalid')}
          </li>
          {issues.map((i, n) => (
            <li key={n} className="flex gap-2">
              {i.line !== undefined && <span className="num shrink-0 text-primary-text">{t('dev.position', { line: i.line, column: i.column ?? 1 })}</span>}
              <span className="min-w-0 break-words text-foreground">{i.path ? `${i.path}: ${i.message}` : i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
