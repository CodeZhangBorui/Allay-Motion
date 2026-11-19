// 代码窗口的页面（docs/animation-editor.md 第 9 节）：动画文档的代码，和主窗口实时双向同步。
// 这个页面很小：不启动引擎、不注册核心功能。编辑器来自可选模块（经宿主接口 ui.registerCodeView 注册代码视图），
// 主程序不认识具体的模块——按目录发现、按设置的开关表加载，和主窗口同一个发现函数。
// 两个窗口之间的消息都经主进程转发：收 codeWindow.onDown，发 codeWindow.send（主进程只收这个页面的这一个通道和 app.info）。
// 文档的唯一主人是主窗口的工程状态：这里只显示文本、交回编辑；撤销、重做交给主窗口的历史。
import type { CodeViewHandle, CodeViewProvider, Disposable, EditorHost } from '@allay/host-api';
import i18next from 'i18next';
import '../app.css';
import { CodeWindowDownSchema, type CodeWindowDown } from '../../shared/code-window';
import { liveMarks, timeAtOffset } from '../../shared/animation/source-map';
import { parseAnimation } from '../../shared/animation/schema';
import { resolveDoc, type ResolvedDoc } from '../../shared/animation/resolve';
import { applyThemeToDocument } from '../app/useThemeSync';
import { discoveredModules } from '../app/optionalModules';
import { initI18n } from '../i18n';

const EDIT_DEBOUNCE_MS = 300;
const none: Disposable = { dispose: () => undefined };
const unsupported = (what: string) => () => Promise.reject(new Error(`${what} is not available in the code window`));

/** 代码窗口里的宿主：只有代码视图和文案；其余成员不可用（这个窗口的 IPC 只能交回编辑） */
function codeWindowHost(onProvider: (p: CodeViewProvider) => void): EditorHost {
  return {
    templates: { read: unsupported('templates.read'), write: unsupported('templates.write'), current: () => null, onCurrentChange: () => none, onExternalChange: () => none },
    engine: { onDiagnostics: () => none, requestReload: unsupported('engine.requestReload'), lint: () => Promise.resolve([]) },
    commands: { dispatch: unsupported('commands.dispatch') },
    playhead: { get: () => 0, subscribe: () => none },
    domain: { blockIds: () => [], easings: () => [], sdkApi: () => ({ formatVersion: 1, source: '', ctx: [], types: {}, aliases: {}, easings: [] }) },
    ui: {
      registerPanel: () => none,
      registerCommand: () => none,
      registerMessages: (locale, m) => {
        const tree: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(m)) {
          const parts = k.split('.');
          let node = tree;
          for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
          node[parts.at(-1)!] = String(v).slice(0, 2000);
        }
        i18next.addResourceBundle(locale, 'translation', tree, true, false);
        return none;
      },
      registerCodeView: (p) => {
        onProvider(p);
        return none;
      },
      t: (k) => i18next.t(k),
      onLocaleChange: () => none,
    },
  };
}

/** 加载发现了的模块，拿到第一个代码视图的提供者；没有时为 null（模块被拆掉了） */
async function loadProvider(): Promise<CodeViewProvider | null> {
  let provider: CodeViewProvider | null = null;
  for (const load of Object.values(discoveredModules())) {
    try {
      const mod = await load();
      const activate = mod.activate ?? mod.default?.activate;
      if (typeof activate !== 'function') continue;
      activate(codeWindowHost((p) => (provider ??= p)));
      if (provider) return provider;
    } catch (error) {
      console.warn('[code-window] module failed to activate', error);
    }
  }
  return provider;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root')!;
  root.className = 'flex h-full flex-col bg-background p-1.5 text-sm text-foreground';
  const panel = el('section', 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface-1');
  panel.dataset.testid = 'code-window';
  const head = el('div', 'app-drag flex h-panel-head shrink-0 items-center gap-2 pr-2 pl-3.5');
  const title = el('span', 'text-[12.5px] font-semibold');
  const name = el('span', 'min-w-0 truncate text-xs text-fg-subtle');
  const spacer = el('span', 'flex-1');
  const status = el('span', 'truncate text-xs text-fg-subtle');
  status.dataset.testid = 'code-window-status';
  const live = el('button', 'app-no-drag h-control rounded-md bg-control px-2.5 text-xs text-foreground hover:bg-control-hi aria-pressed:bg-primary-soft aria-pressed:text-primary-text');
  live.type = 'button';
  live.dataset.testid = 'code-window-live';
  live.setAttribute('aria-pressed', 'false');
  head.append(title, name, spacer, status, live);
  const body = el('div', 'min-h-0 flex-1 overflow-hidden');
  const issuesList = el('ul', 'hidden max-h-28 shrink-0 flex-col gap-1 overflow-y-auto border-t border-divider px-3.5 py-2 text-xs');
  issuesList.dataset.testid = 'code-window-issues';
  const liveLabel = el('div', 'hidden h-6 shrink-0 items-center truncate border-t border-divider px-3.5 text-[11px] text-primary-text num');
  liveLabel.dataset.testid = 'code-window-live-label';
  panel.append(head, body, liveLabel, issuesList);
  root.append(panel);

  let handle: CodeViewHandle | null = null;
  let revision = 0;
  let shown: string | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let pendingText: string | null = null;
  let liveOn = false;
  /** 解析过参数（默认值）的文档：实时预览的映射按它算 */
  let doc: ResolvedDoc | null = null;
  let lastT = -1;
  let ready = false;

  const send = (m: Parameters<typeof window.allay.codeWindow.send>[0]) => void window.allay.codeWindow.send(m).catch((e: unknown) => console.warn('[code-window] send failed', e));
  const flush = () => {
    if (pending) clearTimeout(pending);
    pending = null;
    if (pendingText !== null) {
      send({ type: 'edit', text: pendingText, baseRevision: revision });
      pendingText = null;
    }
  };
  const reparse = (text: string) => {
    const r = parseAnimation(text);
    doc = r.ok ? resolveDoc(r.doc) : null;
  };
  const relabel = () => {
    title.textContent = i18next.t('anim.code.title');
    live.textContent = i18next.t('anim.codeWindow.live');
    live.title = i18next.t('anim.codeWindow.liveHint');
  };
  const updateMarks = (t: number, reveal: boolean) => {
    if (!handle?.setMarks) return;
    if (!liveOn || !doc || shown === null) {
      handle.setMarks([], false);
      liveLabel.classList.add('hidden');
      return;
    }
    const marks = liveMarks(doc, shown, t);
    handle.setMarks(marks, reveal);
    const main = marks.find((m) => m.kind !== 'layer');
    liveLabel.textContent = main ? main.label : '';
    liveLabel.classList.toggle('hidden', !main);
    liveLabel.classList.toggle('flex', !!main);
  };

  live.addEventListener('click', () => {
    liveOn = !liveOn;
    live.setAttribute('aria-pressed', String(liveOn));
    send({ type: 'live', on: liveOn });
    updateMarks(lastT < 0 ? 0 : lastT, true);
  });

  const onState = async (m: Extract<CodeWindowDown, { type: 'state' }>) => {
    applyThemeToDocument({ theme: m.theme, reducedMotion: m.reducedMotion ? 'on' : 'off' });
    if (!ready) {
      ready = true;
      await initI18n(m.language);
      document.documentElement.lang = m.language;
      relabel();
      const provider = await loadProvider();
      if (!provider) {
        body.append(el('p', 'px-3.5 py-3 text-xs text-fg-subtle', i18next.t('anim.codeWindow.noEditor')));
      } else {
        handle = provider(body, {
          language: 'json',
          value: m.text ?? '',
          label: i18next.t('anim.code.title'),
          onChange: (v) => {
            shown = v;
            pendingText = v;
            reparse(v);
            if (pending) clearTimeout(pending);
            pending = setTimeout(flush, EDIT_DEBOUNCE_MS);
          },
          onSave: () => flush(),
          onUndo: () => (flush(), send({ type: 'undo' })),
          onRedo: () => (flush(), send({ type: 'redo' })),
          onPick: (offset) => {
            if (!liveOn || !doc || shown === null) return;
            const t = timeAtOffset(doc, shown, offset);
            if (t !== null) send({ type: 'seek', t });
          },
        });
        shown = m.text ?? '';
        reparse(shown);
      }
    } else if (i18next.language !== m.language) {
      await i18next.changeLanguage(m.language);
      relabel();
    }
    revision = m.revision;
    document.title = m.title;
    name.textContent = m.title;
    // 正在打字（还没交回）的时候不拿主窗口的文本覆盖；交回之后主窗口会再推一份一样的
    if (pendingText === null && m.text !== null && m.text !== shown) {
      shown = m.text;
      reparse(m.text);
      handle?.setValue(m.text);
    }
    handle?.setReadOnly(m.text === null);
    status.textContent = m.text === null ? i18next.t('anim.codeWindow.noAnimation') : m.issues.length > 0 ? i18next.t('anim.codeWindow.invalid', { count: m.issues.length }) : i18next.t('anim.codeWindow.synced');
    status.style.color = m.issues.length > 0 ? 'var(--danger)' : '';
    panel.dataset.status = m.text === null ? 'none' : m.issues.length > 0 ? 'invalid' : 'synced';
    handle?.setDiagnostics(m.issues.map((i) => ({ severity: 'error' as const, message: i.path ? `${i.path}: ${i.message}` : i.message, ...(i.line !== undefined ? { line: i.line } : {}), ...(i.column !== undefined ? { column: i.column } : {}) })));
    issuesList.replaceChildren(...m.issues.map((i) => el('li', 'text-foreground', `${i.line !== undefined ? `${i.line}:${i.column ?? 1}  ` : ''}${i.path ? `${i.path}: ` : ''}${i.message}`)));
    issuesList.classList.toggle('hidden', m.issues.length === 0);
    issuesList.classList.toggle('flex', m.issues.length > 0);
    updateMarks(lastT < 0 ? 0 : lastT, false);
  };

  let chain = Promise.resolve();
  window.allay.codeWindow.onDown((raw) => {
    const parsed = CodeWindowDownSchema.safeParse(raw);
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.type === 'state') chain = chain.then(() => onState(m)).catch((e: unknown) => console.error('[code-window] state failed', e));
    else {
      const jumped = Math.abs(m.t - lastT) > 1e-6;
      lastT = m.t;
      if (jumped) updateMarks(m.t, true);
    }
  });
  window.addEventListener('beforeunload', flush);
  send({ type: 'ready' });
}

void bootstrap();
