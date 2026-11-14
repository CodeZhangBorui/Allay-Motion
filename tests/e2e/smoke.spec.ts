import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir, type Launched } from './helpers';

// 界面冒烟（docs/decisions.md “试用版的三个崩溃”）：主界面上每个下拉、每个菜单项（含子菜单）、每个对话框、
// 命令面板里的每条命令，在几种状态下各走一遍，断言没有未捕获的异常、没有控制台 error、界面没有整棵卸载（黑屏）、
// 没有落到错误边界的错误页。三个试用时的崩溃（预设下拉、最近的工程子菜单、派生模板装载失败）都是现有 e2e 没走到的路径。
//
// 状态：内置模板（全新安装：没有任何素材层）、没选模板、用户模板（复制内置模板得到）、派生模板（另存为模板得到）。
// 系统对话框和“在资源管理器里打开”在主进程里换成立即取消的假实现：测试不弹窗、不开资源管理器。窗口不显示、不抢焦点。
//
// 发现问题时不立刻停：记下来、重新载入界面、重建状态、接着走，最后一起报告，一次就能看到全部问题。

const SETTLE_MS = 350;

interface Problem {
  state: string;
  action: string;
  detail: string;
}

/** 把主进程里会弹系统窗口、开资源管理器的接口换成立即返回“取消”的假实现 */
async function stubNativeUi(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog, shell }) => {
    const d = dialog as unknown as Record<string, unknown>;
    d.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    d.showSaveDialog = async () => ({ canceled: true, filePath: '' });
    d.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    const s = shell as unknown as Record<string, unknown>;
    s.openPath = async () => '';
    s.showItemInFolder = () => undefined;
    s.openExternal = async () => undefined;
  });
}

class Watch {
  errors: string[] = [];
  constructor(page: Page) {
    page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') this.errors.push(`console.error: ${m.text().slice(0, 400)}`);
    });
  }
  take(): string[] {
    const e = this.errors;
    this.errors = [];
    return e;
  }
}

/** 界面还在：顶栏在、根节点有内容、没有落到错误边界 */
async function healthOf(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root || root.childElementCount === 0) return 'blank: #root is empty';
    const boundary = document.querySelector('[data-testid="error-boundary"]');
    if (boundary) return `error boundary: ${boundary.getAttribute('data-scope') ?? ''} ${boundary.querySelector('[data-testid="error-boundary-reason"]')?.textContent ?? ''}`;
    if (!document.querySelector('[data-testid="topbar"]')) return 'blank: topbar is gone';
    return null;
  });
}

/** 关掉打开着的弹层、对话框 */
const OVERLAY = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], [data-popup-open], [data-base-ui-inert]';

async function closeOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate((sel) => !!document.querySelector(sel), OVERLAY);
    if (!open) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  // 还关不掉（例如焦点不在弹层里）：点一下状态栏这块不会触发任何操作的空白
  const bar = page.getByTestId('statusbar');
  if (await bar.count()) await bar.click({ position: { x: 2, y: 2 }, force: true }).catch(() => undefined);
}

type Setup = (page: Page) => Promise<void>;

class Runner {
  problems: Problem[] = [];
  actions = 0;
  constructor(
    private readonly page: Page,
    private readonly watch: Watch,
    private readonly state: string,
    private readonly setup: Setup,
  ) {}

  /** 做一个动作，然后看界面还好不好；坏了就记下来、重新载入、重建状态 */
  async step(action: string, run: () => Promise<void>): Promise<void> {
    this.actions++;
    let detail: string[] = [];
    try {
      await run();
      await this.page.waitForTimeout(SETTLE_MS);
    } catch (error) {
      detail.push(`action failed: ${(error as Error).message.split('\n')[0]}`);
    }
    const health = await healthOf(this.page).catch((e: Error) => `page unreachable: ${e.message}`);
    if (health) detail.push(health);
    detail = [...detail, ...this.watch.take()];
    await closeOverlays(this.page).catch(() => undefined);
    if (detail.length === 0) return;
    this.problems.push({ state: this.state, action, detail: detail.join(' | ') });
    if (health) await this.recover();
  }

  async recover(): Promise<void> {
    await this.page.reload();
    await this.page.waitForSelector('[data-testid="topbar"]', { timeout: 30_000 });
    await this.setup(this.page);
    this.watch.take();
  }
}

/** 页面上（或某个范围里）可见的、会弹出东西的控件：菜单、下拉、弹层的触发器 */
function popupTriggers(scope: Locator | Page): Locator {
  return scope.locator('button[aria-haspopup]:visible:not([disabled]), [role="combobox"]:visible:not([aria-disabled="true"])');
}

async function describe(el: Locator): Promise<string> {
  return el.evaluate((n) => (n.getAttribute('data-testid') ?? n.getAttribute('aria-label') ?? n.textContent ?? '').trim().slice(0, 40) || n.tagName.toLowerCase());
}

/** 顶栏菜单：每一项（子菜单里的每一项）各点一次 */
async function walkMenus(page: Page, r: Runner): Promise<void> {
  const triggers = page.locator('[data-testid="topbar"] button[aria-haspopup="menu"]:visible');
  const count = await triggers.count();
  for (let m = 0; m < count; m++) {
    const trigger = () => page.locator('[data-testid="topbar"] button[aria-haspopup="menu"]:visible').nth(m);
    await closeOverlays(page);
    if ((await triggers.count()) <= m) break;
    const name = await describe(trigger());
    if (await trigger().isDisabled()) continue;
    let labels: { text: string; sub: boolean; disabled: boolean }[] = [];
    await r.step(`menu ${name} (open)`, async () => {
      await trigger().click();
      const items = page.locator('[role="menu"]:visible').last().locator('[role^="menuitem"]');
      labels = await items.evaluateAll((ns) => ns.map((n) => ({ text: (n.textContent ?? '').trim().slice(0, 40), sub: n.hasAttribute('aria-haspopup'), disabled: n.getAttribute('aria-disabled') === 'true' || n.hasAttribute('data-disabled') })));
    });
    for (let i = 0; i < labels.length; i++) {
      const item = labels[i]!;
      if (item.disabled) continue;
      const itemAt = () => page.locator('[role="menu"]:visible').first().locator('[role^="menuitem"]').nth(i);
      if (!item.sub) {
        await r.step(`menu ${name} › ${item.text}`, async () => {
          await trigger().click();
          await itemAt().click();
        });
        continue;
      }
      // 子菜单：先只悬停打开（试用时“最近的工程”在这一步就崩了），再逐项点
      let subLabels: { text: string; disabled: boolean }[] = [];
      await r.step(`menu ${name} › ${item.text} (open submenu)`, async () => {
        await trigger().click();
        await itemAt().hover();
        await page.waitForTimeout(250);
        const sub = page.locator('[role="menu"]:visible').nth(1).locator('[role^="menuitem"]');
        subLabels = await sub.evaluateAll((ns) => ns.map((n) => ({ text: (n.textContent ?? '').trim().slice(0, 40), disabled: n.getAttribute('aria-disabled') === 'true' || n.hasAttribute('data-disabled') })));
      });
      for (let j = 0; j < subLabels.length; j++) {
        if (subLabels[j]!.disabled) continue;
        await r.step(`menu ${name} › ${item.text} › ${subLabels[j]!.text}`, async () => {
          await trigger().click();
          await itemAt().hover();
          await page.waitForTimeout(250);
          await page.locator('[role="menu"]:visible').nth(1).locator('[role^="menuitem"]').nth(j).click();
        });
      }
    }
  }
}

/** 主界面上的每个下拉、弹层：打开；是列表的再选一个没选中的选项；是菜单的再悬停每个子菜单 */
async function walkPopups(page: Page, r: Runner, scopeName: string, scope: () => Locator | Page): Promise<void> {
  const total = await popupTriggers(scope()).count();
  for (let i = 0; i < total; i++) {
    const at = () => popupTriggers(scope()).nth(i);
    if ((await popupTriggers(scope()).count()) <= i) break;
    const name = await describe(at());
    // 顶栏菜单由 walkMenus 走
    if (scopeName === 'window' && (await at().evaluate((n) => !!n.closest('[data-testid="topbar"]') && n.getAttribute('aria-haspopup') === 'menu'))) continue;
    await r.step(`${scopeName} popup ${name} (open)`, async () => {
      await at().click();
      await page.waitForTimeout(200);
      const subs = page.locator('[role="menu"]:visible [role^="menuitem"][aria-haspopup]:not([data-disabled]):not([aria-disabled="true"])');
      for (let k = 0; k < (await subs.count()); k++) {
        await subs.nth(k).hover();
        await page.waitForTimeout(250);
      }
    });
    await r.step(`${scopeName} popup ${name} (pick)`, async () => {
      await at().click();
      await page.waitForTimeout(200);
      const option = page.locator('[role="listbox"]:visible [role="option"]:not([aria-selected="true"]):not([aria-disabled="true"])').first();
      if ((await option.count()) > 0) await option.click();
    });
  }
}

/** 对话框：逐个打开，里面的标签页逐个点、里面的下拉逐个打开 */
async function walkDialogs(page: Page, r: Runner): Promise<void> {
  const dialogs: { name: string; open: () => Promise<unknown> }[] = [
    { name: 'export', open: () => page.evaluate(() => window.__allayTest!.dispatch('export')) },
    { name: 'settings', open: () => page.evaluate(() => window.__allayTest!.dispatch('settings')) },
    { name: 'palette', open: () => page.evaluate(() => window.__allayTest!.dispatch('palette')) },
    { name: 'savePreset', open: () => page.getByTestId('params-more').click().then(() => page.getByRole('menuitem').first().click()) },
    { name: 'saveTemplate', open: () => page.getByTestId('save-as-template').click() },
  ];
  for (const d of dialogs) {
    let opened = false;
    await r.step(`dialog ${d.name} (open)`, async () => {
      if (d.name.startsWith('save') && (await page.getByTestId(d.name === 'saveTemplate' ? 'save-as-template' : 'params-more').count()) === 0) return;
      await d.open();
      await page.waitForTimeout(250);
      opened = (await page.locator('[role="dialog"]:visible').count()) > 0;
      if (!opened) return;
      const tabs = page.locator('[role="dialog"]:visible [role="tab"]');
      for (let k = 0; k < (await tabs.count()); k++) {
        await tabs.nth(k).click();
        await page.waitForTimeout(150);
      }
    });
    if (!opened) continue;
    // 对话框里的下拉
    const inDialog = () => page.locator('[role="dialog"]:visible').first();
    await d.open();
    await page.waitForTimeout(250);
    const tabCount = await page.locator('[role="dialog"]:visible [role="tab"]').count();
    for (let k = 0; k < Math.max(1, tabCount); k++) {
      if (tabCount > 0) {
        if ((await page.locator('[role="dialog"]:visible').count()) === 0) {
          await d.open();
          await page.waitForTimeout(250);
        }
        await page.locator('[role="dialog"]:visible [role="tab"]').nth(k).click();
        // 等标签页切换完：否则会数到上一页正在隐藏的控件
        await page.waitForTimeout(300);
      }
      const count = await popupTriggers(inDialog()).count();
      for (let i = 0; i < count; i++) {
        await r.step(`dialog ${d.name} tab ${k} popup ${i}`, async () => {
          if ((await page.locator('[role="dialog"]:visible').count()) === 0) {
            await d.open();
            await page.waitForTimeout(250);
            if (tabCount > 0) await page.locator('[role="dialog"]:visible [role="tab"]').nth(k).click();
            await page.waitForTimeout(300);
          }
          const el = popupTriggers(inDialog()).nth(i);
          if ((await el.count()) === 0 || !(await el.isVisible())) return;
          await el.click();
          await page.waitForTimeout(200);
          // 只关掉弹出的列表，不关对话框
          await page.keyboard.press('Escape');
        });
      }
    }
    await closeOverlays(page);
  }
}

/** 命令面板里的每条命令各执行一次 */
async function walkPalette(page: Page, r: Runner): Promise<void> {
  await page.evaluate(() => window.__allayTest!.dispatch('palette'));
  await page.getByTestId('command-palette').waitFor();
  const ids = await page.locator('[data-testid^="command-"]:not([data-testid="command-palette"])').evaluateAll((ns) =>
    ns.filter((n) => n.getAttribute('aria-disabled') !== 'true' && !n.hasAttribute('data-disabled')).map((n) => n.getAttribute('data-testid')!),
  );
  await closeOverlays(page);
  for (const id of ids) {
    await r.step(`palette ${id}`, async () => {
      await page.evaluate(() => window.__allayTest!.dispatch('palette'));
      await page.getByTestId('command-palette').waitFor();
      const item = page.getByTestId(id);
      if ((await item.count()) === 0) return;
      await item.click();
      await page.waitForTimeout(200);
      // 新建工程有未保存改动时会问一句：确认，走完整条路
      const ok = page.getByTestId('confirm-ok');
      if (await ok.isVisible().catch(() => false)) await ok.click();
    });
  }
}

const waitPreview = (page: Page) => page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });

/** 等预览装好；装载失败（错误卡片）算问题 */
async function expectPreviewReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__allayTest!.status();
    return s.kind === 'ready' || s.kind === 'error' || s.kind === 'crashed';
  }, undefined, { timeout: 30_000 });
  const status = await page.evaluate(() => window.__allayTest!.status());
  expect(status, 'preview should load').toMatchObject({ kind: 'ready' });
}

async function selectUserCopy(page: Page): Promise<void> {
  const list = await page.evaluate(() => window.__allayTest!.templates());
  let user = list.find((e) => e.source === 'user' && e.kind === 'script');
  if (!user) {
    const r = await page.evaluate(() => window.__allayTest!.copyBuiltinTemplate({ id: 'allay.builtin.block-wipe', version: '1.0.0', name: 'smoke copy' }));
    if (!r.ok) throw new Error(`copyBuiltin failed: ${r.error}`);
    user = r.entry;
  }
  await page.evaluate(([id, v]) => window.__allayTest!.selectTemplate(id!, v!), [user.id, user.version]);
  await expectPreviewReady(page);
}

async function selectDerived(page: Page): Promise<void> {
  const list = await page.evaluate(() => window.__allayTest!.templates());
  let derived = list.find((e) => e.kind === 'derived');
  if (!derived) {
    const r = await page.evaluate(() =>
      window.allay.templates.saveDerived({ base: { id: 'allay.builtin.block-wipe', version: '1.0.0' }, name: '234', defaults: { cols: 12 }, hidden: ['breakSound'] }),
    );
    if (!r.ok) throw new Error(`saveDerived failed: ${r.error}`);
    derived = r.entry;
  }
  await page.evaluate(([id, v]) => window.__allayTest!.selectTemplate(id!, v!), [derived.id, derived.version]);
  await expectPreviewReady(page);
}

const STATES: { name: string; setup: Setup }[] = [
  { name: 'builtin template, no resource layers', setup: async (page) => void (await page.evaluate(() => window.__allayTest!.loadBuiltin()), await waitPreview(page)) },
  { name: 'no template selected', setup: async (page) => void (await waitPreview(page), await page.evaluate(() => window.__allayTest!.clearTemplate())) },
  { name: 'user template', setup: selectUserCopy },
  { name: 'derived template', setup: selectDerived },
];

let launched: Launched | null = null;
let dir = '';

test.afterEach(async () => {
  await launched?.app.close();
  launched = null;
  if (dir) removeUserDataDir(dir);
  dir = '';
});

for (const state of STATES) {
  test(`界面冒烟：${state.name}`, async () => {
    test.setTimeout(12 * 60_000);
    dir = makeUserDataDir();
    launched = await launchApp(dir);
    const { app, page } = launched;
    // 单步的点击、悬停：界面上的东西几百毫秒内就该出来；等不到就记成问题，不在一步上耗 30 秒
    page.setDefaultTimeout(8000);
    await stubNativeUi(app);
    const watch = new Watch(page);
    await waitPreview(page);
    // 全新安装：没有任何素材层（没有原版、没有资源包；内置层是空的）
    const layers = await page.evaluate(() => window.__allayTest!.resourceState()?.layers.filter((l) => l.enabled && !(l.kind === 'builtin' && l.empty)).length ?? 0);
    expect(layers).toBe(0);
    await state.setup(page);
    watch.take();
    const r = new Runner(page, watch, state.name, state.setup);

    await walkPopups(page, r, 'window', () => page);
    await r.recover();
    await walkDialogs(page, r);
    await r.recover();
    await walkMenus(page, r);
    await r.recover();
    await walkPalette(page, r);

    console.log(`[smoke] ${state.name}: ${r.actions} actions, ${r.problems.length} problems`);
    for (const p of r.problems) console.log(`[smoke]   ${p.action}: ${p.detail}`);
    expect(r.actions).toBeGreaterThan(20);
    expect(r.problems).toEqual([]);
  });
}
