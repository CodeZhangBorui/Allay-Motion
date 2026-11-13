// 资源栈界面的动作：调用 window.allay.resources，并把结果变成提示。
import type { TFunction } from 'i18next';
import type { AddPackResult } from '../../../shared/resources';
import { useNoticeStore } from '../../stores/noticeStore';
import { useResourceStore } from '../../stores/resourceStore';

function report(t: TFunction, result: AddPackResult): void {
  const notice = useNoticeStore.getState();
  if ('canceled' in result) return;
  if (result.ok) notice.show('info', t('resources.added'));
  else notice.show('error', t(`resources.addErrors.${result.error}`));
}

export async function addPack(t: TFunction, kind: 'zip' | 'folder'): Promise<void> {
  report(t, await window.allay.resources.addPack(kind));
}

/** 拖进窗口的文件：一个一个交给主进程（路径由 preload 从 File 取） */
export async function addDroppedFiles(t: TFunction, files: readonly File[]): Promise<void> {
  for (const file of files) {
    try {
      report(t, await window.allay.resources.addDroppedPack(file));
    } catch {
      useNoticeStore.getState().show('error', t('resources.addErrors.unreadable'));
    }
  }
}

export async function chooseGameDir(t: TFunction): Promise<void> {
  const r = await window.allay.resources.chooseGameDir();
  if ('ok' in r && !r.ok) useNoticeStore.getState().show('error', t('resources.noRelease'));
}

export async function setVanilla(patch: { consent?: boolean; enabled?: boolean }): Promise<void> {
  useResourceStore.getState().replace(await window.allay.resources.setVanilla(patch));
}

export function downloadVanilla(): void {
  // 结果（进度、失败）经 resources:changed 推过来
  void window.allay.resources.downloadVanilla();
}
