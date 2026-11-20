// 主窗口这一侧的代码窗口与外部编辑器（docs/animation-editor.md 6.11）。
// - 代码窗口：工程状态一变就把整份状态推过去；代码窗口交回的编辑、跳转、撤销重做在这里执行
//   （编辑经 animSetText 命令，进同一份撤销历史；撤销重做就是主窗口的 undo/redo 命令）。实时预览开着时推播放头。
// - 外部编辑器：主进程把文档写成文件、用设置里的程序打开；文件改了推回来，这里同样经 animSetText；
//   主窗口改了文档时把文件改成新文本。
// 打开代码用什么由设置决定（应用自带 / 系统默认 / 指定程序），默认应用自带。
import i18next from 'i18next';
import { CodeWindowUpSchema, type CodeEditorKind, type CodeWindowDown } from '../../../shared/code-window';
import { dispatch } from '../../app/registry';
import { discoveredModules } from '../../app/optionalModules';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore } from '../../stores/uiStore';
import { create } from 'zustand';
import { currentAnimation, setAnimationText } from './source';
import { useAnimationUi } from './uiState';

const TIME_INTERVAL_MS = 33;
const FILE_SYNC_DEBOUNCE_MS = 300;

interface CodeWindowState {
  open: boolean;
  live: boolean;
  /** 已经用外部编辑器打开过的动画（键）：它的文件跟着同步 */
  externalKey: string | null;
}

export const useCodeWindow = create<CodeWindowState>(() => ({ open: false, live: false, externalKey: null }));

/** 这次构建里有没有能提供代码编辑器的可选模块（没有被设置单独关掉的）。主程序不认识具体的模块，只看发现了几个 */
export function codeWindowAvailable(): boolean {
  const switches = useUiStore.getState().settings.optionalModules;
  return Object.keys(discoveredModules()).some((id) => switches[id] !== false);
}

function reducedMotion(): boolean {
  return document.documentElement.dataset.reducedMotion === 'true';
}

function stateMessage(): CodeWindowDown {
  const s = useProjectStore.getState();
  const anim = s.template?.animation;
  const settings = useUiStore.getState().settings;
  return {
    type: 'state',
    text: anim?.text ?? null,
    issues: anim ? anim.issues.slice(0, 20).map((i) => ({ message: i.message.slice(0, 2000), path: i.path.slice(0, 500), ...(i.line ? { line: i.line } : {}), ...(i.column ? { column: i.column } : {}) })) : [],
    revision: s.revision,
    title: (anim?.doc.name ?? i18next.t('anim.code.title')).slice(0, 200),
    theme: settings.theme,
    language: i18next.language === 'en' ? 'en' : 'zh-CN',
    reducedMotion: reducedMotion(),
  };
}

let scheduled = false;
function publishState(): void {
  if (!useCodeWindow.getState().open || scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    void window.allay.codeWindow.publish(stateMessage()).catch(() => undefined);
  });
}

let lastTimeSent = 0;
function publishTime(force = false): void {
  const { open, live } = useCodeWindow.getState();
  if (!open || !live) return;
  const now = performance.now();
  if (!force && now - lastTimeSent < TIME_INTERVAL_MS) return;
  lastTimeSent = now;
  const tr = useTransportStore.getState();
  void window.allay.codeWindow.publish({ type: 'time', t: Math.min(30, Math.max(0, tr.time)), playing: tr.playing }).catch(() => undefined);
}

export async function openCodeWindow(): Promise<void> {
  useCodeWindow.setState({ open: true });
  await window.allay.codeWindow.open();
  publishState();
}

export async function openExternal(): Promise<boolean> {
  const cur = currentAnimation();
  if (!cur) return false;
  const key = cur.source.ref.id;
  const r = await window.allay.animations.openExternal({ key, text: cur.text });
  if (!r.ok) {
    notify('error', i18next.t(`anim.codeWindow.errors.${r.error}`));
    return false;
  }
  useCodeWindow.setState({ externalKey: key });
  return true;
}

/** “编辑代码”：按设置用应用自带的代码窗口（模块不在时用停靠面板）、系统默认程序或指定的程序 */
export async function editCode(kind?: CodeEditorKind): Promise<void> {
  const k = kind ?? (await window.allay.editors.get()).kind;
  if (k !== 'builtin') {
    await openExternal();
    return;
  }
  if (codeWindowAvailable()) await openCodeWindow();
  else useAnimationUi.getState().setCodeOpen(true);
}

let started = false;

/** 启动时调用一次（workspace.tsx） */
export function startCodeWindowBridge(): void {
  if (started) return;
  started = true;
  window.allay.codeWindow.onUp((raw) => {
    const parsed = CodeWindowUpSchema.safeParse(raw);
    if (!parsed.success) return;
    const m = parsed.data;
    switch (m.type) {
      case 'ready':
        useCodeWindow.setState({ open: true });
        publishState();
        publishTime(true);
        break;
      case 'edit':
        if (currentAnimation()) void dispatch('animSetText', { text: m.text }, { source: 'module:code-window' }).catch((e: unknown) => console.warn('[code-window] edit failed', e));
        break;
      case 'seek':
        useTransportStore.getState().setPlaying(false);
        useTransportStore.getState().setTime(m.t);
        break;
      case 'live':
        useCodeWindow.setState({ live: m.on });
        publishTime(true);
        break;
      case 'undo':
      case 'redo':
        void dispatch(m.type).catch(() => undefined);
        break;
      case 'closed':
        useCodeWindow.setState({ open: false, live: false });
        break;
    }
  });
  useProjectStore.subscribe((s, prev) => {
    if (s.template !== prev.template || s.revision !== prev.revision) publishState();
  });
  useUiStore.subscribe((s, prev) => {
    if (s.settings.theme !== prev.settings.theme || s.settings.reducedMotion !== prev.settings.reducedMotion) publishState();
  });
  i18next.on('languageChanged', () => publishState());
  useTransportStore.subscribe((s, prev) => {
    if (s.time !== prev.time || s.playing !== prev.playing) publishTime(s.playing !== prev.playing);
  });

  // 外部编辑器：文件改了 → 当前动画的文本；当前动画改了 → 文件
  window.allay.animations.onFileChanged((change) => {
    const cur = currentAnimation();
    if (!cur || cur.source.ref.id !== change.key || change.text === cur.text) return;
    setAnimationText(change.text);
  });
  let fileTimer: ReturnType<typeof setTimeout> | null = null;
  useProjectStore.subscribe((s, prev) => {
    const key = useCodeWindow.getState().externalKey;
    const anim = s.template?.animation;
    if (!key || !anim || s.template?.ref.id !== key || anim.text === prev.template?.animation?.text) return;
    if (fileTimer) clearTimeout(fileTimer);
    fileTimer = setTimeout(() => void window.allay.animations.syncFile({ key, text: anim.text }).catch(() => undefined), FILE_SYNC_DEBOUNCE_MS);
  });
}
