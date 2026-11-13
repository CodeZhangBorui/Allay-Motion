import { expect, test } from '@playwright/test';
import { launchApp, makeUserDataDir, readMainLog, removeUserDataDir } from './helpers';

// T-ARC-6：向每个 IPC 方法发畸形参数；请求读取对话框没有授权过的路径。
// 判定：全部被拒绝，主进程不崩溃。

/**
 * 每个 window.allay 方法的畸形参数。新增方法时这里没有对应条目，测试会失败。
 * 绝不在这里放合法参数：files.pickImage 的合法调用会弹出对话框。
 */
const MALFORMED: Record<string, unknown[][]> = {
  'app.info': [[1], [{}], ['x'], [null]],
  'settings.get': [[1], [{ theme: 'light' }], [null]],
  'settings.set': [
    [],
    [null],
    ['light'],
    [{ theme: 'purple' }],
    [{ unknownKey: true }],
    [{ language: 'fr' }],
    [{ layout: { left: { size: -1, collapsed: false } } }],
    [{ layout: { left: { size: 'wide', collapsed: false } } }],
    [{ layout: { center: { size: 100, collapsed: false } } }],
    [{ theme: 'light' }, 'extra'],
    [{ theme: 'light', layout: null }],
    ['x'.repeat(200_000)],
  ],
  'window.setTitleBarColors': [
    [],
    [{ color: 'red', symbolColor: '#FFFFFF' }],
    [{ color: '#000000' }],
    [{ color: '#000000', symbolColor: '#FFFFFF', height: 999 }],
    ['#000000', '#FFFFFF'],
  ],
  'files.pickImage': [[1], [{ defaultPath: 'C:\\Windows' }], ['C:\\']],
  'files.read': [
    [],
    [null],
    [42],
    ['C:\\Windows\\win.ini'],
    ['../../../../Windows/win.ini'],
    ['file:///C:/Windows/win.ini'],
    // 格式合法但从没被授权过的引用
    ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
    [{ path: 'C:\\Windows\\win.ini' }],
  ],
  // 合法的 export.start 会弹保存对话框，这里只有畸形参数
  'export.start': [
    [],
    [null],
    [{ preset: 'prores4444' }],
    [{ preset: 'webm-vp9', width: 1920, height: 1080, fps: 60, totalFrames: 10, cutFrame: null, suggestedName: 'x' }],
    [{ preset: 'prores4444', width: 1001, height: 563, fps: 60, totalFrames: 10, cutFrame: null, suggestedName: 'x' }],
    [{ preset: 'prores4444', width: 1920, height: 1080, fps: 61, totalFrames: 10, cutFrame: null, suggestedName: 'x' }],
    [{ preset: 'prores4444', width: 1920, height: 1080, fps: 60, totalFrames: 0, cutFrame: null, suggestedName: 'x' }],
    [{ preset: 'prores4444', width: 1920, height: 1080, fps: 60, totalFrames: 10, cutFrame: null, suggestedName: 'x', path: 'C:\\Windows\\x.mov' }],
    [{ preset: 'prores4444', width: 8192, height: 1080, fps: 60, totalFrames: 10, cutFrame: null, suggestedName: 'x' }],
  ],
  'export.writeFrame': [
    [],
    ['not-a-uuid', new Uint8Array(4)],
    ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
    ['3f2504e0-4f89-41d3-9a0c-0305e82c3301', [1, 2, 3, 4]],
    ['3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'pixels'],
    // 格式合法但不存在的任务
    ['3f2504e0-4f89-41d3-9a0c-0305e82c3301', new Uint8Array(16)],
  ],
  'export.finish': [[], [42], ['C:\\out.mov'], ['3f2504e0-4f89-41d3-9a0c-0305e82c3301']],
  'export.cancel': [[], [null], ['../x'], ['3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'extra']],
  'export.ffmpegInfo': [[1], ['C:\\ffmpeg.exe'], [{ path: 'x' }]],
};

test('T-ARC-6 每个 IPC 方法都拒绝畸形参数，未授权的路径读不到，主进程不崩溃', async () => {
  const dir = makeUserDataDir();
  const { app, page } = await launchApp(dir);
  try {
    // 列出 window.allay 暴露的所有方法（onXxx 订阅函数单独测）
    const methods = await page.evaluate(() => {
      const out: string[] = [];
      for (const [ns, obj] of Object.entries(window.allay as unknown as Record<string, Record<string, unknown>>)) {
        for (const [name, fn] of Object.entries(obj)) {
          if (typeof fn === 'function' && !/^on[A-Z]/.test(name)) out.push(`${ns}.${name}`);
        }
      }
      return out.sort();
    });
    expect(methods).toEqual(Object.keys(MALFORMED).sort());

    const before = await page.evaluate(() => window.allay.settings.get());

    for (const [method, cases] of Object.entries(MALFORMED)) {
      for (const args of cases) {
        const outcome = await page.evaluate(
          async ({ method, args }) => {
            const [ns, name] = method.split('.') as [string, string];
            const fn = (window.allay as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[ns]![name]!;
            try {
              await fn(...args);
              return 'resolved';
            } catch (e) {
              return `rejected: ${e instanceof Error ? e.message : String(e)}`;
            }
          },
          { method, args },
        );
        expect(outcome, `${method}(${JSON.stringify(args).slice(0, 80)})`).toMatch(/^rejected: .*(invalid arguments|unknown file reference|unknown export job)/);
      }
    }

    // 订阅函数只接受函数
    const badSubscribe = await page.evaluate(() => {
      try {
        (window.allay.settings.onChanged as unknown as (x: unknown) => unknown)('not a function');
        return 'accepted';
      } catch {
        return 'rejected';
      }
    });
    expect(badSubscribe).toBe('rejected');

    // 主进程还活着，设置没有被畸形调用改动
    const info = await page.evaluate(() => window.allay.app.info());
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(await page.evaluate(() => window.allay.settings.get())).toEqual(before);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    const log = readMainLog(dir);
    expect(log).toContain('rejected malformed arguments');
    expect(log).toContain('unknown file reference');
    expect(log).not.toContain('handler failed');
  } finally {
    await app.close();
    removeUserDataDir(dir);
  }
});

test('T-ARC-6 来自主窗口以外的 IPC 调用被拒绝', async () => {
  const dir = makeUserDataDir();
  const { app } = await launchApp(dir);
  try {
    // 在主进程里模拟一个来自别的 webContents 的调用：直接调用已注册的处理函数
    const result = await app.evaluate(async ({ ipcMain }) => {
      type InvokeHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, InvokeHandler> })._invokeHandlers;
      const handler = handlers.get('app:info');
      if (!handler) return 'no handler';
      const fakeFrame = { url: 'https://evil.example/' };
      try {
        await handler({ sender: {}, senderFrame: fakeFrame });
        return 'resolved';
      } catch (e) {
        return `rejected: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
    expect(result).toBe('rejected: untrusted sender');
    expect(readMainLog(dir)).toContain('rejected call from untrusted sender');
  } finally {
    await app.close();
    removeUserDataDir(dir);
  }
});
