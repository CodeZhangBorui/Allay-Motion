import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Harness } from './harness/harness';

// 剪辑点整帧不透明（docs/decisions.md M8）：CI 的 WARP 上，方块坠落在 N = 16、快门 2° 时剪辑点几乎整帧是 alpha 254。
// 固定这个场景：子帧多、快门角小、整帧被方块盖满时，剪辑点每个像素的 alpha 都必须是 255。有显卡和软件渲染下都跑。

const ROOT = resolve(import.meta.dirname, '../..');
const ELECTRON = createRequire(join(ROOT, 'apps/desktop/package.json'))('electron') as string;

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  app = await electron.launch({ executablePath: ELECTRON, args: [join(import.meta.dirname, 'electron-main.mjs')], env });
  page = await app.firstWindow();
  await page.waitForFunction(() => window.harnessReady === true);
});

test.afterAll(async () => {
  await app?.close();
});

type Fn = { [K in keyof Harness]: Harness[K] extends (...a: infer A) => infer R ? (...a: A) => R : never };
function call<K extends keyof Harness>(name: K, ...args: Parameters<Fn[K]>): Promise<Awaited<ReturnType<Fn[K]>>> {
  return page.evaluate(
    ([n, a]) => (window.harness[n as keyof Harness] as (...x: unknown[]) => unknown)(...(a as unknown[])),
    [name, args] as const,
  ) as Promise<Awaited<ReturnType<Fn[K]>>>;
}

/** CI 上出现 254 的那组随机参数（T-TPL-4 的 block-fall #27） */
const PARAMS = {
  blocks: [{ id: 'minecraft:bedrock', weight: 4.23 }],
  cols: 27,
  columnOrder: 'random',
  bounce: 0.26633323240093887,
  outMode: 'shrink',
  inDuration: 0.5157647029031068,
  hold: 0.674649334512651,
  outDuration: 0.6417293678503484,
  placeSound: 'minecraft:block.stone.place',
  breakSound: null,
  volume: 0.7820488270372152,
  seed: 641917,
};

test('M8 剪辑点整帧不透明：方块坠落，N = 16、快门 2°、1、2、4、8 个子帧与 180°，剪辑点 alpha 全是 255', async () => {
  test.setTimeout(600_000);
  const gpu = await call('gpu');
  test.info().annotations.push({ type: 'renderer', description: gpu });
  const output = { width: 240, height: 135, fps: 30 };
  for (const subframes of [16, 8, 4, 2, 1]) {
    for (const shutterAngle of [2, 180]) {
      const r = await call('tplCheck', 'allay.builtin.block-fall', output, { subframes, shutterAngle }, PARAMS, false);
      const where = `${gpu} N=${subframes} A=${shutterAngle}`;
      console.log(`[cut-opacity] ${where} min=${r.cut?.min} max=${r.cut?.max} below=${r.cut?.below} samples=${JSON.stringify(r.cut?.samples.slice(0, 6))}`);
      // 每种组合都跑完再报（看清是哪些组合出问题）
      expect.soft(r.cut?.min, where).toBe(255);
    }
  }
});
