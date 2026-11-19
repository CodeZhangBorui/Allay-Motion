import { expect, test, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir, type Launched } from './helpers';

// 2026-11 反馈：时间线与曲线编辑（docs/decisions.md 同名一节）。默认模板 block-wipe：进入 inDuration、停留 hold、退出 outDuration。
// T-UXF-1/2 退出段（最后一段）的段尾能拖、能用键盘改；T-UXF-3 自定义缓动编辑器的聚焦；T-UXF-8/9/10 时间轴右键菜单。

const FPS = 60;

async function waitReady(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__allayTest!.status().kind), { timeout: 15_000 }).toBe('ready');
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
}

const params = (page: Page) => page.evaluate(() => window.__allayTest!.project().params);
const history = (page: Page) => page.evaluate(() => window.__allayTest!.history());

async function centerX(page: Page, testId: string): Promise<number> {
  const b = (await page.getByTestId(testId).boundingBox())!;
  return b.x + b.width / 2;
}

test.describe('T-UXF 时间线与曲线编辑', () => {
  let dir: string;
  let launched: Launched;
  test.beforeAll(async () => {
    dir = makeUserDataDir();
    launched = await launchApp(dir);
  });
  test.afterAll(async () => {
    await launched.app.close();
    removeUserDataDir(dir);
  });

  test('T-UXF-1 退出段的段尾能拖：按帧吸附、段尾跟手、总时长随之变、只记一步撤销', async () => {
    const { page } = launched;
    await waitReady(page);
    await page.evaluate(() => window.__allayTest!.setParams({ inDuration: 0.5, hold: 0.1, outDuration: 0.5 }));
    await waitReady(page);
    const before = await history(page);
    const tr = await page.evaluate(() => window.__allayTest!.transport());
    const lanes = (await page.getByTestId('transport-track').boundingBox())!;
    const secPerPx = tr.duration / lanes.width;
    const pxPerFrame = lanes.width / (tr.duration * FPS);
    const edge = page.getByTestId('timeline-boundary-2');
    await expect(edge).toBeVisible();
    const box = (await edge.boundingBox())!;
    const x0 = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // 往左拖（缩短）：段尾停在指针下
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(x0 - i * 3, y);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(80);
    const edgeX = await centerX(page, 'timeline-boundary-2');
    await page.mouse.up();
    await waitReady(page);
    const expected = Math.round((0.5 - 60 * secPerPx) * FPS) / FPS;
    expect((await params(page)).outDuration as number).toBeCloseTo(expected, 6);
    expect(Math.abs(edgeX - (x0 - 60))).toBeLessThanOrEqual(pxPerFrame / 2 + 1);
    await expect.poll(() => page.evaluate(() => window.__allayTest!.transport().duration)).toBeCloseTo(0.6 + expected, 6);
    expect((await history(page)).past).toBe(before.past + 1);

    // 往右拖（拉长，越过轨道右端也按按下时的比例尺算）
    const box2 = (await edge.boundingBox())!;
    const x1 = box2.x + box2.width / 2;
    const from = (await params(page)).outDuration as number;
    await page.mouse.move(x1, y);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(x1 + i * 4, y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await waitReady(page);
    const secPerPx2 = (from + 0.6) / lanes.width;
    expect((await params(page)).outDuration as number).toBeCloseTo(Math.min(2, Math.round((from + 120 * secPerPx2) * FPS) / FPS), 6);
    expect((await history(page)).past).toBe(before.past + 2);
  });

  test('T-UXF-2 退出段的段尾（键盘）：方向键逐帧改，受 min 限制', async () => {
    const { page } = launched;
    await waitReady(page);
    await page.evaluate(() => window.__allayTest!.setParams({ outDuration: 0.5 }));
    await waitReady(page);
    const edge = page.getByTestId('timeline-boundary-2');
    await edge.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await params(page)).outDuration as number).toBeCloseTo(0.5 + 1 / FPS, 6);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await params(page)).outDuration as number).toBeCloseTo(0.15, 6);
  });

  test('T-UXF-3 自定义缓动：悬停时浮起，超出方格的控制点可见可点，其余各行降层；点背景控件时退出且这一下生效；无操作 3 秒退出', async () => {
    const { page } = launched;
    await waitReady(page);
    await page.evaluate(() => window.__allayTest!.setParams({ easing: [0.3, 1.6, 0.6, -0.7] }));
    const layer = page.getByTestId('easing-editor');
    await expect(layer).toBeVisible();
    await layer.scrollIntoViewIfNeeded();
    const svg = (await layer.locator('svg').first().boundingBox())!;
    await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
    await expect(layer).toHaveAttribute('data-focused', 'true');
    await expect(page.getByTestId('param-panel')).toHaveAttribute('data-focus-layer', '');
    // 其余各行降到 35% 不透明度，曲线所在的行不降
    const dimmed = page.locator('[data-testid="param-panel"] [data-dim]:not([data-focus-owner])').first();
    await expect.poll(async () => Number(await dimmed.evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.35, 2);
    // 拉到方格下面的控制点：浮起后是最上层（命中测试落在它自己身上）
    const hit = await page.getByTestId('easing-handle-2').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el;
    });
    expect(hit).toBe(true);
    // 拖它：浮起期间可以接着往下拖，y 不限制在 0–1
    const h = (await page.getByTestId('easing-handle-2').boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 10, { steps: 4 });
    await page.mouse.up();
    const eased = (await params(page)).easing as number[];
    expect(eased[3]!).toBeLessThan(-0.7);
    await expect(layer).toHaveAttribute('data-focused', 'true');

    // 点背景里的控件（分组标题）：退出聚焦，这一下照常生效（分组折叠）
    const group = page.locator('[data-testid^="param-group-"]').first();
    const wasOpen = await group.getAttribute('aria-expanded');
    await group.click();
    await expect(layer).not.toHaveAttribute('data-focused', 'true');
    await expect(group).not.toHaveAttribute('aria-expanded', wasOpen ?? '');
    await group.click();

    // 无操作 3 秒退出
    await layer.scrollIntoViewIfNeeded();
    const svg2 = (await layer.locator('svg').first().boundingBox())!;
    await page.mouse.move(svg2.x + 20, svg2.y + 20);
    await expect(layer).toHaveAttribute('data-focused', 'true');
    await page.waitForTimeout(3300);
    await expect(layer).not.toHaveAttribute('data-focused', 'true');
    await expect(page.getByTestId('param-panel')).not.toHaveAttribute('data-focus-layer', '');
  });

  test('T-UXF-8 阶段轨右键菜单：设置时长、重置、平均分配，各记一步撤销', async () => {
    const { page } = launched;
    await waitReady(page);
    await page.evaluate(() => window.__allayTest!.setParams({ inDuration: 0.5, hold: 0.1, outDuration: 0.7 }));
    await waitReady(page);
    const out = (await page.getByTestId('timeline-segment-outDuration').boundingBox())!;
    const before = await history(page);

    // 设置时长…
    await page.mouse.click(out.x + out.width / 2, out.y + out.height / 2, { button: 'right' });
    await expect(page.getByTestId('timeline-menu')).toBeVisible();
    await page.getByTestId('timeline-menu-set-duration').click();
    await page.getByTestId('segment-duration-input').fill('0.8');
    await page.getByTestId('segment-duration-confirm').click();
    await expect.poll(async () => (await params(page)).outDuration as number).toBeCloseTo(0.8, 6);
    expect((await history(page)).past).toBe(before.past + 1);
    await waitReady(page);

    // 重置这一段
    const out2 = (await page.getByTestId('timeline-segment-outDuration').boundingBox())!;
    await page.mouse.click(out2.x + out2.width / 2, out2.y + out2.height / 2, { button: 'right' });
    await page.getByTestId('timeline-menu-reset-duration').click();
    await expect.poll(async () => (await params(page)).outDuration as number).toBeCloseTo(0.5, 6);
    expect((await history(page)).past).toBe(before.past + 2);
    await waitReady(page);

    // 平均分配：总帧数不变
    const p = await params(page);
    const total = Math.round(((p.inDuration as number) + (p.hold as number) + (p.outDuration as number)) * FPS);
    const inn = (await page.getByTestId('timeline-segment-inDuration').boundingBox())!;
    await page.mouse.click(inn.x + inn.width / 2, inn.y + inn.height / 2, { button: 'right' });
    await page.getByTestId('timeline-menu-distribute').click();
    await expect
      .poll(async () => {
        const q = await params(page);
        return [q.inDuration, q.hold, q.outDuration].map((d) => Math.round((d as number) * FPS));
      })
      .toEqual([Math.ceil(total / 3), Math.round(total / 3), Math.floor(total / 3)].sort((a, b) => b - a));
    expect((await history(page)).past).toBe(before.past + 3);
  });

  test('T-UXF-9 不同轨道的菜单内容不同；跳到这里吸附到帧', async () => {
    const { page } = launched;
    await waitReady(page);
    const cues = page.getByTestId('timeline-cues');
    const c = (await cues.boundingBox())!;
    await page.mouse.click(c.x + c.width * 0.3, c.y + c.height / 2, { button: 'right' });
    await expect(page.getByTestId('timeline-menu-next-cue')).toBeVisible();
    await expect(page.getByTestId('timeline-menu-set-duration')).toHaveCount(0);
    await page.getByTestId('timeline-menu-seek-here').click();
    const tr = await page.evaluate(() => window.__allayTest!.transport());
    const lanes = (await page.getByTestId('transport-track').boundingBox())!;
    const expected = Math.round(((c.x + c.width * 0.3 - lanes.x) / lanes.width) * tr.duration * FPS) / FPS;
    expect(tr.time).toBeCloseTo(expected, 6);
    expect(Math.round(tr.time * FPS) / FPS).toBeCloseTo(tr.time, 9);

    const st = (await page.getByTestId('timeline-stages').boundingBox())!;
    await page.mouse.click(st.x + st.width * 0.2, st.y + st.height / 2, { button: 'right' });
    await expect(page.getByTestId('timeline-menu-set-duration')).toBeVisible();
    await expect(page.getByTestId('timeline-menu-next-cue')).toHaveCount(0);
    // 快捷键提示：播放/暂停显示空格
    await expect(page.getByTestId('timeline-menu-play-pause').locator('[data-slot="menu-shortcut"]')).not.toBeEmpty();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('timeline-menu')).toHaveCount(0);
  });

  test('T-UXF-10 键盘可达：焦点在退出段的段尾上按 Shift+F10 打开它的菜单，方向键和回车执行', async () => {
    const { page } = launched;
    await waitReady(page);
    await page.evaluate(() => window.__allayTest!.setParams({ outDuration: 0.9 }));
    await waitReady(page);
    await page.getByTestId('timeline-boundary-2').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('timeline-menu')).toBeVisible();
    await expect(page.getByTestId('timeline-menu-reset-duration')).toBeVisible();
    // 用键盘走到“重置这一段的时长”并执行
    const reset = page.getByTestId('timeline-menu-reset-duration');
    for (let i = 0; i < 10; i++) {
      if ((await reset.getAttribute('data-highlighted')) !== null) break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(reset).toHaveAttribute('data-highlighted', '');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await params(page)).outDuration as number).toBeCloseTo(0.5, 6);
  });
});
