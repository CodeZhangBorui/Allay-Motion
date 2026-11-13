import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CommandError,
  defineCommand,
  dispatch,
  getCommand,
  registerCommand,
  registerMenuItem,
  registerPanel,
  sortedPanels,
  useRegistry,
} from '../../apps/desktop/src/renderer/app/registry';

// 界面注册表（docs/code-editing-and-mcp-plan.md H1、H2；docs/decisions.md 界面重设计）：
// 可选模块只经它接入；注销后主界面不留痕迹；命令一律经 dispatch 执行，带参数的先过 zod 校验。

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

const Empty = () => null;

describe('界面注册表', () => {
  it('注册、注销命令；同一个 id 不能注册两次', () => {
    disposers.push(registerCommand({ id: 't.a', titleKey: 'x', effect: 'read', run: () => undefined }));
    expect(getCommand('t.a')?.titleKey).toBe('x');
    expect(() => registerCommand({ id: 't.a', titleKey: 'y', effect: 'read', run: () => undefined })).toThrow(/already registered/);
    disposers.pop()!();
    expect(getCommand('t.a')).toBeUndefined();
  });

  it('dispatch：带参数的命令先过 zod 校验，返回值也校验', async () => {
    let got: unknown = null;
    disposers.push(
      registerCommand(
        defineCommand({
          id: 't.sum',
          titleKey: 'x',
          effect: 'read',
          input: z.strictObject({ a: z.number(), b: z.number() }),
          output: z.number(),
          run: ({ a, b }) => {
            got = { a, b };
            return a + b;
          },
        }),
      ),
    );
    await expect(dispatch('t.sum', { a: 1, b: 2 })).resolves.toBe(3);
    expect(got).toEqual({ a: 1, b: 2 });
    await expect(dispatch('t.sum', { a: 1 })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(dispatch('t.sum', { a: 1, b: 2, c: 3 })).rejects.toBeInstanceOf(CommandError);
  });

  it('dispatch：不认识的命令、当前不可用的命令、返回值不合 schema 都报错', async () => {
    disposers.push(registerCommand({ id: 't.off', titleKey: 'x', effect: 'write', enabled: () => false, run: () => undefined }));
    disposers.push(registerCommand(defineCommand({ id: 't.bad', titleKey: 'x', effect: 'read', output: z.string(), run: () => 42 as unknown as string })));
    await expect(dispatch('t.nope')).rejects.toMatchObject({ code: 'unknown-command' });
    await expect(dispatch('t.off')).rejects.toMatchObject({ code: 'disabled' });
    await expect(dispatch('t.bad')).rejects.toMatchObject({ code: 'invalid-output' });
  });

  it('面板按区域和先后排；注销后不再出现', () => {
    const before = useRegistry.getState().panels;
    disposers.push(registerPanel({ id: 't.b', titleKey: 'b', region: 'right', order: 20, component: Empty }));
    disposers.push(registerPanel({ id: 't.a', titleKey: 'a', region: 'right', order: 5, component: Empty }));
    disposers.push(registerPanel({ id: 't.d', titleKey: 'd', region: 'dock', order: 0, component: Empty }));
    const right = sortedPanels(useRegistry.getState().panels, 'right').map((p) => p.id);
    expect(right.indexOf('t.a')).toBeLessThan(right.indexOf('t.b'));
    expect(sortedPanels(useRegistry.getState().panels, 'dock').map((p) => p.id)).toContain('t.d');
    while (disposers.length) disposers.pop()!();
    expect(useRegistry.getState().panels).toEqual(before);
  });

  it('菜单项注册后可注销', () => {
    disposers.push(registerMenuItem({ id: 't.m', menu: 'view', group: 9, order: 0, command: 't.a' }));
    expect(useRegistry.getState().menuItems['t.m']?.menu).toBe('view');
    disposers.pop()!();
    expect(useRegistry.getState().menuItems['t.m']).toBeUndefined();
  });
});
