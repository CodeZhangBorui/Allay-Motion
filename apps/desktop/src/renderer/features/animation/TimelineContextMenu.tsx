// 动画时间轴的右键菜单（docs/animation-editor.md 6.7）：按点中的东西给不同的条目。
// 关键帧：复制、粘贴、删除、对齐到播放头、缓动；图层：复制、成组、隐藏 / 独显 / 锁定、删除；标记：跳过去、重命名、删除；
// 刻度和空白处：跳到这里、在这里加标记、工作区从这里开始 / 到这里结束、清除工作区、把关键帧粘贴到这里。
// 条目都经命令层执行（一个条目一步撤销），右侧显示生效的快捷键。
import { Button } from '@allay/ui/components/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@allay/ui/components/context-menu';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@allay/ui/components/dialog';
import { DropdownMenuShortcut } from '@allay/ui/components/dropdown-menu';
import { Input } from '@allay/ui/components/misc';
import { useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { sameKey, type KeyRef } from '../../../shared/animation/edit';
import { ANIM_PROPS, type AnimEasing, type AnimProp } from '../../../shared/animation/schema';
import { trigger } from '../../app/registry';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { shortcutLabel, useShortcutFor } from '../commands/shortcutState';
import { useAnimationUi } from './uiState';

/** 右键点中的东西 */
export type MenuTarget = { kind: 'key'; refs: KeyRef[] } | { kind: 'layer'; layer: string } | { kind: 'marker'; id: string; t: number; label: string } | { kind: 'time'; t: number };

const EASES: { ease: AnimEasing | undefined; key: string }[] = [
  { ease: undefined, key: 'linear' },
  { ease: 'cubicInOut', key: 'smooth' },
  { ease: 'cubicOut', key: 'out' },
  { ease: 'cubicIn', key: 'in' },
  { ease: 'backOut', key: 'back' },
  { ease: 'hold', key: 'hold' },
];

function Shortcut({ command }: { command: string }) {
  const s = useShortcutFor(command);
  return s ? <DropdownMenuShortcut>{shortcutLabel(s)}</DropdownMenuShortcut> : null;
}

function Item({ onClick, children, command, danger, testId }: { onClick(): void; children: ReactNode; command?: string; danger?: boolean; testId?: string }) {
  return (
    <ContextMenuItem onClick={onClick} className={danger ? 'text-danger' : undefined} data-testid={testId}>
      {children}
      {command && <Shortcut command={command} />}
    </ContextMenuItem>
  );
}

/**
 * 包住时间轴的身体：右键时由 resolve 按点中的元素（和指针处的时刻）给出目标，菜单照目标列条目。
 * resolve 返回 null 时不弹菜单（让浏览器的默认行为也不出现）
 */
export function TimelineContextMenu({ resolve, children }: { resolve(e: ReactMouseEvent): MenuTarget | null; children: ReactNode }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<MenuTarget | null>(null);
  const [rename, setRename] = useState<{ id: string; label: string } | null>(null);
  const doc = useProjectStore((s) => s.template?.animation?.doc ?? null);
  const seek = (time: number) => {
    useTransportStore.getState().setPlaying(false);
    useTransportStore.getState().setTime(time);
  };
  const layer = target?.kind === 'layer' ? doc?.layers.find((l) => l.id === target.layer) : undefined;
  const onContext = (e: ReactMouseEvent) => {
    const next = resolve(e);
    setTarget(next);
    if (!next) return;
    // 右键点到没选中的东西：先选中它（同文件管理器）
    const ui = useAnimationUi.getState();
    if (next.kind === 'key' && !next.refs.every((r) => ui.keys.some((k) => sameKey(k, r)))) ui.selectKeys(next.refs);
    if (next.kind === 'layer' && !ui.layers.includes(next.layer)) ui.selectLayers([next.layer]);
  };
  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    if (rename) trigger('animRenameMarker', { id: rename.id, label: rename.label });
    setRename(null);
  };
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={<div className="contents" onContextMenu={onContext} />}>{children}</ContextMenuTrigger>
        {target && (
          <ContextMenuContent className="w-60" data-testid="anim-context-menu" data-kind={target.kind}>
            {target.kind === 'key' && (
              <>
                <Item command="animCopySelection" onClick={() => trigger('animCopySelection')}>
                  {t('anim.commands.copySelection')}
                </Item>
                <Item command="animPasteSelection" onClick={() => trigger('animPasteSelection')}>
                  {t('anim.commands.pasteSelection')}
                </Item>
                <Item command="animAlignSelectionToPlayhead" onClick={() => trigger('animAlignSelectionToPlayhead')}>
                  {t('anim.commands.alignToPlayhead')}
                </Item>
                <ContextMenuSeparator />
                {EASES.map((e) => (
                  <Item key={e.key} testId={`anim-menu-ease-${e.key}`} onClick={() => trigger('animSetKeysEase', { keys: useAnimationUi.getState().keys, ...(e.ease !== undefined ? { ease: e.ease } : {}) })}>
                    {t(`anim.menu.eases.${e.key}`)}
                  </Item>
                ))}
                <ContextMenuSeparator />
                <Item danger command="animDeleteSelection" onClick={() => trigger('animDeleteSelection')}>
                  {t('anim.commands.deleteSelection')}
                </Item>
              </>
            )}
            {target.kind === 'layer' && layer && (
              <>
                <Item command="animDuplicateSelection" onClick={() => trigger('animDuplicateSelection')}>
                  {t('anim.commands.duplicateSelection')}
                </Item>
                <Item command="animGroupSelection" onClick={() => trigger('animGroupSelection')}>
                  {t('anim.commands.groupSelection')}
                </Item>
                {layer.type === 'group' && (
                  <Item command="animUngroupSelection" onClick={() => trigger('animUngroupSelection')}>
                    {t('anim.commands.ungroupSelection')}
                  </Item>
                )}
                <ContextMenuSeparator />
                <Item testId="anim-menu-hide" onClick={() => trigger('animSetLayerFlags', { layer: layer.id, hidden: !layer.hidden })}>
                  {t(layer.hidden ? 'anim.layers.show' : 'anim.layers.hide')}
                </Item>
                <Item onClick={() => trigger('animSetLayerFlags', { layer: layer.id, solo: !layer.solo })}>{t(layer.solo ? 'anim.menu.unsolo' : 'anim.layers.solo')}</Item>
                <Item onClick={() => trigger('animSetLayerFlags', { layer: layer.id, locked: !layer.locked })}>{t(layer.locked ? 'anim.layers.unlock' : 'anim.layers.lock')}</Item>
                <ContextMenuSeparator />
                <Item danger command="animDeleteSelection" onClick={() => trigger('animDeleteSelection')}>
                  {t('anim.layers.remove')}
                </Item>
              </>
            )}
            {target.kind === 'marker' && (
              <>
                <Item onClick={() => seek(target.t)}>{t('anim.menu.seekMarker')}</Item>
                <Item testId="anim-menu-rename-marker" onClick={() => setRename({ id: target.id, label: target.label })}>
                  {t('anim.commands.renameMarker')}…
                </Item>
                <ContextMenuSeparator />
                <Item danger testId="anim-menu-remove-marker" onClick={() => trigger('animRemoveMarker', { id: target.id })}>
                  {t('anim.commands.removeMarker')}
                </Item>
              </>
            )}
            {target.kind === 'time' && (
              <>
                <Item onClick={() => seek(target.t)}>{t('anim.menu.seekHere', { t: target.t })}</Item>
                <Item testId="anim-menu-add-marker" onClick={() => trigger('animAddMarker', { t: target.t })}>
                  {t('anim.menu.markerHere')}
                </Item>
                <ContextMenuSeparator />
                <Item testId="anim-menu-work-start" onClick={() => trigger('animSetWorkArea', { from: target.t })}>
                  {t('anim.menu.workStartHere')}
                </Item>
                <Item testId="anim-menu-work-end" onClick={() => trigger('animSetWorkArea', { to: target.t })}>
                  {t('anim.menu.workEndHere')}
                </Item>
                {doc?.workArea && <Item onClick={() => trigger('animClearWorkArea')}>{t('anim.commands.clearWorkArea')}</Item>}
                {useAnimationUi.getState().clipboard && (
                  <>
                    <ContextMenuSeparator />
                    <Item
                      onClick={() => {
                        seek(target.t);
                        trigger('animPasteSelection');
                      }}
                    >
                      {t('anim.menu.pasteHere')}
                    </Item>
                  </>
                )}
              </>
            )}
          </ContextMenuContent>
        )}
      </ContextMenu>
      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="w-80" data-testid="anim-rename-marker">
          <DialogTitle>{t('anim.commands.renameMarker')}</DialogTitle>
          <form onSubmit={submitRename} className="flex flex-col gap-3">
            <Input autoFocus value={rename?.label ?? ''} maxLength={60} aria-label={t('anim.menu.markerName')} onChange={(e) => setRename((r) => (r ? { ...r, label: e.currentTarget.value } : r))} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRename(null)}>
                {t('anim.menu.cancel')}
              </Button>
              <Button type="submit">{t('anim.menu.ok')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 一个菱形元素上的 data-key-* 换成关键帧地址（图层那一行的菱形是这个时刻上这个图层所有属性的关键帧） */
export function keyRefsOf(el: HTMLElement, propsAt: (layer: string, t: number) => AnimProp[]): KeyRef[] {
  const layer = el.dataset.keyLayer!;
  const t = Number(el.dataset.keyT);
  const prop = el.dataset.keyProp as AnimProp | undefined;
  if (prop && (ANIM_PROPS as readonly string[]).includes(prop)) return [{ layer, prop, t }];
  return propsAt(layer, t).map((p) => ({ layer, prop: p, t }));
}
