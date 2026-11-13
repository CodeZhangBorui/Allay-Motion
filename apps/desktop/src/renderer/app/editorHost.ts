// 宿主接口 EditorHost 的实现（docs/code-editing-and-mcp-plan.md 3.3；类型在 @allay/host-api）。
// 只实现主程序现有能力撑得住的成员；撑不住的（带版本的模板源码读写：主程序自己不读写模板代码，界面不反写代码）
// 调用时以 HostUnsupportedError 拒绝，不假装成功。每个可选模块拿到自己的一份，模块停用时随之注销。
import { BLOCKS } from '@allay/assets';
import i18next from 'i18next';
import type { Disposable, EditorHost, ReloadResult, SdkApiDoc, TemplateId } from '@allay/host-api';
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
      read: () => Promise.reject(new HostUnsupportedError('templates.read')),
      write: () => Promise.reject(new HostUnsupportedError('templates.write')),
      onExternalChange: (id: TemplateId, cb) => sub(hotReloader.onExternalChange((change) => sameRef(change, id) && change.hash !== null && cb(change.hash))),
    },
    engine: {
      onDiagnostics: (id, cb) => sub(hotReloader.onDiagnostics((ref, d) => sameRef(ref, id) && cb([...d]))),
      requestReload: async (id, source): Promise<ReloadResult> => {
        const cur = useProjectStore.getState().template;
        if (!cur || !sameRef(cur.ref, id)) return { ok: false, diagnostics: [{ kind: 'load', severity: 'error', code: 'not-current', message: 'only the current template can be reloaded' }] };
        return hotReloader.reloadWithSource({ ...cur, code: source });
      },
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
    },
    disposeAll() {
      for (const d of [...subs]) d();
      ui.disposeAll();
    },
  };
}
