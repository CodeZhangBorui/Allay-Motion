// 宿主接口 EditorHost 的实现（docs/code-editing-and-mcp-plan.md 3.3；类型在 @allay/host-api）。
// 只实现主程序现有能力撑得住的成员；撑不住的调用时以 HostUnsupportedError 拒绝，不假装成功。
// 2026-11 起模板源码的读写（templates.read / write）已实现：内嵌代码编辑器经它读写用户模板的 template.js。每个可选模块拿到自己的一份，模块停用时随之注销。
import { BLOCKS } from '@allay/assets';
import i18next from 'i18next';
import type { CurrentTemplate, Disposable, EditorHost, ReloadResult, SdkApiDoc, TemplateId, WriteResult } from '@allay/host-api';
import { analyzeTemplateCode, TemplateCodeError } from '../../shared/template-code';
import { useTemplateStore } from '../stores/templateStore';
import { localized } from '../templates/catalog';
import { dispatch } from './registry';
import { hotReloader } from '../features/preview/hotReload';
import { sameRef } from '../stores/devStore';
import { useProjectStore } from '../stores/projectStore';
import { useTransportStore } from '../stores/transportStore';
import { createHostUi, type HostUi } from './hostUi';

export class HostUnsupportedError extends Error {
  constructor(member: string) {
    super(`${member} is not available in this version of the host`);
    this.name = 'HostUnsupportedError';
  }
}

export interface ModuleHost extends EditorHost {
  /** 注销这个模块经宿主注册过的一切（面板、命令、文案、订阅） */
  disposeAll(): void;
}

let sdkApiDoc: Promise<SdkApiDoc> | null = null;

/** pnpm templates:api 生成的接口说明。只在有模块启用时才加载（单独的代码块） */
export function loadSdkApi(): Promise<SdkApiDoc> {
  sdkApiDoc ??= import('../../../../../packages/template-sdk/generated/template-api.json').then((m) => (m as { default: SdkApiDoc }).default);
  return sdkApiDoc;
}

/** 模块要注册文案：等界面的 i18next 初始化完 */
function i18nReady(): Promise<void> {
  if (i18next.isInitialized) return Promise.resolve();
  return new Promise((resolve) => i18next.on('initialized', () => resolve()));
}

/** 当前模板的概况（宿主接口 templates.current） */
export function currentTemplate(): CurrentTemplate | null {
  const t = useProjectStore.getState().template;
  if (!t) return null;
  const entry = useTemplateStore.getState().entries.find((e) => e.id === t.ref.id && e.version === t.ref.version);
  const source: CurrentTemplate['source'] = t.animation ? 'animation' : entry?.source === 'user' ? 'user' : 'builtin';
  return { id: t.ref.id, version: t.ref.version, name: localized(t.manifest.name, i18next.language), source };
}

export async function createEditorHost(moduleId: string, ui: HostUi = createHostUi(moduleId)): Promise<ModuleHost> {
  const [sdkApi] = await Promise.all([loadSdkApi(), i18nReady()]);
  const subs = new Set<() => void>();
  const sub = (undo: () => void): Disposable => {
    let done = false;
    const dispose = () => {
      if (done) return;
      done = true;
      subs.delete(dispose);
      undo();
    };
    subs.add(dispose);
    return { dispose };
  };
  const blockIds = Object.freeze(Object.keys(BLOCKS));
  return {
    templates: {
      read: async (id) => {
        const r = await window.allay.templates.readSource(id.id, id.version);
        if (!r.ok) throw new Error(`cannot read template ${id.id}@${id.version}: ${r.error}`);
        return { source: r.source, version: r.version };
      },
      write: async (id, source, baseVersion): Promise<WriteResult> => {
        const r = await window.allay.templates.writeSource({ id: id.id, version: id.version, source, baseVersion });
        if (r.ok) return { ok: true, version: r.version };
        return r.error === 'conflict' ? { ok: false, error: 'conflict', currentVersion: r.currentVersion } : { ok: false, error: r.error };
      },
      current: () => currentTemplate(),
      onCurrentChange: (cb) =>
        sub(
          useProjectStore.subscribe((s, prev) => {
            if (s.template !== prev.template) cb(currentTemplate());
          }),
        ),
      onExternalChange: (id: TemplateId, cb) => sub(hotReloader.onExternalChange((change) => sameRef(change, id) && change.hash !== null && cb(change.hash))),
    },
    engine: {
      onDiagnostics: (id, cb) => sub(hotReloader.onDiagnostics((ref, d) => sameRef(ref, id) && cb([...d]))),
      requestReload: async (id, source): Promise<ReloadResult> => {
        const cur = useProjectStore.getState().template;
        if (!cur || !sameRef(cur.ref, id)) return { ok: false, diagnostics: [{ kind: 'load', severity: 'error', code: 'not-current', message: 'only the current template can be reloaded' }] };
        return hotReloader.reloadWithSource({ ...cur, code: source });
      },
      lint: async (source) => {
        try {
          return await analyzeTemplateCode(source);
        } catch (error) {
          if (error instanceof TemplateCodeError) return [error.diagnostic];
          throw error;
        }
      },
    },
    commands: {
      dispatch: (id, input) => dispatch(id, input, { source: `module:${moduleId}` }),
    },
    playhead: {
      get: () => useTransportStore.getState().time,
      subscribe: (cb) => sub(useTransportStore.subscribe((s, prev) => s.time !== prev.time && cb(s.time))),
    },
    domain: {
      blockIds: () => blockIds,
      easings: () => sdkApi.easings,
      sdkApi: () => sdkApi,
    },
    ui: {
      registerPanel: (p) => ui.registerPanel(p),
      registerCommand: (c) => ui.registerCommand(c),
      registerMessages: (locale, m) => ui.registerMessages(locale, m),
      registerCodeView: (provider) => ui.registerCodeView(provider),
      t: (key) => i18next.t(key),
      onLocaleChange: (cb) => {
        const handler = () => cb();
        i18next.on('languageChanged', handler);
        return sub(() => i18next.off('languageChanged', handler));
      },
    },
    disposeAll() {
      for (const d of [...subs]) d();
      ui.disposeAll();
    },
  };
}
