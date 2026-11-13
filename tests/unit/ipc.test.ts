import { describe, expect, it } from 'vitest';
import { IPC_ARGS } from '../../apps/desktop/src/shared/ipc-contract';
import { INVOKE_CHANNELS } from '../../apps/desktop/src/shared/ipc-channels';
import { checkSender } from '../../apps/desktop/src/main/ipc-guard';

describe('IPC 入参 schema', () => {
  it('每个 invoke 通道都有 schema', () => {
    expect(Object.keys(IPC_ARGS).sort()).toEqual([...INVOKE_CHANNELS].sort());
  });
  it('多一个参数也拒绝', () => {
    expect(IPC_ARGS['app:info'].safeParse([]).success).toBe(true);
    expect(IPC_ARGS['app:info'].safeParse([1]).success).toBe(false);
  });
  it('settings.set 只接受已知字段', () => {
    const s = IPC_ARGS['settings:set'];
    expect(s.safeParse([{ theme: 'light' }]).success).toBe(true);
    expect(s.safeParse([{ layout: { left: { size: 300, collapsed: true } } }]).success).toBe(true);
    expect(s.safeParse([{ theme: 'light', extra: 1 }]).success).toBe(false);
    expect(s.safeParse([{ layout: { left: { size: 300 } } }]).success).toBe(false);
    expect(s.safeParse([{ layout: { left: { size: Number.NaN, collapsed: false } } }]).success).toBe(false);
  });
  it('files.read 只接受 UUID 引用，不接受路径', () => {
    const s = IPC_ARGS['files:read'];
    expect(s.safeParse(['3f2504e0-4f89-41d3-9a0c-0305e82c3301']).success).toBe(true);
    expect(s.safeParse(['C:\\Windows\\win.ini']).success).toBe(false);
    expect(s.safeParse(['../x']).success).toBe(false);
  });
  it('标题栏颜色只接受 #RRGGBB', () => {
    const s = IPC_ARGS['window:setTitleBarColors'];
    expect(s.safeParse([{ color: '#14171D', symbolColor: '#F2F4F6' }]).success).toBe(true);
    expect(s.safeParse([{ color: 'red', symbolColor: '#F2F4F6' }]).success).toBe(false);
    expect(s.safeParse([{ color: '#14171D', symbolColor: '#F2F4F6', height: 10 }]).success).toBe(false);
  });
});

describe('1.6 第 5 条 只接受主窗口主框架的调用', () => {
  const mainFrame = { url: 'app://renderer/index.html' };
  const webContents = {};
  const main = { webContents, mainFrame };
  it('主窗口主框架：通过', () => {
    expect(checkSender({ sender: webContents, senderFrame: mainFrame }, main, null)).toEqual({ ok: true });
  });
  it('别的 webContents：拒绝', () => {
    expect(checkSender({ sender: {}, senderFrame: mainFrame }, main, null).ok).toBe(false);
  });
  it('子框架：拒绝', () => {
    expect(checkSender({ sender: webContents, senderFrame: { url: 'app://renderer/sub.html' } }, main, null).ok).toBe(false);
  });
  it('框架已销毁：拒绝', () => {
    expect(checkSender({ sender: webContents, senderFrame: null }, main, null).ok).toBe(false);
  });
  it('主框架跳到了别处：拒绝', () => {
    const frame = { url: 'https://evil.example/' };
    expect(checkSender({ sender: webContents, senderFrame: frame }, { webContents, mainFrame: frame }, null).ok).toBe(false);
  });
  it('没有主窗口：拒绝', () => {
    expect(checkSender({ sender: webContents, senderFrame: mainFrame }, null, null).ok).toBe(false);
  });
});
