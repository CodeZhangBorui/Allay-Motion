// “模板代码”停靠面板：当前模板的 template.js。用户模板可写，内置模板只读（先“复制为我的模板”）。
// 保存（Ctrl+S）经宿主接口写盘，监视服务照常发现、走热重载（H9、H10），热重载的诊断回来显示在行内（H5）；
// 打字时另做静态检查（语法、import、确定性规则 H12），行内标出。文件在外面被改过时不覆盖（内容版本对不上就是 conflict）。
// 面板用原生 DOM 画（可选模块不依赖主程序的组件库），样式只用主程序的 CSS 变量，和主界面一致。
import type { CodeViewDiagnostic, CurrentTemplate, Disposable, EditorHost, TemplateDiagnostic } from '@allay/host-api';
import { createEditor, type Editor } from './editor';
import type { MessageKey } from './messages';
import { sdkCompletion, sdkHover } from './sdk-assist';

const LINT_DELAY_MS = 300;

type Status = 'idle' | 'readOnly' | 'saved' | 'unsaved' | 'saving' | 'conflict' | 'invalid' | 'failed' | 'loadFailed';

export function toViewDiagnostics(list: readonly TemplateDiagnostic[]): CodeViewDiagnostic[] {
  return list.map((d) => ({
    severity: d.severity === 'error' ? 'error' : 'warning',
    message: `${d.kind} · ${d.code}: ${d.message}`,
    ...(d.line !== undefined ? { line: d.line } : {}),
    ...(d.column !== undefined ? { column: d.column } : {}),
  }));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, testId: string): HTMLButtonElement {
  const b = el('button', { height: 'var(--h-control)', padding: '0 10px', borderRadius: '6px', border: 'none', background: 'var(--control)', color: 'var(--foreground)', font: 'inherit', fontSize: '12px', cursor: 'pointer' }, label);
  b.type = 'button';
  b.dataset.testid = testId;
  b.addEventListener('click', onClick);
  b.addEventListener('mouseenter', () => (b.style.background = 'var(--control-hi)'));
  b.addEventListener('mouseleave', () => (b.style.background = 'var(--control)'));
  return b;
}

export function mountTemplatePanel(container: HTMLElement, host: EditorHost, close: () => void): Disposable {
  const t = (k: MessageKey) => host.ui.t(k);
  const root = el('div', { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', fontFamily: 'var(--font-ui)', fontSize: '12px', color: 'var(--foreground)' });
  root.dataset.testid = 'code-editor-panel';
  const head = el('div', { display: 'flex', alignItems: 'center', gap: '8px', height: 'var(--h-panel-head)', flexShrink: '0', padding: '0 8px 0 14px' });
  const title = el('span', { fontSize: '12.5px', fontWeight: '600' });
  const name = el('span', { color: 'var(--fg-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' });
  const spacer = el('span', { flex: '1' });
  const status = el('span', { color: 'var(--fg-subtle)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' });
  status.dataset.testid = 'code-editor-status';
  const save = button('', () => void doSave(), 'code-editor-save');
  const copy = button('', () => void host.commands.dispatch('copyBuiltinTemplate'), 'code-editor-copy');
  const reload = button('', () => void load(true), 'code-editor-reload');
  const closeBtn = button('', close, 'code-editor-close');
  head.append(title, name, spacer, status, copy, reload, save, closeBtn);
  const body = el('div', { flex: '1', minHeight: '0', overflow: 'hidden', borderRadius: '0 0 10px 10px', position: 'relative' });
  const empty = el('p', { padding: '12px 14px', color: 'var(--fg-subtle)', lineHeight: '1.45', margin: '0' });
  root.append(head, body);
  container.append(root);

  let current: CurrentTemplate | null = null;
  let version = '';
  let saved = '';
  let state: Status = 'idle';
  let editor: Editor | null = null;
  let lintTimer: ReturnType<typeof setTimeout> | null = null;
  let lintDiags: CodeViewDiagnostic[] = [];
  let runtimeDiags: CodeViewDiagnostic[] = [];
  let subs: Disposable[] = [];
  let token = 0;

  const pushDiagnostics = () => editor?.setDiagnostics([...runtimeDiags, ...lintDiags]);
  const setStatus = (s: Status) => {
    state = s;
    status.textContent = s === 'idle' ? '' : t(`code-editor.status.${s}` as MessageKey);
    status.style.color = s === 'conflict' || s === 'invalid' || s === 'failed' || s === 'loadFailed' ? 'var(--danger)' : 'var(--fg-subtle)';
    root.dataset.status = s;
  };
  const relabel = () => {
    title.textContent = t('code-editor.panel.title');
    save.textContent = t('code-editor.panel.save');
    copy.textContent = t('code-editor.panel.copy');
    reload.textContent = t('code-editor.panel.reload');
    closeBtn.textContent = t('code-editor.panel.close');
    setStatus(state);
  };

  const lint = (source: string) => {
    if (lintTimer) clearTimeout(lintTimer);
    lintTimer = setTimeout(() => {
      void host.engine.lint(source).then((d) => {
        lintDiags = toViewDiagnostics(d);
        pushDiagnostics();
      });
    }, LINT_DELAY_MS);
  };

  const showEmpty = (key: MessageKey) => {
    editor?.dispose();
    editor = null;
    body.replaceChildren(empty);
    empty.textContent = t(key);
    save.style.display = 'none';
    copy.style.display = 'none';
    reload.style.display = 'none';
  };

  const ensureEditor = (value: string, readOnly: boolean) => {
    if (!editor) {
      body.replaceChildren();
      editor = createEditor(
        body,
        {
          language: 'javascript',
          value,
          readOnly,
          label: t('code-editor.label'),
          onChange: (v) => {
            if (current?.source !== 'user') return;
            setStatus(v === saved ? 'saved' : 'unsaved');
            lint(v);
          },
          onSave: () => void doSave(),
        },
        { completion: sdkCompletion(host.domain.sdkApi(), () => host.domain.blockIds()), hover: sdkHover(host.domain.sdkApi()) },
      );
    } else {
      editor.setValue(value);
      editor.setReadOnly(readOnly);
    }
  };

  async function load(force = false): Promise<void> {
    const my = ++token;
    for (const s of subs) s.dispose();
    subs = [];
    runtimeDiags = [];
    lintDiags = [];
    current = host.templates.current();
    name.textContent = current?.name ?? '';
    if (!current) return showEmpty('code-editor.empty.none');
    if (current.source === 'animation') return showEmpty('code-editor.empty.animation');
    let read: { source: string; version: string };
    try {
      read = await host.templates.read(current);
    } catch (error) {
      if (my !== token) return;
      const derived = error instanceof Error && /not-script/.test(error.message);
      showEmpty(derived ? 'code-editor.empty.derived' : 'code-editor.status.loadFailed');
      return;
    }
    if (my !== token) return;
    const user = current.source === 'user';
    version = read.version;
    saved = read.source;
    ensureEditor(read.source, !user);
    save.style.display = user ? '' : 'none';
    reload.style.display = user ? '' : 'none';
    copy.style.display = user ? 'none' : '';
    setStatus(user ? 'saved' : 'readOnly');
    if (user) {
      lint(read.source);
      const ref = { id: current.id, version: current.version };
      subs.push(
        host.templates.onExternalChange(ref, (v) => {
          if (v === version) return;
          // 没有未保存的改动：直接换成磁盘上的新内容；有就提示冲突，不覆盖用户的输入
          if (state === 'unsaved') setStatus('conflict');
          else void load();
        }),
        host.engine.onDiagnostics(ref, (d) => {
          runtimeDiags = toViewDiagnostics(d);
          pushDiagnostics();
        }),
      );
    }
    void force;
  }

  async function doSave(): Promise<void> {
    if (!editor || !current || current.source !== 'user' || state === 'saving') return;
    const text = editor.view.state.doc.toString();
    setStatus('saving');
    const r = await host.templates.write(current, text, version).catch(() => ({ ok: false as const, error: 'io' as const }));
    if (r.ok) {
      version = r.version;
      saved = text;
      setStatus('saved');
    } else setStatus(r.error === 'conflict' ? 'conflict' : r.error === 'invalid' ? 'invalid' : 'failed');
  }

  relabel();
  void load();
  const off = [host.templates.onCurrentChange(() => void load()), host.ui.onLocaleChange(relabel)];
  return {
    dispose() {
      token++;
      if (lintTimer) clearTimeout(lintTimer);
      for (const s of [...subs, ...off]) s.dispose();
      editor?.dispose();
      root.remove();
    },
  };
}
