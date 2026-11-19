import { expect, test, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir, type Launched } from './helpers';

// 动画编辑器第三轮（docs/animation-editor.md 第 10 节）的交互：暴露为参数、音效轨、多个关键帧、曲线视图。
// 判定看文档本身（animGet 的原文）和预览画面的哈希，不依赖固定的等待时间。窗口不显示、不抢焦点。

let launched: Launched | null = null;
let dir = '';

test.afterEach(async () => {
  await launched?.app.close();
  launched = null;
  removeUserDataDir(dir);
});

const ready = (page: Page) => page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });

async function dispatch(page: Page, id: string, input?: unknown): Promise<unknown> {
  const r = await page.evaluate(({ id, input }) => window.__allayTest!.dispatch(id, input), { id, input });
  if (!r.ok) throw new Error(`${id}: ${r.message}`);
  return r.output;
}

interface DocJson {
  params: { key: string; type: string; default: unknown }[];
  layers: { id: string; block?: unknown; props: Record<string, unknown> }[];
  sounds: { id: string; at: number; sound: string; position?: unknown }[];
}

async function docJson(page: Page): Promise<DocJson> {
  const r = (await dispatch(page, 'animGet')) as { text: string };
  return JSON.parse(r.text) as DocJson;
}

const hash = (page: Page, t: number) => page.evaluate((x) => window.__allayTest!.previewHash(x), t);

async function newAnimation(page: Page): Promise<void> {
  await ready(page);
  await dispatch(page, 'animNew', { name: 'R3' });
  await expect(page.getByTestId('anim-timeline')).toBeVisible();
  // 等界面变形做完（时间轴长高的过渡结束），之后再量位置、拖动
  await expect(page.getByTestId('timeline-slot')).toHaveAttribute('data-phase', 'idle');
  await page.waitForTimeout(150);
  await ready(page);
}

test('T-ANIM-16 暴露为参数：在属性面板里把方块暴露成参数，参数表里出现；转成模板后属性面板里能改，画面跟着变', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.getByTestId('anim-layer').first().click();
  await page.getByTestId('anim-bind-block').click();
  await page.getByTestId('anim-bind-block-expose').click();
  await expect.poll(async () => (await docJson(page)).params.map((p) => `${p.key}:${p.type}`)).toEqual(['block:block']);
  expect((await docJson(page)).layers[0]!.block).toEqual({ $param: 'block' });
  await expect(page.getByTestId('anim-bind-block')).toHaveAttribute('data-bound', 'block');
  // 回到整段动画：参数表里有它
  await page.getByTestId('anim-back-to-doc').click();
  await expect(page.getByTestId('anim-param')).toHaveCount(1);

  // 转成模板：属性面板里有这个参数；改它，画面变
  const ref = (await dispatch(page, 'animConvertToTemplate')) as { id: string; version: string };
  expect(await page.evaluate((r) => window.__allayTest!.selectTemplate(r.id, r.version), ref)).toBe(true);
  await ready(page);
  await expect(page.getByTestId('param-row-block')).toBeVisible();
  const before = await hash(page, 1);
  await page.evaluate(() => window.__allayTest!.setParams({ block: 'minecraft:gold_block' }));
  await ready(page);
  expect(await hash(page, 1)).not.toBe(before);
});

test('T-ANIM-17 音效轨：在播放头处加音效，选中后改音量、打开空间位置；拖动标记改时刻；删除', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.evaluate(() => window.__allayTest!.setTime(0.5));
  await page.getByTestId('anim-sound-add').click();
  await expect(page.getByTestId('anim-sound')).toHaveCount(1);
  await expect.poll(async () => (await docJson(page)).sounds.map((s) => s.at)).toEqual([0.5]);
  // 检查器显示音效
  await expect(page.getByTestId('anim-sound-pick')).toBeVisible();
  await page.getByTestId('anim-sound-positional').click();
  await expect.poll(async () => (await docJson(page)).sounds[0]!.position).toEqual({ x: 0, y: 0, z: -4 });
  // 拖动标记：往右拖，时刻变大（吸附到帧）
  const marker = page.getByTestId('anim-sound');
  const box = (await marker.boundingBox())!;
  const ruler = (await page.getByTestId('anim-ruler').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + ruler.width * 0.25, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await docJson(page)).sounds[0]!.at).toBeGreaterThan(0.9);
  // 一次拖动一步撤销
  await dispatch(page, 'undo');
  await expect.poll(async () => (await docJson(page)).sounds[0]!.at).toBe(0.5);
  await page.getByTestId('anim-sound-remove').click();
  await expect(page.getByTestId('anim-sound')).toHaveCount(0);
});

test('T-ANIM-18 多个关键帧：框选、整体拖动、复制粘贴、删除', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.getByTestId('anim-track-expand').first().click();
  const keys = page.getByTestId('anim-key');
  // 新动画里方块有 y、rotY、opacity 三条轨道，共 6 个关键帧
  await expect(keys).toHaveCount(6);
  // 框选全部属性行
  const tracks = (await page.getByTestId('anim-prop-track').first().boundingBox())!;
  const last = (await page.getByTestId('anim-prop-track').last().boundingBox())!;
  // 从名字那一列开始拖，盖住 t = 0 的关键帧
  await page.mouse.move(tracks.x + 120, tracks.y + 2);
  await page.mouse.down();
  // 末尾的关键帧（t = 时长）正好在轨道的右边缘：框碰到它就算选中，不用拖出轨道
  await page.mouse.move(last.x + last.width - 4, last.y + last.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('anim-selection-count')).toBeVisible();
  const count = Number((await page.getByTestId('anim-selection-count').textContent())!.match(/\d+/)![0]);
  expect(count).toBe(6);

  // 只选 y 的两个，整体往右拖一点（第二个落在 0.6 之后）
  const yKeys = page.locator('[data-testid="anim-key"][data-key-prop="y"]');
  await yKeys.first().click();
  await yKeys.last().click({ modifiers: ['Shift'] });
  const before = (await docJson(page)).layers[0]!.props.y as { keys: { t: number }[] };
  const k = (await yKeys.first().boundingBox())!;
  const ruler = (await page.getByTestId('anim-ruler').boundingBox())!;
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2);
  await page.mouse.down();
  await page.mouse.move(k.x + k.width / 2 + ruler.width * 0.1, k.y + k.height / 2, { steps: 6, });
  await page.mouse.up({});
  const after = (await docJson(page)).layers[0]!.props.y as { keys: { t: number }[] };
  const shift0 = after.keys[0]!.t - before.keys[0]!.t;
  const shift1 = after.keys[1]!.t - before.keys[1]!.t;
  expect(shift0).toBeGreaterThan(0.05);
  expect(Math.abs(shift0 - shift1)).toBeLessThan(1e-6);

  // 复制、到播放头粘贴（同一条属性上多出两个）
  await page.keyboard.press('Control+c');
  await page.evaluate(() => window.__allayTest!.setTime(1.2));
  await page.keyboard.press('Control+v');
  await expect.poll(async () => ((await docJson(page)).layers[0]!.props.y as { keys: unknown[] }).keys.length).toBe(4);
  // 删除选中（粘出来的两个）
  await page.keyboard.press('Delete');
  await expect.poll(async () => ((await docJson(page)).layers[0]!.props.y as { keys: unknown[] }).keys.length).toBe(2);
});

test('T-ANIM-19 曲线视图：显示有关键帧的属性的曲线；选中关键帧出现贝塞尔手柄，拖手柄把这一段的缓动改成贝塞尔', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.getByTestId('anim-layer').first().click();
  await page.getByTestId('anim-view-graph').click();
  await expect(page.getByTestId('anim-graph')).toBeVisible();
  await expect(page.getByTestId('anim-graph-curve')).toHaveCount(3);
  await expect(page.getByTestId('anim-graph-path')).toHaveCount(3);
  // 只看 rotY（cubicOut，有对应的贝塞尔）
  await page.locator('[data-curve="block-1.y"]').click();
  await page.locator('[data-curve="block-1.opacity"]').click();
  await expect(page.getByTestId('anim-graph-path')).toHaveCount(1);
  await page.locator('[data-testid="anim-graph-key"][data-key-prop="rotY"]').first().click();
  const handle = page.locator('[data-testid="anim-graph-handle"][data-handle="out"]');
  await expect(handle).toHaveCount(1);
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  const rotY = (await docJson(page)).layers[0]!.props.rotY as { keys: { ease?: unknown }[] };
  expect(Array.isArray(rotY.keys[0]!.ease)).toBe(true);
  // 速度曲线只看
  await page.getByTestId('anim-graph-speed').click();
  await expect(page.getByTestId('anim-graph')).toHaveAttribute('data-mode', 'speed');
  await expect(page.locator('[data-testid="anim-graph-handle"]')).toHaveCount(0);
});

test('T-ANIM-20 曲线视图的“各自的纵轴”：量程差很大的属性（y 几百、不透明度 0–1）叠在一起时，小量程的那条不再被压平', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.getByTestId('anim-layer').first().click();
  await page.getByTestId('anim-view-graph').click();
  // 只看 y 和不透明度
  await page.locator('[data-curve="block-1.rotY"]').click();
  await expect(page.getByTestId('anim-graph-path')).toHaveCount(2);
  const opacityHeight = async () => {
    const paths = page.getByTestId('anim-graph-path');
    const boxes = await Promise.all([0, 1].map(async (i) => (await paths.nth(i).boundingBox())!.height));
    return Math.min(...boxes);
  };
  const flat = await opacityHeight();
  // 共用纵轴时 0–1 的不透明度只占描边那么高
  expect(flat).toBeLessThan(10);
  await page.getByTestId('anim-graph-separate').click();
  await expect.poll(opacityHeight).toBeGreaterThan(60);
});
