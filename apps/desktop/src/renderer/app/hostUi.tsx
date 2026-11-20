// 宿主接口里的界面部分（docs/code-editing-and-mcp-plan.md 3.3 的 ui）：可选模块经它把面板、命令、文案挂进界面注册表。
// 模块的 id 是它的目录名；它注册的面板、命令、文案键都必须以“<id>.”开头，碰不到核心功能的同名项。
// 模块停用时，经这里注册的东西全部注销。
import type { CodeViewProvider, CommandContribution, Disposable, HostLocale, PanelContribution } from '@allay/host-api';
import { registerCodeViewProvider } from './codeViews';
import i18next from 'i18next';
import { useEffect, useRef, type ComponentType } from 'react';
import { z } from 'zod';
import { registerCommand, registerPanel, type PanelRegion } from './registry';

const REGION: Record<PanelContribution['location'], PanelRegion> = { left: 'left', right: 'right', bottom: 'dock' };

export interface HostUi {
  registerPanel(p: PanelContribution): Disposable;
  registerCommand(c: CommandContribution): Disposable;
  registerMessages(locale: HostLocale, m: Record<string, string>): Disposable;
  registerCodeView(provider: CodeViewProvider): Disposable;
  /** 注销这个模块注册过的全部东西 */
  disposeAll(): void;
}

function panelComponent(mount: PanelContribution['mount']): ComponentType {
  return function ModulePanel() {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!ref.current) return undefined;
      const d = mount(ref.current);
      return () => d.dispose();
    }, []);
    return <div ref={ref} className="size-full min-h-0" />;
  };
}

export function createHostUi(moduleId: string): HostUi {
  const prefix = `${moduleId}.`;
  const owned = new Set<() => void>();
  const own = (undo: () => void): Disposable => {
    let done = false;
    const dispose = () => {
      if (done) return;
      done = true;
      owned.delete(dispose);
      undo();
    };
    owned.add(dispose);
    return { dispose };
  };
  const checkId = (what: string, id: string) => {
    if (!id.startsWith(prefix) || id.length > 128) throw new Error(`${what} “${id}” must start with “${prefix}”`);
  };
  return {
    registerPanel(p) {
      checkId('panel', p.id);
      checkId('title key', p.titleKey);
      return own(registerPanel({ id: p.id, titleKey: p.titleKey, region: REGION[p.location] ?? 'dock', order: 1000, component: panelComponent(p.mount.bind(p)) }));
    },
    registerCommand(c) {
      checkId('command', c.id);
      checkId('title key', c.titleKey);
      if (c.undoLabelKey !== undefined) checkId('undo label key', c.undoLabelKey);
      return own(
        registerCommand<unknown, unknown>({
          id: c.id,
          titleKey: c.titleKey,
          effect: c.effect,
          ...(c.undoLabelKey !== undefined ? { undoLabelKey: c.undoLabelKey } : {}),
          // 契约里的命令没有自己的 schema：参数至少要能过 IPC（JSON），由模块自己再细查
          input: z.json().optional(),
          run: (input) => c.run(input),
        }),
      );
    },
    registerMessages(locale, m) {
      const keys = Object.keys(m);
      for (const k of keys) checkId('message key', k);
      // 文案键里的点是层级：按层级放进 translation 命名空间
      const tree: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m)) {
        const parts = k.split('.');
        let node = tree;
        for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
        node[parts.at(-1)!] = String(v).slice(0, 2000);
      }
      i18next.addResourceBundle(locale, 'translation', tree, true, false);
      return own(() => {
        const bundle = i18next.getResourceBundle(locale, 'translation') as Record<string, unknown> | undefined;
        if (bundle) delete bundle[moduleId];
      });
    },
    registerCodeView(provider) {
      if (typeof provider !== 'function') throw new Error('code view provider must be a function');
      return own(registerCodeViewProvider(provider));
    },
    disposeAll() {
      for (const d of [...owned]) d();
    },
  };
}
