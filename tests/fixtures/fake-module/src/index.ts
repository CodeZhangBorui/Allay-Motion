// T-DEV-4 的假可选模块：只存在于测试夹具里，不在 packages/optional 下，不进安装包。
// 形状和将来真正的可选模块一样：只引用 @allay/host-api 的类型，入口导出 activate(host)。
// 它注册一个面板、一个命令和两种语言的文案，并订阅播放头和诊断；停用时全部注销。
// 真正的模块写 '@allay/host-api'；夹具在根目录的 tsconfig 里，按相对路径引用同一份类型
import type { Disposable, EditorHost } from '../../../../packages/host-api/src/index';

export const calls = { activated: 0, disposed: 0, commandRuns: [] as unknown[] };

export function activate(host: EditorHost): Disposable {
  calls.activated += 1;
  host.ui.registerMessages('zh-CN', { 'fake.title': '假模块', 'fake.run': '假命令' });
  host.ui.registerMessages('en', { 'fake.title': 'Fake module', 'fake.run': 'Fake command' });
  const panel = host.ui.registerPanel({
    id: 'fake.panel',
    titleKey: 'fake.title',
    location: 'bottom',
    mount: () => ({ dispose: () => undefined }),
  });
  const command = host.ui.registerCommand({
    id: 'fake.run',
    titleKey: 'fake.run',
    effect: 'read',
    run: (input) => {
      calls.commandRuns.push(input);
      return { echoed: input, blocks: host.domain.blockIds().length > 0 };
    },
  });
  const playhead = host.playhead.subscribe(() => undefined);
  return {
    dispose() {
      calls.disposed += 1;
      playhead.dispose();
      command.dispose();
      panel.dispose();
    },
  };
}
