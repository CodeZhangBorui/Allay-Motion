import { ToggleGroup, ToggleGroupItem } from '@allay/ui/components/misc';
import { ICON } from '@allay/ui/lib/icons';
import { Check } from '@phosphor-icons/react';
import { cn } from '@allay/ui/lib/utils';
import i18next from 'i18next';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_PREFS, REDUCED_MOTION_PREFS, THEMES, type LanguagePref, type Theme } from '../../../shared/settings';
import { resolveLanguage, systemLocale } from '../../i18n';
import { useUiStore } from '../../stores/uiStore';

// 语言、主题、减少动效的选择：首次启动引导（6.10）和设置页（6.11）共用。选中立即生效（写进设置，界面跟着变）。
// 选中的样子和模板库的缩略图一样：2 px 面板色间隙加 2 px 强调色外框，不发光。

/** 一组单选的大块选项（键盘：左右 / 上下方向键在选项间移动并选中） */
function TileGroup<T extends string>({ label, value, options, onChange, render, testId, columns }: { label: string; value: T; options: readonly T[]; onChange(v: T): void; render(v: T, selected: boolean): ReactNode; testId: string; columns: number }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length]!;
    onChange(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="${testId}-${next}"]`)?.focus());
  };
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} data-testid={testId}>
      {options.map((o, i) => {
        const selected = o === value;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`${testId}-${o}`}
            onClick={() => onChange(o)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'group/tile relative flex min-w-0 flex-col items-stretch gap-2.5 rounded-lg bg-control p-2.5 text-left transition-colors duration-(--dur-1) outline-none hover:bg-control-hi',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)',
              selected && 'bg-control-hi shadow-[0_0_0_2px_var(--tile-gap,var(--surface-2)),0_0_0_4px_var(--primary)]',
            )}
          >
            {render(o, selected)}
          </button>
        );
      })}
    </div>
  );
}

function TileLabel({ title, detail, selected }: { title: ReactNode; detail?: ReactNode; selected: boolean }) {
  return (
    <span className="flex items-start justify-between gap-2 px-0.5">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('truncate text-sm', selected ? 'font-medium text-foreground' : 'text-fg-muted')}>{title}</span>
        {detail && <span className="truncate text-xs text-fg-subtle">{detail}</span>}
      </span>
      {selected && <Check size={ICON.sm} weight="bold" className="mt-0.5 shrink-0 text-primary-text" aria-hidden="true" />}
    </span>
  );
}

/** 主题的缩略图：用那套主题自己的设计变量画一个小工作区（顶栏、三块面板、时间轴、播放头、一个琥珀标记） */
export function ThemeMiniature({ theme, className }: { theme: Theme; className?: string }) {
  return (
    <span data-theme={theme} aria-hidden="true" className={cn('block aspect-[16/10] w-full overflow-hidden rounded-md bg-background p-[5%]', className)}>
      <span className="grid size-full gap-[3%]" style={{ gridTemplateColumns: '22% 1fr 26%', gridTemplateRows: '9% 1fr 28%' }}>
        <span className="col-span-3 flex items-center gap-[4%]">
          <span className="h-[70%] w-[5%] rounded-[2px] bg-allay" />
          <span className="h-[30%] w-[14%] rounded-[2px] bg-fg-faint" />
          <span className="ml-auto h-[70%] w-[12%] rounded-[2px] bg-primary" />
        </span>
        <span className="flex flex-col gap-[8%] rounded-[4px] bg-surface-1 p-[10%]">
          <span className="aspect-video w-full rounded-[2px] bg-well shadow-[0_0_0_1.5px_var(--primary)]" />
          <span className="aspect-video w-full rounded-[2px] bg-well" />
        </span>
        <span className="flex items-center justify-center rounded-[4px] bg-viewer">
          <span className="aspect-video w-[70%] rounded-[2px] bg-(--checker-b)" />
        </span>
        <span className="row-span-2 flex flex-col gap-[6%] rounded-[4px] bg-surface-1 p-[10%]">
          <span className="h-[5%] w-[60%] rounded-[2px] bg-fg-muted" />
          <span className="h-[7%] w-full rounded-[2px] bg-control" />
          <span className="relative h-[7%] w-full overflow-hidden rounded-[2px] bg-control">
            <span className="absolute inset-y-0 left-0 w-[40%] bg-primary-soft" />
          </span>
          <span className="flex h-[7%] w-full items-center gap-[6%]">
            <span className="size-[3px] shrink-0 rounded-full bg-mark" />
            <span className="h-full flex-1 rounded-[2px] bg-control" />
          </span>
        </span>
        <span className="relative col-span-2 flex flex-col justify-center gap-[10%] rounded-[4px] bg-surface-1 px-[3%]">
          <span className="flex h-[22%] gap-[1%]">
            <span className="w-[40%] rounded-[2px] bg-stage-enter" />
            <span className="w-[10%] rounded-[2px] bg-stage-hold" />
            <span className="w-[40%] rounded-[2px] bg-stage-exit" />
          </span>
          <span className="h-[18%] w-full rounded-[2px] bg-well" />
          <span className="absolute inset-y-[12%] left-[34%] w-[1.5px] bg-primary" />
        </span>
      </span>
    </span>
  );
}

export function ThemeChoice({ testId = 'choice-theme' }: { testId?: string }) {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.settings.theme);
  return (
    <TileGroup
      label={t('settings.theme')}
      value={theme}
      options={THEMES}
      columns={2}
      testId={testId}
      onChange={(v) => useUiStore.getState().setTheme(v)}
      render={(v, selected) => (
        <>
          <ThemeMiniature theme={v} />
          <TileLabel title={t(`settings.themes.${v}`)} detail={t(`settings.themeHints.${v}`)} selected={selected} />
        </>
      )}
    />
  );
}

/** 语言的选项里各用自己的语言写（选错了也认得出来）；“跟随系统”注明现在解析成哪一种 */
export function LanguageChoice({ testId = 'choice-language' }: { testId?: string }) {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.settings.language);
  const resolved = (l: LanguagePref) => resolveLanguage(l, systemLocale());
  return (
    <TileGroup
      label={t('settings.language')}
      value={language}
      options={LANGUAGE_PREFS}
      columns={3}
      testId={testId}
      onChange={(v) => useUiStore.getState().update({ language: v })}
      render={(v, selected) => {
        const fixed = i18next.getFixedT(resolved(v));
        return (
          <>
            <span className="flex h-16 flex-col justify-end gap-1 rounded-md bg-well px-3 py-2.5">
              <span className="truncate text-base font-semibold text-foreground">{v === 'system' ? t('settings.languages.system') : fixed(`settings.languages.${v}`)}</span>
              <span className="truncate text-xs text-fg-subtle">{fixed('onboarding.language.sample')}</span>
            </span>
            {/* 名称已经在上面用那种语言写了；下面一行只放“跟随系统”现在解析成哪种，和选中的对勾 */}
            <span className="flex min-h-5 items-center justify-between gap-2 px-0.5">
              <span className="truncate text-xs text-fg-subtle">{v === 'system' ? t('onboarding.language.systemDetail', { language: t(`settings.languages.${resolved(v)}`) }) : ''}</span>
              {selected && <Check size={ICON.sm} weight="bold" className="shrink-0 text-primary-text" aria-hidden="true" />}
            </span>
          </>
        );
      }}
    />
  );
}

export function MotionChoice({ testId = 'choice-motion' }: { testId?: string }) {
  const { t } = useTranslation();
  const value = useUiStore((s) => s.settings.reducedMotion);
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v: string[]) => v[0] && useUiStore.getState().update({ reducedMotion: v[0] as (typeof REDUCED_MOTION_PREFS)[number] })}
      aria-label={t('settings.reducedMotion')}
      data-testid={testId}
      className="w-64"
    >
      {REDUCED_MOTION_PREFS.map((m) => (
        <ToggleGroupItem key={m} value={m} data-testid={`${testId}-${m}`}>
          {t(`settings.reducedMotions.${m}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
