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
  layers: { id: string; name: string; type: string; parent?: string; to?: number; block?: unknown; props: Record<string, unknown> }[];
  sounds: { id: string; at: number; sound: string; position?: unknown }[];
}

async function docJson(page: Page): Promise<DocJson> {
  const r = (await dispatch(page, 'animGet')) as { text: string };
  return JSON.parse(r.text) as DocJson;
}

const hash = (page: Page, t: number) => page.evaluate((x) => window.__allayTest!.previewHash(x), t);

/** EnumField：分段控件时直接点那一项，放不下时是下拉 */
async function pickEnum(page: Page, testId: string, name: RegExp): Promise<void> {
  const el = page.getByTestId(testId);
  if ((await el.getByText(name).count()) > 0 && (await el.getAttribute('role')) !== 'combobox') await el.getByText(name).click();
  else {
    await el.click();
    await page.getByRole('option', { name }).click();
  }
}

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

test('T-ANIM-23 图层：多选、成组（子图层缩进）、复制、重命名、隐藏和独显改变画面、锁定后检查器不能改、拖动排序、拖可见区间的一端', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await dispatch(page, 'animAddLayer', { type: 'rect' });
  await expect(page.getByTestId('anim-layer')).toHaveCount(2);
  const rows = page.getByTestId('anim-layer');
  // 多选：点第一个，Ctrl 点第二个，成组
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Control'] });
  await page.getByTestId('anim-layers-group').click();
  await expect(rows).toHaveCount(3);
  await expect(page.locator('[data-testid="anim-layer"][data-depth="1"]')).toHaveCount(2);
  const groupId = (await docJson(page)).layers.find((l) => l.type === 'group')!.id;
  expect((await docJson(page)).layers.filter((l) => l.parent === groupId)).toHaveLength(2);

  // 复制组（Ctrl+D）：连同两个子图层
  await page.locator(`[data-testid="anim-layer"][data-layer="${groupId}"]`).click();
  await page.keyboard.press('Control+d');
  await expect(rows).toHaveCount(6);
  await dispatch(page, 'undo');
  await expect(rows).toHaveCount(3);

  // 重命名：双击名字
  await page.locator(`[data-testid="anim-layer"][data-layer="${groupId}"]`).dblclick();
  await page.getByTestId('anim-layer-rename').fill('Scene');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await docJson(page)).layers.find((l) => l.id === groupId)!.name).toBe('Scene');

  // 隐藏组：画面变（两个子图层都不画了）；再显示回来
  await ready(page);
  const shown = await hash(page, 1);
  const groupRow = page.locator(`[data-testid="anim-layer"][data-layer="${groupId}"]`);
  await groupRow.hover();
  await groupRow.getByTestId('anim-layer-hide').click();
  await ready(page);
  expect(await hash(page, 1)).not.toBe(shown);
  await groupRow.getByTestId('anim-layer-hide').click();
  await ready(page);
  expect(await hash(page, 1)).toBe(shown);

  // 锁定方块：检查器不能改
  const blockRow = page.locator('[data-testid="anim-layer"][data-layer="block-1"]');
  await blockRow.click();
  await blockRow.hover();
  await blockRow.getByTestId('anim-layer-lock').click();
  await expect(page.getByTestId('anim-layer-locked')).toBeVisible();
  await expect(page.getByTestId('anim-layer-editor')).toHaveAttribute('inert', '');
  await page.getByTestId('anim-layer-locked').getByRole('button').click();
  await expect(page.getByTestId('anim-layer-locked')).toHaveCount(0);

  // 拖动排序：把方块拖到色块的上面（同一个组里），画的顺序跟着变
  const order = async () => (await docJson(page)).layers.map((l) => l.id);
  const before = await order();
  const rect = page.locator('[data-testid="anim-layer"][data-layer="rect-1"]');
  const from = (await blockRow.boundingBox())!;
  const to = (await rect.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + 3, { steps: 8 });
  await page.mouse.up();
  await expect.poll(order).not.toEqual(before);
  const after = await order();
  expect(after.indexOf('block-1')).toBeGreaterThan(after.indexOf('rect-1'));

  // 拖可见区间的终点往左：to 变小
  const end = page.locator('[data-testid="anim-interval-to"]').first();
  const eb = (await end.boundingBox())!;
  const ruler = (await page.getByTestId('anim-ruler').boundingBox())!;
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width / 2 - ruler.width * 0.25, eb.y + eb.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await docJson(page)).layers.some((l) => l.to !== undefined && l.to < 1.6)).toBe(true);
});

test('T-ANIM-25 预览里直接变换：点画面选中方块，拖动移动（靠近中线时吸附并画参考线），拖角缩放，拖上方手柄旋转', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  // 停在方块已经落定的时刻
  await page.evaluate(() => window.__allayTest!.setTime(1));
  const overlay = page.getByTestId('anim-stage-overlay');
  await expect(overlay).toBeVisible();
  const ob = (await overlay.boundingBox())!;
  const cx = ob.x + ob.width / 2;
  const cy = ob.y + ob.height / 2;
  // 点画面中央（方块在中心）：选中
  await page.mouse.click(cx, cy);
  await expect(page.locator('[data-testid="anim-stage-outline"][data-layer="block-1"]')).toBeVisible();
  // 拖着往右上挪一段：x、y 变成常量
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + ob.width * 0.2, cy - ob.height * 0.1, { steps: 8 });
  await page.mouse.up();
  const props = async () => (await docJson(page)).layers[0]!.props as Record<string, unknown>;
  await expect.poll(async () => (await props()).x as number).toBeGreaterThan(200);
  // y 有关键帧：在 t = 1 落了一个关键帧
  const y = (await props()).y as { keys: { t: number }[] };
  expect(y.keys.some((k) => Math.abs(k.t - 1) < 1e-6)).toBe(true);
  // 拖回到离中线几个像素的地方：吸附到 x = 0，画出参考线
  const now = (await page.locator('[data-testid="anim-stage-outline"][data-layer="block-1"]').boundingBox())!;
  const bx = now.x + now.width / 2;
  const by = now.y + now.height / 2;
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(cx + 3, by, { steps: 10 });
  // 竖着的参考线宽 0（SVG 的 line），按“在页面上”判断
  await expect(page.getByTestId('anim-stage-guide').first()).toBeAttached();
  await page.mouse.up();
  await expect.poll(async () => (await props()).x).toBe(0);
  // 缩放：拖一个角往外
  const handle = page.getByTestId('anim-stage-scale').nth(1);
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 - 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await props()).scale as number).toBeGreaterThan(1.2);
  // 旋转：拖上方的圆点往右
  const rot = page.getByTestId('anim-stage-rotate');
  const rb = (await rot.boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 80, rb.y + rb.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(((await props()).rotZ as number | undefined) ?? 0)).toBeGreaterThan(10);
  // 点空白处取消选择
  await page.mouse.click(ob.x + 10, ob.y + 10);
  await expect(page.getByTestId('anim-stage-outline')).toHaveCount(0);
});

test('T-ANIM-27 复制器：在检查器里打开，画面变成一组；换成一圈；关掉回到一份', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.evaluate(() => window.__allayTest!.setTime(1));
  await page.getByTestId('anim-layer').first().click();
  await ready(page);
  const single = await hash(page, 1);
  await page.getByTestId('anim-repeat-on').click();
  await expect.poll(async () => ((await docJson(page)).layers[0] as { repeat?: { mode: string } }).repeat?.mode).toBe('grid');
  await ready(page);
  const grid = await hash(page, 1);
  expect(grid).not.toBe(single);
  await page.getByTestId('anim-repeat-mode').getByText(/一圈|Circle/).click();
  await expect.poll(async () => ((await docJson(page)).layers[0] as { repeat?: { mode: string } }).repeat?.mode).toBe('radial');
  await ready(page);
  expect(await hash(page, 1)).not.toBe(grid);
  await page.getByTestId('anim-repeat-on').click();
  await expect.poll(async () => ((await docJson(page)).layers[0] as { repeat?: unknown }).repeat).toBeUndefined();
  await ready(page);
  expect(await hash(page, 1)).toBe(single);
});

test('T-ANIM-28 路径动画：在检查器里打开路径，画面沿路径走；在预览里拖路径上的点改路径；撤销回到原样', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.evaluate(() => window.__allayTest!.setTime(1));
  await page.getByTestId('anim-layer').first().click();
  await ready(page);
  const before = await hash(page, 1);
  type L = { path?: { points: { x: number; y: number }[] }; props: Record<string, unknown> };
  const layer = async () => (await docJson(page)).layers[0] as L;
  await page.getByTestId('anim-path-on').click();
  await expect.poll(async () => (await layer()).path?.points.length).toBe(3);
  // progress 从 0 走到 1
  expect((await layer()).props.progress).toMatchObject({ keys: [{ v: 0 }, { v: 1 }] });
  await ready(page);
  expect(await hash(page, 1)).not.toBe(before);
  // 预览里画出路径和三个点
  await expect(page.getByTestId('anim-stage-path')).toBeAttached();
  await expect(page.getByTestId('anim-stage-path-point')).toHaveCount(3);
  // 拖第一个点往下：路径的第一个点 y 变小
  const pt = (await page.getByTestId('anim-stage-path-point').first().boundingBox())!;
  await page.mouse.move(pt.x + pt.width / 2, pt.y + pt.height / 2);
  await page.mouse.down();
  await page.mouse.move(pt.x + pt.width / 2, pt.y + pt.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await layer()).path!.points[0]!.y).toBeLessThan(-50);
  // 加一个点
  await page.getByTestId('anim-path-add').click();
  await expect.poll(async () => (await layer()).path?.points.length).toBe(4);
  // 一次拖动一步撤销：撤销两次回到刚打开时的路径
  await dispatch(page, 'undo');
  await dispatch(page, 'undo');
  await expect.poll(async () => (await layer()).path!.points[0]!.y).toBe(0);
  // 关掉路径：progress 一起去掉，画面回到原样
  await page.getByTestId('anim-path-on').click();
  await expect.poll(async () => (await layer()).path).toBeUndefined();
  expect((await layer()).props.progress).toBeUndefined();
  await ready(page);
  expect(await hash(page, 1)).toBe(before);
});

test('T-ANIM-29 形状：加一个椭圆，改成径向渐变、加描边、换混合方式，每一步画面都变', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.evaluate(() => window.__allayTest!.setTime(1));
  await ready(page);
  const before = await hash(page, 1);
  await page.getByTestId('anim-add-layer').click();
  await page.getByTestId('anim-add-ellipse').click();
  type L = { type: string; gradient?: { type: string }; stroke?: unknown; blend?: string };
  const last = async () => (await docJson(page)).layers.at(-1) as L;
  await expect.poll(async () => (await last()).type).toBe('ellipse');
  await ready(page);
  const plain = await hash(page, 1);
  expect(plain).not.toBe(before);
  await pickEnum(page, 'anim-shape-fill', /径向渐变|Radial gradient/);
  await expect.poll(async () => (await last()).gradient?.type).toBe('radial');
  await ready(page);
  const grad = await hash(page, 1);
  expect(grad).not.toBe(plain);
  await page.getByTestId('anim-shape-stroke').click();
  await expect.poll(async () => (await last()).stroke).toBeTruthy();
  await ready(page);
  const stroked = await hash(page, 1);
  expect(stroked).not.toBe(grad);
  await pickEnum(page, 'anim-layer-blend', /相加|^Add$/);
  await expect.poll(async () => (await last()).blend).toBe('add');
  await ready(page);
  expect(await hash(page, 1)).not.toBe(stroked);
});

test('T-ANIM-30 图片图层：加一个，空的时候不画；代码里写上贴图 ID 后画出来；打开九宫格、换宽度，画面跟着变', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.evaluate(() => window.__allayTest!.setTime(1));
  await ready(page);
  const before = await hash(page, 1);
  await page.getByTestId('anim-add-layer').click();
  await page.getByTestId('anim-add-image').click();
  type L = { type: string; image?: string; nineSlice?: number[]; width?: number };
  const last = async () => (await docJson(page)).layers.at(-1) as L;
  await expect.poll(async () => (await last()).type).toBe('image');
  await expect(page.getByTestId('anim-layer-image')).toBeVisible();
  await ready(page);
  expect(await hash(page, 1)).toBe(before);
  // 代码里写上贴图（没有原版素材时画占位图）
  const text = ((await dispatch(page, 'animGet')) as { text: string }).text;
  const r = (await dispatch(page, 'animSetText', { text: text.replace('"image": ""', '"image": "minecraft:gui/sprites/widget/button"') })) as { ok: boolean };
  expect(r.ok).toBe(true);
  await expect.poll(async () => (await last()).image).toBe('minecraft:gui/sprites/widget/button');
  await ready(page);
  const drawn = await hash(page, 1);
  expect(drawn).not.toBe(before);
  await page.getByTestId('anim-image-nine').click();
  await expect.poll(async () => (await last()).nineSlice).toEqual([4, 4, 4, 4]);
  await page.getByTestId('anim-image-width').getByRole('textbox').fill('600');
  await page.getByTestId('anim-image-width').getByRole('textbox').press('Enter');
  await expect.poll(async () => (await last()).width).toBe(600);
  await ready(page);
  expect(await hash(page, 1)).not.toBe(drawn);
});

test('T-ANIM-31 逐字动画：给文字图层打开逐字，画面变；复制器的开关这时不能打开；关掉回到原样', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await dispatch(page, 'animAddLayer', { type: 'text' });
  type L = { type: string; chars?: { stagger: number } };
  const last = async () => (await docJson(page)).layers.at(-1) as L;
  await expect.poll(async () => (await last()).type).toBe('text');
  // 给文字一个从下往上的动画，逐字时每个字错开
  const text = ((await dispatch(page, 'animGet')) as { text: string }).text;
  const doc = JSON.parse(text) as { layers: { props: Record<string, unknown> }[] };
  doc.layers.at(-1)!.props.y = { keys: [{ t: 0, v: -200 }, { t: 1, v: 0 }] };
  expect(((await dispatch(page, 'animSetText', { text: JSON.stringify(doc, null, 2) })) as { ok: boolean }).ok).toBe(true);
  await page.evaluate(() => window.__allayTest!.setTime(0.5));
  await ready(page);
  const before = await hash(page, 0.5);
  await page.getByTestId('anim-text-chars').click();
  await expect.poll(async () => (await last()).chars?.stagger).toBe(0.05);
  await expect(page.getByTestId('anim-repeat-on')).toBeDisabled();
  await ready(page);
  expect(await hash(page, 0.5)).not.toBe(before);
  await page.getByTestId('anim-text-chars').click();
  await expect.poll(async () => (await last()).chars).toBeUndefined();
  await ready(page);
  expect(await hash(page, 0.5)).toBe(before);
});

test('T-ANIM-33 转出来的模板重新打开继续编辑：“在动画编辑器里打开”（开发页、命令面板），改完“更新原模板”，模板库里还是同一个模板、画面是改过的', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await newAnimation(page);
  await page.evaluate(() => window.__allayTest!.setTime(1));
  const ref = (await dispatch(page, 'animConvertToTemplate')) as { id: string; version: string };
  expect(await page.evaluate((r) => window.__allayTest!.selectTemplate(r.id, r.version), ref)).toBe(true);
  await ready(page);
  const before = await hash(page, 1);
  // 开发页“在动画编辑器里打开”（命令面板里同一条命令）
  const opening = dispatch(page, 'animEditTemplate');
  // 刚才的动画没保存：先问要不要放弃
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /放弃|Discard/ }).click();
  expect(await opening).toBe(true);
  await expect(page.getByTestId('anim-timeline')).toBeVisible();
  await ready(page);
  expect(await hash(page, 1)).toBe(before);
  // 改：加一个矩形，更新原模板
  await dispatch(page, 'animAddLayer', { type: 'rect' });
  await ready(page);
  const edited = await hash(page, 1);
  expect(edited).not.toBe(before);
  // 检查器的“整段动画”里（没选图层时）有“更新原模板”；这里经同一条命令
  expect(await dispatch(page, 'animUpdateTemplate')).toBe(true);
  await expect.poll(async () => (await page.evaluate((r) => window.allay.templates.readAnimation(r.id, r.version), ref)) as { ok: boolean; text?: string }).toMatchObject({ ok: true });
  const read = (await page.evaluate((r) => window.allay.templates.readAnimation(r.id, r.version), ref)) as { ok: true; text: string; inSync: boolean };
  expect(read.inSync).toBe(true);
  expect((JSON.parse(read.text) as { layers: { type: string }[] }).layers.map((l) => l.type)).toContain('rect');
  // 模板库里还是同一个 id 和版本，选中它画面是改过的
  const entries = await page.evaluate(() => window.__allayTest!.templates());
  expect(entries.filter((e) => e.id === ref.id)).toHaveLength(1);
  expect(await page.evaluate((r) => window.__allayTest!.selectTemplate(r.id, r.version), ref)).toBe(true);
  await ready(page);
  await expect.poll(async () => hash(page, 1)).toBe(edited);
});
