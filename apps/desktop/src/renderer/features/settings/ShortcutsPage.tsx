import { Button } from '@allay/ui/components/button';
import { Input, Kbd } from '@allay/ui/components/misc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@allay/ui/components/tooltip';
import { ICON } from '@allay/ui/lib/icons';
import { ArrowCounterClockwise, ArrowsLeftRight, Lightning, MagnifyingGlass, Warning, X } from '@phosphor-icons/react';
import { cn } from '@allay/ui/lib/utils';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  bindShortcut,
  effectiveShortcut,
  resetShortcut,
  setOverride,
  shortcutFromEvent,
  type ReservedReason,
  type ShortcutOverrides,
} from '../../../shared/shortcuts';
import { COMMAND_CATEGORIES, runsWithoutInput, useCommands, type AnyCommand, type CommandCategory } from '../../app/registry';
import { notify } from '../../stores/noticeStore';
import { useUiStore } from '../../stores/uiStore';
import { shortcutLabel, shortcutMap } from '../commands/shortcutState';
import { SettingsPageHeader } from './layout';

// 快捷键设置（docs/06-ui-design.md 6.11）：注册表里能不带参数执行的命令都列出来（可选模块的也在），按类别分组、可搜索。
// 每条可以录制新的按键、清除、恢复默认；冲突时说明和哪条命令冲突，让用户选“替换”或“取消”；保留键不允许绑定。
// 结果存进设置（ui.shortcuts），菜单、命令面板、工具提示、按键处理都读同一份（shortcutState.ts），执行仍经 dispatcher。

type Pending = { id: string; key: string; conflict: string } | { id: string; reserved: ReservedReason; key: string } | null;

function save(next: ShortcutOverrides): void {
  useUiStore.getState().update({ shortcuts: next });
}

/** 设置页里列出的命令：能不带参数执行；只给程序调用的内部命令（不在命令面板、也没有默认快捷键）不列 */
export function bindableCommands(commands: readonly AnyCommand[]): AnyCommand[] {
  return commands.filter((c) => runsWithoutInput(c) && (!c.hideInPalette || c.shortcut));
}

function Recorder({ cmd, current, onDone }: { cmd: AnyCommand; current: string | null; onDone(key: string | null): void }) {
  const { t } = useTranslation();
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    // 录制时按键全部归这里：不触发全局快捷键（defaultPrevented），也不让对话框收到 Esc
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) return onDone(null);
    const key = shortcutFromEvent(e.nativeEvent);
    if (key) onDone(key);
  };
  return (
    <button
      type="button"
      autoFocus
      onKeyDown={onKeyDown}
      onBlur={() => onDone(null)}
      data-testid={`shortcut-recorder-${cmd.id}`}
      aria-label={t('settings.shortcuts.recording', { command: t(cmd.titleKey) })}
      className="inline-flex h-control min-w-36 items-center justify-center rounded-md bg-primary-soft px-2.5 text-xs text-foreground outline-2 outline-offset-2 outline-(--ring)"
    >
      {t('settings.shortcuts.pressKeys')}
      {current && <span className="ml-1.5 text-fg-subtle">({shortcutLabel(current)})</span>}
    </button>
  );
}

function ShortcutRow({ cmd, overrides, all, conflicted, pending, setPending, recording, setRecording }: {
  cmd: AnyCommand;
  overrides: ShortcutOverrides;
  all: readonly AnyCommand[];
  conflicted: boolean;
  pending: Pending;
  setPending(p: Pending): void;
  recording: string | null;
  setRecording(id: string | null): void;
}) {
  const { t } = useTranslation();
  const current = effectiveShortcut(cmd, overrides);
  const changed = Object.hasOwn(overrides, cmd.id);
  const Icon = cmd.icon ?? Lightning;
  const title = t(cmd.titleKey);
  const mine = pending?.id === cmd.id ? pending : null;
  const titleOf = (id: string) => t(all.find((c) => c.id === id)?.titleKey ?? id);

  const onRecorded = (key: string | null) => {
    setRecording(null);
    if (!key || key === current) return;
    const r = bindShortcut(all, overrides, cmd.id, key, false);
    if (r.ok) {
      save(r.overrides);
      setPending(null);
    } else if ('conflict' in r) setPending({ id: cmd.id, key, conflict: r.conflict });
    else setPending({ id: cmd.id, key, reserved: r.reserved });
  };

  return (
    <li className={cn('flex flex-col rounded-md', mine && 'bg-control')} data-testid={`shortcut-row-${cmd.id}`} data-shortcut={current ?? ''}>
      <div className="group/row flex min-h-10 items-center gap-3 px-2">
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {changed && <span className="absolute -left-2 size-[5px] rounded-full bg-mark" aria-hidden="true" />}
          <Icon size={ICON.md} className="text-fg-subtle" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {title}
          {changed && <span className="sr-only"> {t('settings.shortcuts.changed')}</span>}
        </span>
        {conflicted && (
          <Tooltip>
            <TooltipTrigger render={<span className="text-warning" data-testid={`shortcut-conflict-${cmd.id}`} />}>
              <Warning size={ICON.sm} weight="fill" aria-label={t('settings.shortcuts.duplicate')} />
            </TooltipTrigger>
            <TooltipContent>{t('settings.shortcuts.duplicate')}</TooltipContent>
          </Tooltip>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {recording === cmd.id ? (
            <Recorder cmd={cmd} current={current} onDone={onRecorded} />
          ) : (
            <button
              type="button"
              data-testid={`shortcut-edit-${cmd.id}`}
              aria-label={t('settings.shortcuts.edit', { command: title })}
              onClick={() => {
                setPending(null);
                setRecording(cmd.id);
              }}
              className="inline-flex h-control min-w-36 items-center justify-end gap-1 rounded-md px-2 text-xs text-fg-subtle transition-colors duration-(--dur-1) outline-none hover:bg-control-hi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
            >
              {current ? <Kbd className="bg-control-hi text-foreground">{shortcutLabel(current)}</Kbd> : <span>{t('settings.shortcuts.none')}</span>}
            </button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.shortcuts.clear', { command: title })}
            data-testid={`shortcut-clear-${cmd.id}`}
            disabled={!current}
            className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 disabled:invisible"
            onClick={() => save(setOverride(all, overrides, cmd.id, null))}
          >
            <X size={ICON.sm} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.shortcuts.reset', { command: title })}
            data-testid={`shortcut-reset-${cmd.id}`}
            disabled={!changed}
            className="disabled:invisible"
            onClick={() => {
              const r = resetShortcut(all, overrides, cmd.id);
              save(r.overrides);
              if (r.cleared) notify('info', t('settings.shortcuts.resetCleared', { command: titleOf(r.cleared) }));
            }}
          >
            <ArrowCounterClockwise size={ICON.sm} />
          </Button>
        </div>
      </div>
      {mine && 'conflict' in mine && (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2 pl-9" role="alert" data-testid="shortcut-conflict-prompt">
          <span className="min-w-0 flex-1 text-xs text-fg-muted">{t('settings.shortcuts.conflict', { key: shortcutLabel(mine.key), command: titleOf(mine.conflict) })}</span>
          <Button
            variant="secondary"
            size="sm"
            data-testid="shortcut-conflict-replace"
            onClick={() => {
              const r = bindShortcut(all, overrides, cmd.id, mine.key, true);
              if (r.ok) save(r.overrides);
              setPending(null);
            }}
          >
            {t('settings.shortcuts.replace')}
          </Button>
          <Button variant="ghost" size="sm" data-testid="shortcut-conflict-cancel" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {mine && 'reserved' in mine && (
        <p className="px-2 pb-2 pl-9 text-xs text-danger" role="alert" data-testid="shortcut-reserved">
          {t(`settings.shortcuts.reserved.${mine.reserved}`, { key: shortcutLabel(mine.key) })}
        </p>
      )}
    </li>
  );
}

export function ShortcutsPage() {
  const { t } = useTranslation();
  const commands = useCommands();
  const overrides = useUiStore((s) => s.settings.shortcuts);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const all = useMemo(() => bindableCommands(commands), [commands]);
  const { conflicts } = shortcutMap(all, overrides);
  const q = query.trim().toLowerCase();
  const shown = all.filter((c) => {
    if (!q) return true;
    const s = effectiveShortcut(c, overrides) ?? '';
    return t(c.titleKey).toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || s.toLowerCase().includes(q) || shortcutLabel(s).toLowerCase().includes(q);
  });
  const groups = COMMAND_CATEGORIES.map((cat) => [cat, shown.filter((c) => (c.category ?? 'other') === cat)] as [CommandCategory, AnyCommand[]]).filter(([, list]) => list.length > 0);
  const changedCount = Object.keys(overrides).length;

  return (
    <div className="flex flex-col" data-testid="shortcut-table">
      <SettingsPageHeader title={t('settings.pages.shortcuts')} description={t('settings.descriptions.shortcuts')} />
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-surface-2 px-1 pb-3">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass size={ICON.sm} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder={t('settings.shortcuts.search')} aria-label={t('settings.shortcuts.search')} className="pl-8" data-testid="shortcut-search" />
        </div>
        <Button variant="secondary" disabled={changedCount === 0} data-testid="shortcut-reset-all" onClick={() => {
          save({});
          setPending(null);
        }}>
          <ArrowCounterClockwise size={ICON.sm} />
          {t('settings.shortcuts.resetAll')}
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="py-6 text-center text-sm text-fg-muted" data-testid="shortcut-empty">
          {t('settings.shortcuts.empty', { query })}
        </p>
      )}
      {groups.map(([cat, list]) => (
        <section key={cat} className="flex flex-col border-t border-divider pt-3 pb-3 first-of-type:border-t-0 first-of-type:pt-0" data-testid={`shortcut-group-${cat}`}>
          <h3 className="px-2 pb-1 text-xs font-semibold text-fg-subtle">{t(`settings.shortcuts.categories.${cat}`)}</h3>
          <ul className="flex flex-col">
            {list.map((c) => (
              <ShortcutRow key={c.id} cmd={c} overrides={overrides} all={all} conflicted={conflicts.has(c.id)} pending={pending} setPending={setPending} recording={recording} setRecording={setRecording} />
            ))}
          </ul>
          {cat === 'playback' && !q && (
            <div className="flex min-h-10 items-center gap-3 px-2" data-testid="shortcut-row-frameStep">
              <ArrowsLeftRight size={ICON.md} className="shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t('shortcuts.frameStep')}</span>
              <span className="text-xs text-fg-subtle">{t('shortcuts.shiftTen')}</span>
              <span className="flex min-w-36 justify-end gap-1 pr-[60px]">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
              </span>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
