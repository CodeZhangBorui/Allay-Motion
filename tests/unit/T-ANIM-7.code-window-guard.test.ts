// T-ANIM-7：代码窗口的 IPC 来源校验（docs/animation-editor.md 6.11；docs/01-product-architecture.md 1.6 第 5 条）——
// 只认应用登记的那个 webContents（不按 URL 放行），只放行 codeWindow:send 一个通道，主窗口不能冒充；消息按 schema 校验。
import { describe, expect, it } from 'vitest';
import { CODE_WINDOW_CHANNELS, checkSenderFor } from '../../apps/desktop/src/main/ipc-guard';
import { CodeWindowUpSchema } from '../../apps/desktop/src/shared/code-window';

describe('T-ANIM-7 代码窗口的来源校验', () => {
  const frame = (url: string) => ({ url });
  const mainWc = { id: 1 };
  const codeWc = { id: 7 };
  const main = { webContents: mainWc, mainFrame: frame('app://renderer/index.html') };
  const code = { webContents: codeWc, mainFrame: frame('app://renderer/code.html'), id: 7 };
  const fromMain = { sender: mainWc, senderFrame: main.mainFrame };
  const fromCode = { sender: codeWc, senderFrame: code.mainFrame };

  it('登记过的代码窗口只能调 codeWindow:send 这一个通道', () => {
    expect([...CODE_WINDOW_CHANNELS]).toEqual(['codeWindow:send']);
    expect(checkSenderFor('codeWindow:send', fromCode, main, code, null).ok).toBe(true);
    for (const ch of ['app:info', 'settings:set', 'templates:writeSource', 'codeWindow:publish', 'project:save', 'files:read']) expect(checkSenderFor(ch, fromCode, main, code, null).ok).toBe(false);
  });

  it('主窗口照旧能调其余通道，但不能冒充代码窗口发 codeWindow:send', () => {
    expect(checkSenderFor('settings:set', fromMain, main, code, null).ok).toBe(true);
    expect(checkSenderFor('codeWindow:publish', fromMain, main, code, null).ok).toBe(true);
    expect(checkSenderFor('codeWindow:send', fromMain, main, code, null).ok).toBe(false);
  });

  it('不按 URL 放行：别的窗口加载了同一个页面、id 对不上、没有登记（已关闭）都拒绝', () => {
    const other = { id: 9 };
    expect(checkSenderFor('codeWindow:send', { sender: other, senderFrame: frame('app://renderer/code.html') }, main, code, null).ok).toBe(false);
    // 同一个对象但登记的 id 不同（例如窗口换过）
    expect(checkSenderFor('codeWindow:send', fromCode, main, { ...code, id: 8 }, null).ok).toBe(false);
    expect(checkSenderFor('codeWindow:send', fromCode, main, null, null).ok).toBe(false);
  });

  it('代码窗口的子框架、别的页面（哪怕同一个 origin）都拒绝', () => {
    expect(checkSenderFor('codeWindow:send', { sender: codeWc, senderFrame: frame('app://renderer/code.html') }, main, code, null).ok).toBe(false);
    const elsewhere = { ...code, mainFrame: frame('app://renderer/index.html') };
    expect(checkSenderFor('codeWindow:send', { sender: codeWc, senderFrame: elsewhere.mainFrame }, main, elsewhere, null).ok).toBe(false);
    const evil = { ...code, mainFrame: frame('https://evil.example/code.html') };
    expect(checkSenderFor('codeWindow:send', { sender: codeWc, senderFrame: evil.mainFrame }, main, evil, null).ok).toBe(false);
  });

  it('代码窗口发来的消息按 schema 校验', () => {
    expect(CodeWindowUpSchema.safeParse({ type: 'edit', text: '{}', baseRevision: 1 }).success).toBe(true);
    expect(CodeWindowUpSchema.safeParse({ type: 'edit', text: 1 }).success).toBe(false);
    expect(CodeWindowUpSchema.safeParse({ type: 'eval', code: 'x' }).success).toBe(false);
    expect(CodeWindowUpSchema.safeParse({ type: 'seek', t: 99 }).success).toBe(false);
  });
});
