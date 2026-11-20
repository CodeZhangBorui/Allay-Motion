import { Button } from '@allay/ui/components/button';
import { ContextMenuItem, ContextMenuSeparator } from '@allay/ui/components/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@allay/ui/components/dialog';
import { DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuItemIcon, DropdownMenuLabel, DropdownMenuShortcut } from '@allay/ui/components/dropdown-menu';
import { Input } from '@allay/ui/components/misc';
import { clampSegmentDuration, distributeEvenly, durationToEndAt, nextCue, prevCue, segmentStart, type TimelineMenuTarget, type TimelineSegment } from '@allay/ui/editor';
import {
  ArrowCounterClockwise,
  ArrowLineLeft,
  ArrowLineRight,
  CaretDoubleLeft,
  CaretDoubleRight,
  ClipboardText,
  Copy,
  Crosshair,
  Equals,
  Pause,
  Play,
  PlayCircle,
  Scissors,
  SkipBack,
  SkipForward,
  Timer,
  type Icon,
} from '@phosphor-icons/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore } from '../../stores/uiStore';
import { runCommand, seekCut, togglePlay } from '../commands/commands';
import { shortcutLabel, useShortcutFor } from '../commands/shortcutState';

// 时间轴的右键菜单（docs/decisions.md“2026-11 反馈：时间线与曲线编辑”）：按点中的轨道给不同的条目。
// 只做现有工程模型里能落地的：阶段轨的各段就是模板的 duration 参数，音效和剪辑点是模板给的（只读），
// 循环是开关（没有入/出点区间），时间轴没有缩放和轨道显隐。有对应命令的条目经命令层执行，右侧显示生效的快捷键。
// 一个条目只改一次参数（setParams 一次），撤销就是一步。

export interface StageSegment extends TimelineSegment {
  /** 参数的默认值（重置用） */
  default: number;
}

/** 时间轴里复制的时长（只在本次运行内有效；与属性面板的“复制值”是两份，见 decisions） */
let copiedDuration: number | null = null;

function setDurations(patch: Record<string, number>, locale: string): void {
  useProjectStore.getState().setParams(patch, locale);
}

function seek(t: number, play = false): void {
  const s = useTransportStore.getState();
  s.setPlaying(false);
  s.setTime(t);
  if (play) togglePlay();
}

function Shortcut({ command }: { command: string }) {
  const s = useShortcutFor(command);
  return s ? <DropdownMenuShortcut>{shortcutLabel(s)}</DropdownMenuShortcut> : null;
}

function Item({ icon, children, onClick, disabled, command, testId }: { icon?: Icon; children: ReactNode; onClick(): void; disabled?: boolean; command?: string; testId: string }) {
  return (
    <ContextMenuItem onClick={onClick} disabled={disabled} data-testid={`timeline-menu-${testId}`}>
      <DropdownMenuItemIcon icon={icon} />
      {children}
      {command && <Shortcut command={command} />}
    </ContextMenuItem>
  );
}

export interface TimelineMenuProps {
  target: TimelineMenuTarget;
  segments: readonly StageSegment[];
  fps: number;
  cues: readonly number[];
  cutTime: number | null;
  onEditDuration(index: number): void;
}

export function TimelineMenu({ target, segments, fps, cues, cutTime, onEditDuration }: TimelineMenuProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const time = useTransportStore((s) => s.time);
  const playing = useTransportStore((s) => s.playing);
  const loop = useTransportStore((s) => s.loop);
  const muted = useUiStore((s) => s.settings.editor.muted);
  const seg = target.segment !== null ? segments[target.segment] : undefined;

  let laneItems: ReactNode = null;
  if (target.lane === 'stages' && seg && target.segment !== null) {
    const i = target.segment;
    const start = segmentStart(segments, i);
    const toPlayhead = durationToEndAt(segments, i, time, fps);
    const even = distributeEvenly(segments, fps);
    laneItems = (
      <>
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {seg.label} · <span className="num">{seg.duration.toFixed(2)} s</span>
          </DropdownMenuLabel>
          <Item icon={Timer} testId="set-duration" onClick={() => onEditDuration(i)}>
            {t('timeline.menu.setDuration')}
          </Item>
          <Item icon={Crosshair} testId="end-to-playhead" disabled={time <= start || toPlayhead === seg.duration} onClick={() => setDurations({ [seg.key]: toPlayhead }, locale)}>
            {t('timeline.menu.endToPlayhead')}
          </Item>
          <Item icon={ArrowCounterClockwise} testId="reset-duration" disabled={seg.duration === seg.default} onClick={() => setDurations({ [seg.key]: seg.default }, locale)}>
            {t('timeline.menu.resetDuration')}
          </Item>
          <Item icon={Copy} testId="copy-duration" onClick={() => (copiedDuration = seg.duration)}>
            {t('timeline.menu.copyDuration')}
          </Item>
          <Item
            icon={ClipboardText}
            testId="paste-duration"
            disabled={copiedDuration === null}
            onClick={() => copiedDuration !== null && setDurations({ [seg.key]: clampSegmentDuration(seg, copiedDuration, fps) }, locale)}
          >
            {t('timeline.menu.pasteDuration')}
          </Item>
          <Item icon={ArrowLineLeft} testId="to-segment-start" onClick={() => seek(start)}>
            {t('timeline.menu.toSegmentStart')}
          </Item>
          <Item icon={ArrowLineRight} testId="to-segment-end" onClick={() => seek(start + seg.duration)}>
            {t('timeline.menu.toSegmentEnd')}
          </Item>
        </DropdownMenuGroup>
        {segments.length > 1 && (
          <>
            <ContextMenuSeparator />
            <Item icon={Equals} testId="distribute" disabled={segments.every((s) => even[s.key] === s.duration)} onClick={() => setDurations(even, locale)}>
              {t('timeline.menu.distribute')}
            </Item>
            <Item
              icon={ArrowCounterClockwise}
              testId="reset-all"
              disabled={segments.every((s) => s.duration === s.default)}
              onClick={() => setDurations(Object.fromEntries(segments.map((s) => [s.key, s.default])), locale)}
            >
              {t('timeline.menu.resetAll')}
            </Item>
          </>
        )}
      </>
    );
  } else if (target.lane === 'sound') {
    const prev = prevCue(cues, target.time, fps);
    const next = nextCue(cues, target.time, fps);
    laneItems = (
      <>
        <Item icon={CaretDoubleLeft} testId="prev-cue" command="prevCue" disabled={prev === null} onClick={() => prev !== null && seek(Math.round(prev * fps) / fps)}>
          {t('timeline.menu.prevCue')}
        </Item>
        <Item icon={CaretDoubleRight} testId="next-cue" command="nextCue" disabled={next === null} onClick={() => next !== null && seek(Math.round(next * fps) / fps)}>
          {t('timeline.menu.nextCue')}
        </Item>
        <DropdownMenuCheckboxItem checked={muted} onCheckedChange={() => runCommand('mute')} data-testid="timeline-menu-mute">
          {t('timeline.menu.mute')}
          <Shortcut command="mute" />
        </DropdownMenuCheckboxItem>
      </>
    );
  } else if (target.lane === 'cut') {
    laneItems = (
      <Item icon={Scissors} testId="to-cut" command="toCut" disabled={cutTime === null} onClick={seekCut}>
        {t('timeline.menu.toCut')}
      </Item>
    );
  }

  return (
    <>
      {laneItems}
      {laneItems && <ContextMenuSeparator />}
      <Item icon={Crosshair} testId="seek-here" disabled={target.time === time} onClick={() => seek(target.time)}>
        {t('timeline.menu.seekHere', { frame: Math.round(target.time * fps) })}
      </Item>
      <Item icon={PlayCircle} testId="play-here" onClick={() => seek(target.time, true)}>
        {t('timeline.menu.playHere')}
      </Item>
      <Item icon={playing ? Pause : Play} testId="play-pause" command="playPause" onClick={() => runCommand('playPause')}>
        {playing ? t('transport.pause') : t('transport.play')}
      </Item>
      <DropdownMenuCheckboxItem checked={loop} onCheckedChange={() => runCommand('loop')} data-testid="timeline-menu-loop">
        {t('timeline.menu.loop')}
        <Shortcut command="loop" />
      </DropdownMenuCheckboxItem>
      <ContextMenuSeparator />
      <Item icon={SkipBack} testId="to-start" command="toStart" onClick={() => runCommand('toStart')}>
        {t('transport.toStart')}
      </Item>
      <Item icon={SkipForward} testId="to-end" command="toEnd" onClick={() => runCommand('toEnd')}>
        {t('timeline.toEnd')}
      </Item>
    </>
  );
}

/** “设置时长…”：输入秒数，吸附到帧、限制在参数的 min/max 内 */
export function SegmentDurationDialog({ segment, fps, onClose }: { segment: StageSegment; fps: number; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState(() => segment.duration.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
  const parsed = Number(text.trim().replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(parsed);
  const value = valid ? clampSegmentDuration(segment, parsed, fps) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === null) return;
    setDurations({ [segment.key]: value }, i18n.language);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} data-testid="segment-duration-dialog" className="w-[360px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogTitle>{t('timeline.duration.title', { name: segment.label })}</DialogTitle>
          <DialogDescription>{t('timeline.duration.body', { min: segment.min, max: segment.max })}</DialogDescription>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">{t('timeline.duration.seconds')}</span>
            <Input autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.currentTarget.value)} onFocus={(e) => e.currentTarget.select()} data-testid="segment-duration-input" className="num" />
          </label>
          <span className="num text-xs text-fg-subtle" data-testid="segment-duration-preview">
            {value !== null ? t('timeline.duration.preview', { seconds: value.toFixed(3), frames: Math.round(value * fps) }) : t('timeline.duration.invalid')}
          </span>
          <DialogFooter>
            <Button type="button" variant="secondary" size="lg" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={value === null} data-testid="segment-duration-confirm">
              {t('timeline.duration.apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
