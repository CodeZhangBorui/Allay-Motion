// 音效选择器的库与按需取回（docs/decisions.md M6b）：
// - 库 = 资源栈合并后的 sounds.json 里的全部事件（主进程算，带可用状态），resourceStamp 变了就重新取；
// - 用户试听或选中某个音效、或在导出前确认取回时，才让主进程取回下载缓存里还没取的音效对象（联网只经 fetchObject）。
//   不做后台批量下载；离线取不到时标成不可用并提示，不报错。
import i18next from 'i18next';
import { create } from 'zustand';
import type { SoundFileState, SoundLibrary } from '../../shared/resources';
import { notify } from '../stores/noticeStore';
import { useResourceStore } from '../stores/resourceStore';

interface SoundLibraryState {
  stamp: string | null;
  events: SoundLibrary['events'];
  /** 两种语言的语言文件在不在（中文语言文件还没取回时，中文界面的音效名先用英文） */
  lang: SoundLibrary['lang'];
  loading: boolean;
}

export const useSoundLibraryStore = create<SoundLibraryState>(() => ({ stamp: null, events: [], lang: { 'zh-CN': false, en: false }, loading: true }));

let seq = 0;
export async function refreshSoundLibrary(): Promise<void> {
  const mine = ++seq;
  useSoundLibraryStore.setState({ loading: true });
  try {
    const lib = await window.allay.resources.soundLibrary();
    if (mine === seq) useSoundLibraryStore.setState({ stamp: lib.stamp, events: lib.events, lang: lib.lang, loading: false });
  } catch (error) {
    console.warn('[audio] sound library failed', error);
    if (mine === seq) useSoundLibraryStore.setState({ events: [], loading: false });
  }
}

let started = false;
/** 应用启动时调用一次：先取一次，之后资源栈一变就重新取 */
export function startSoundLibrary(): void {
  if (started) return;
  started = true;
  void refreshSoundLibrary();
  useResourceStore.subscribe((s, prev) => {
    if (s.state?.stamp !== prev.state?.stamp) void refreshSoundLibrary();
  });
}

/**
 * 音效文件的状态；fetch 为真时取回 remote 的（用户操作触发）。取回了东西就刷新库；
 * 取不到（离线、校验失败）时提示一次，返回的状态里它们仍是 remote。
 */
export async function soundFileStates(files: readonly string[], fetch: boolean): Promise<Record<string, SoundFileState>> {
  if (files.length === 0) return {};
  const unique = [...new Set(files)].slice(0, 256);
  const r = await window.allay.resources.soundFiles(unique, fetch).catch(() => null);
  if (!r) return Object.fromEntries(unique.map((f) => [f, 'missing' as const]));
  if (fetch) {
    // 音效库不缓存“缺失”，取回之后下次解码就能读到；选择器的库重新取一次状态
    if (unique.some((f) => r.states[f] === 'local')) void refreshSoundLibrary();
    if (!r.ok) notify('info', i18next.t('audio.fetchFailed'));
  }
  return r.states;
}

/** 一个事件全部变体的音效名 */
export async function eventFiles(eventId: string): Promise<string[]> {
  const variants = (await window.allay.resources.soundVariants(eventId).catch(() => null)) ?? [];
  return variants.filter((v) => v.weight > 0).map((v) => v.file);
}

/** 用户在选择器里选中了一个音效：把它全部变体里还没取回的取回来（预览、导出都要用） */
export async function prepareSound(eventId: string): Promise<void> {
  const files = await eventFiles(eventId);
  const states = await soundFileStates(files, false);
  const remote = files.filter((f) => states[f] === 'remote');
  // 中文界面、中文语言文件还没取回：随这次选中一并取回（只在下载缓存的原版层里取，2026-11 反馈）
  const needLang = i18next.language.startsWith('zh') && !useSoundLibraryStore.getState().lang['zh-CN'];
  if (remote.length > 0 || needLang) {
    await soundFileStates(remote, true);
    if (remote.length === 0) void refreshSoundLibrary();
  }
}

/** 导入音效文件（主进程弹对话框）；返回新事件的 ID */
export async function importSounds(): Promise<string[]> {
  const r = await window.allay.resources.importSounds().catch(() => null);
  if (!r || 'canceled' in r) return [];
  if (!r.ok) {
    notify('error', i18next.t('audio.importFailed'));
    return [];
  }
  notify('info', i18next.t(r.skipped > 0 ? 'audio.importedSome' : 'audio.imported', { count: r.ids.length, skipped: r.skipped }));
  // 资源栈的 stamp 变了，库会自动重新取；这里也等一次，让刚导入的立刻能选
  await refreshSoundLibrary();
  return r.ids;
}

export async function removeImportedSound(id: string): Promise<void> {
  const state = await window.allay.resources.removeImportedSound(id).catch(() => null);
  if (state) useResourceStore.getState().replace(state);
}
