// 撤销历史列表（docs/animation-editor.md 6.7）：时间轴标题行的一个按钮，点开是这次编辑的每一步（最新的在上面），
// 点哪一步就回到那一步（连着撤销或重做，一步也不丢：之后还能重做回来）。每一步的名字就是撤销菜单里的那个名字。
import { Button } from '@allay/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@allay/ui/components/popover';
import { ICON } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { historyList, jumpHistory, useProjectStore } from '../../stores/projectStore';

export function HistoryList() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 历史变了（改动、撤销、重做）时重画
  useStore(useProjectStore.temporal, (s) => s.pastStates.length * 1000 + s.futureStates.length);
  useProjectStore((s) => s.revision);
  const { entries, current } = historyList();
  const rows = entries.map((e, i) => ({ ...e, i })).reverse();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" aria-label={t('anim.history.title')} title={t('anim.history.title')} disabled={entries.length <= 1} data-testid="anim-history" />}
      >
        <ClockCounterClockwise size={ICON.md} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5" data-testid="anim-history-list">
        <p className="px-2 pt-1 pb-1.5 text-xs text-fg-subtle">{t('anim.history.hint')}</p>
        <ol className="flex flex-col" aria-label={t('anim.history.title')}>
          {rows.map((r) => (
            <li key={r.i}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-control',
                  r.i === current ? 'bg-control text-foreground' : r.i > current ? 'text-fg-subtle' : 'text-fg-muted',
                )}
                aria-current={r.i === current ? 'step' : undefined}
                data-testid="anim-history-entry"
                data-index={r.i}
                onClick={() => {
                  jumpHistory(r.i);
                  setOpen(false);
                }}
              >
                <span className="w-6 shrink-0 text-right text-xs text-fg-subtle num">{r.i}</span>
                <span className="min-w-0 flex-1 truncate">{r.labelKey ? t(r.labelKey) : t('anim.history.start')}</span>
                {r.source === 'main' && <span className="shrink-0 text-xs text-fg-subtle">{t('anim.history.byAgent')}</span>}
              </button>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  );
}
