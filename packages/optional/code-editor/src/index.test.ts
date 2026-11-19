// T-DEV-5：内嵌代码编辑器模块（docs/decisions.md“2026-11 反馈”）。只测不需要 DOM 的部分：
// 文案两种语言一致、键都带模块前缀；ctx 的补全与悬停按接口说明找成员；诊断换成编辑器的格式；
// activate 只经宿主接口注册文案、代码视图和两个命令，dispose 全部撤掉。
// 真实界面里的编辑、保存、热重载在 tests/e2e/anim.spec.ts（T-DEV-6）。
import type { CodeViewProvider, CommandContribution, Disposable, EditorHost, SdkApiDoc } from '@allay/host-api';
import { describe, expect, it } from 'vitest';
import { activate } from './index';
import { MESSAGES } from './messages';
import { membersOf, resolveChain } from './sdk-assist';
import { toViewDiagnostics } from './template-panel';

const API: SdkApiDoc = {
  formatVersion: 1,
  source: 'test',
  ctx: [
    { name: 'stage', kind: 'property', optional: false, signature: 'stage: Readonly<StageInfo>;', doc: 'design units' },
    {
      name: 'resources',
      kind: 'property',
      optional: false,
      signature: 'resources: { … };',
      doc: '',
      members: [{ name: 'block', kind: 'method', optional: false, signature: 'block(id: string): Promise<BlockHandle>;', doc: 'a block' }],
    },
  ],
  types: {},
  aliases: {},
  easings: ['linear', 'cubicOut'],
};

describe('T-DEV-5 代码编辑器模块', () => {
  it('文案：两种语言的键一致，都以 code-editor. 开头', () => {
    expect(Object.keys(MESSAGES['zh-CN']).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const k of Object.keys(MESSAGES.en)) expect(k.startsWith('code-editor.')).toBe(true);
  });

  it('ctx 的成员链：补全列出成员，悬停找到签名；ctx.ease 列出缓动名', () => {
    expect(membersOf(API, []).map((m) => m.label)).toEqual(['stage', 'resources']);
    expect(membersOf(API, ['resources']).map((m) => m.label)).toEqual(['block']);
    expect(membersOf(API, ['ease']).map((m) => m.label)).toEqual(['linear', 'cubicOut', 'bezier', 'from']);
    expect(resolveChain(API, ['resources', 'block'])?.signature).toMatch(/^block\(id: string\)/);
    expect(resolveChain(API, ['nope'])).toBeNull();
  });

  it('诊断带上种类和错误码，行列原样保留', () => {
    expect(toViewDiagnostics([{ kind: 'rule', severity: 'warning', code: 'math-random', message: 'x', line: 3, column: 5 }])).toEqual([{ severity: 'warning', message: 'rule · math-random: x', line: 3, column: 5 }]);
  });

  it('activate 只经宿主接口注册；dispose 全部撤掉', () => {
    const live = new Set<string>();
    const reg = (name: string): Disposable => {
      live.add(name);
      return { dispose: () => live.delete(name) };
    };
    const commands: CommandContribution[] = [];
    let provider: CodeViewProvider | null = null;
    const none = { dispose: () => undefined };
    const host: EditorHost = {
      templates: { read: () => Promise.reject(new Error('n/a')), write: () => Promise.reject(new Error('n/a')), current: () => null, onCurrentChange: () => none, onExternalChange: () => none },
      engine: { onDiagnostics: () => none, requestReload: () => Promise.resolve({ ok: false, diagnostics: [] }), lint: () => Promise.resolve([]) },
      commands: { dispatch: () => Promise.resolve(undefined) },
      playhead: { get: () => 0, subscribe: () => none },
      domain: { blockIds: () => [], easings: () => [], sdkApi: () => API },
      ui: {
        registerPanel: (p) => reg(`panel:${p.id}`),
        registerCommand: (c) => (commands.push(c), reg(`command:${c.id}`)),
        registerMessages: (l) => reg(`messages:${l}`),
        registerCodeView: (p) => ((provider = p), reg('codeView')),
        t: (k) => k,
        onLocaleChange: () => none,
      },
    };
    const handle = activate(host);
    expect([...live].sort()).toEqual(['codeView', 'command:code-editor.close', 'command:code-editor.open', 'messages:en', 'messages:zh-CN']);
    expect(provider).not.toBeNull();
    // 打开命令挂上停靠面板，关闭命令撤掉
    void commands.find((c) => c.id === 'code-editor.open')!.run(undefined);
    expect(live.has('panel:code-editor.panel')).toBe(true);
    void commands.find((c) => c.id === 'code-editor.close')!.run(undefined);
    expect(live.has('panel:code-editor.panel')).toBe(false);
    void commands.find((c) => c.id === 'code-editor.open')!.run(undefined);
    handle.dispose();
    expect([...live]).toEqual([]);
  });
});
