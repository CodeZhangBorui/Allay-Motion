// T-DEV-4（接入点）：可选模块按设置里的开关表惰性加载（docs/code-editing-and-mcp-plan.md 3.1、3.2）。
// 用只存在于测试夹具里的假模块（tests/fixtures/fake-module）验证：开关打开时被加载、能经宿主接口注册面板与命令；
// 关着时连代码都不加载；关掉时注册的东西全部注销。这次构建实际发现的模块（packages/optional）为空表。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EditorHost } from '../../packages/host-api/src/index';
import { initI18n } from '../../apps/desktop/src/renderer/i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHostUi } from '../../apps/desktop/src/renderer/app/hostUi';
import { discoveredModules, modulesFromGlob, OptionalModuleManager, type ActiveHost, type ModuleExports } from '../../apps/desktop/src/renderer/app/optionalModules';
import { dispatch, getCommand, useRegistry } from '../../apps/desktop/src/renderer/app/registry';

let i18next: Awaited<ReturnType<typeof initI18n>>;
beforeAll(async () => {
  i18next = await initI18n('zh-CN');
});

/** 测试用的宿主：界面部分是真的（注册表、i18next），其余是最小实现 */
function testHost(id: string): Promise<ActiveHost> {
  const ui = createHostUi(id);
  const none = { dispose: () => undefined };
  const host: EditorHost = {
    templates: { read: () => Promise.reject(new Error('n/a')), write: () => Promise.reject(new Error('n/a')), current: () => null, onCurrentChange: () => none, onExternalChange: () => none },
    engine: { onDiagnostics: () => none, requestReload: () => Promise.resolve({ ok: false, diagnostics: [] }), lint: () => Promise.resolve([]) },
    commands: { dispatch: (cmd, input) => dispatch(cmd, input) },
    playhead: { get: () => 0, subscribe: () => none },
    domain: { blockIds: () => ['minecraft:stone'], easings: () => ['linear'], sdkApi: () => ({ formatVersion: 1, source: '', ctx: [], types: {}, aliases: {}, easings: [] }) },
    ui: { registerPanel: (p) => ui.registerPanel(p), registerCommand: (c) => ui.registerCommand(c), registerMessages: (l, m) => ui.registerMessages(l, m), registerCodeView: (v) => ui.registerCodeView(v), t: (k) => k, onLocaleChange: () => none },
  };
  return Promise.resolve({ ...host, disposeAll: () => ui.disposeAll() });
}

describe('T-DEV-4 可选模块的惰性加载', () => {
  it('这次构建发现的可选模块就是 packages/optional 下带 src/index.ts 的目录（目录被删时是空表）', () => {
    const root = join(import.meta.dirname, '../../packages/optional');
    const dirs = existsSync(root) ? readdirSync(root).filter((d) => existsSync(join(root, d, 'src/index.ts'))) : [];
    expect(Object.keys(discoveredModules()).sort()).toEqual(dirs.sort());
  });

  it('按目录名整理 import.meta.glob 的结果，不合格的目录名忽略', () => {
    const load = () => Promise.resolve({});
    const map = modulesFromGlob({
      '../../../../../packages/optional/code-editor/src/index.ts': load,
      '/x/packages/optional/mcp/src/index.ts': load,
      '/x/packages/optional/Bad_Name/src/index.ts': load,
      '/x/packages/optional/mcp/src/other.ts': load,
    });
    expect(Object.keys(map).sort()).toEqual(['code-editor', 'mcp']);
  });

  it('开关关着：不加载代码块；打开：加载并能注册面板、命令和文案；关掉：全部注销', async () => {
    const load = vi.fn(() => import('../fixtures/fake-module/src/index') as Promise<ModuleExports>);
    const manager = new OptionalModuleManager({ fake: load }, testHost);
    expect(manager.available).toEqual(['fake']);

    await manager.sync({});
    await manager.sync({ fake: false, other: true });
    expect(load).not.toHaveBeenCalled();
    expect(manager.activeIds).toEqual([]);
    expect(getCommand('fake.run')).toBeUndefined();

    await manager.sync({ fake: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(manager.activeIds).toEqual(['fake']);
    const { calls } = await import('../fixtures/fake-module/src/index');
    expect(calls.activated).toBe(1);
    expect(useRegistry.getState().panels['fake.panel']?.region).toBe('dock');
    expect(i18next.t('fake.title', { lng: 'zh-CN' })).toBe('假模块');
    expect(i18next.t('fake.title', { lng: 'en' })).toBe('Fake module');
    // 模块的命令和核心命令走同一个 dispatch
    expect(await dispatch('fake.run', { n: 1 })).toEqual({ echoed: { n: 1 }, blocks: true });
    // 再同步一次同样的开关不会重复加载
    await manager.sync({ fake: true });
    expect(load).toHaveBeenCalledTimes(1);

    await manager.sync({ fake: false });
    expect(calls.disposed).toBe(1);
    expect(manager.activeIds).toEqual([]);
    expect(getCommand('fake.run')).toBeUndefined();
    expect(useRegistry.getState().panels['fake.panel']).toBeUndefined();
    expect(i18next.exists('fake.title', { lng: 'zh-CN' })).toBe(false);
  });

  it('模块只能注册以自己的 id 开头的面板、命令和文案键', async () => {
    const ui = createHostUi('fake');
    expect(() => ui.registerCommand({ id: 'undo', titleKey: 'fake.x', effect: 'read', run: () => undefined })).toThrow(/must start with/);
    expect(() => ui.registerPanel({ id: 'fake.p', titleKey: 'gallery.title', location: 'left', mount: () => ({ dispose: () => undefined }) })).toThrow(/must start with/);
    expect(() => ui.registerMessages('en', { 'menu.file': 'Hijacked' })).toThrow(/must start with/);
    ui.disposeAll();
  });

  it('坏掉的模块（没有 activate、activate 抛错）不连累主程序，已注册的东西撤掉', async () => {
    const log = vi.fn();
    const manager = new OptionalModuleManager(
      {
        empty: () => Promise.resolve({}),
        throws: () =>
          Promise.resolve({
            activate(host: EditorHost) {
              host.ui.registerCommand({ id: 'throws.cmd', titleKey: 'throws.cmd', effect: 'read', run: () => undefined });
              throw new Error('boom');
            },
          }),
      },
      testHost,
      log,
    );
    await manager.sync({ empty: true, throws: true });
    expect(manager.activeIds).toEqual([]);
    expect(getCommand('throws.cmd')).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });
});
