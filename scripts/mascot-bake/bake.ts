// pnpm mascot:bake 的实现（docs/07-allay-mascot.md 7.3“烘焙”，来源规则按用户决定改过，见 docs/decisions.md 的 M5a 小节）。
//
// 1. 取原版悦灵贴图（texture-source.ts），在内存里解码；派生出闭眼版。
// 2. 把内部模板 allay.internal.mascot 连同模型、动作、骨架打成一个不含 import 的 ESM 字符串。
// 3. 打包渲染页，在不显示的 Electron 窗口里用应用同一份 EngineHost 渲染全部帧（30 fps，透明背景）。
// 4. 在 Node 里拼图集、写 atlas.json、头像、应用图标（PNG 与 .ico）、联络图和评审用的 APNG。
// 产物是原版贴图的派生图像，全部写进被 git 忽略的目录，不提交。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { build, type Rollup } from 'vite';
import { ALLAY_TEXTURE_ID } from '../../packages/mascot/model/allay.model';
import { CLIP_ORDER, CLIPS, FPS, type ClipName } from '../../packages/mascot/model/allay.motions';
import { allHandAnchors, headScale } from '../../packages/mascot/model/allay.rig';
import {
  ATLAS_COLUMNS,
  ATLAS_SIZES,
  CLOSED_TEXTURE_ID,
  HEAD_SIZES,
  ICO_SIZES,
  ICON_SIZES,
  type AtlasJson,
} from '../../packages/mascot/src/atlas';
import { blit, closedEyes, createImage, crop, downscale, iconPlate, over } from './image';
import { decodePng, encodeApng, encodeIco, encodePng, type Rgba } from './png';
import { findAllayTexture } from './texture-source';
import type { BakePage } from './page/bake-page';

const ROOT = resolve(import.meta.dirname, '../..');
export const DEFAULT_OUT_DIR = join(ROOT, 'packages/mascot/generated');
export const DEFAULT_REVIEW_DIR = join(ROOT, 'docs/review/M5a/out');

export interface BakeOptions {
  /** 显式给一张贴图（测试用假贴图） */
  texture?: string;
  gameDir?: string;
  download?: boolean;
  outDir?: string;
  /** null：不写评审材料 */
  reviewDir?: string | null;
  log?(message: string): void;
}

export interface BakeResult {
  origin: string;
  outDir: string;
  files: string[];
  reviewFiles: string[];
}

/** 把内部模板打成单文件 ESM（不含 import），和用户模板一样交给 EngineHost.load */
export async function bundleTemplate(): Promise<string> {
  const out = (await build({
    configFile: false,
    logLevel: 'warn',
    root: join(ROOT, 'packages/mascot'),
    build: {
      write: false,
      minify: false,
      target: 'es2023',
      lib: { entry: join(ROOT, 'packages/mascot/model/allay.internal.mascot.ts'), formats: ['es'], fileName: 'template' },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const outputs = Array.isArray(out) ? out : [out];
  const chunk = outputs.flatMap((o) => o.output).find((c): c is Rollup.OutputChunk => c.type === 'chunk' && c.isEntry);
  if (!chunk) throw new Error('template bundle has no entry chunk');
  return chunk.code;
}

async function buildPage(outDir: string): Promise<void> {
  await build({
    configFile: false,
    logLevel: 'warn',
    root: join(import.meta.dirname, 'page'),
    base: './',
    build: { outDir, emptyOutDir: true, assetsInlineLimit: 0, target: 'es2023' },
    worker: { format: 'es' },
  });
}

function rgbaFromBase64(b64: string, size: number): Rgba {
  const data = new Uint8Array(Buffer.from(b64, 'base64'));
  if (data.length !== size * size * 4) throw new Error(`frame has ${data.length} bytes, expected ${size * size * 4}`);
  return { width: size, height: size, data };
}

/** 图集：columns 列，按帧序从左到右、从上到下 */
export function composeAtlas(frames: Rgba[], size: number, columns: number): Rgba {
  const rows = Math.ceil(frames.length / columns);
  const atlas = createImage(columns * size, rows * size);
  frames.forEach((f, i) => blit(atlas, f, (i % columns) * size, Math.floor(i / columns) * size));
  return atlas;
}

const BG: [number, number, number, number] = [32, 36, 44, 255];
const BG_ALT: [number, number, number, number] = [40, 45, 55, 255];

/** 联络图：每个动作一行（每 3 帧取一帧，缩到 144 px），最后一行是头像（睁眼、闭眼）和应用图标 */
function contactSheet(clips: Record<ClipName, Rgba[]>, heads: Map<string, Rgba>, icons: Map<number, Rgba>): Rgba {
  const cell = 144;
  const step = 3;
  const cols = Math.max(...CLIP_ORDER.map((c) => Math.ceil(CLIPS[c].frames / step)));
  const lastRow = 272;
  const sheet = createImage(cols * cell, CLIP_ORDER.length * cell + lastRow, BG);
  CLIP_ORDER.forEach((clip, r) => {
    const frames = clips[clip];
    for (let i = 0, c = 0; i < frames.length; i += step, c++) {
      if ((r + c) % 2) blit(sheet, createImage(cell, cell, BG_ALT), c * cell, r * cell);
      over(sheet, downscale(frames[i]!, 2), c * cell, r * cell);
    }
  });
  let x = 16;
  const y0 = CLIP_ORDER.length * cell + 16;
  for (const size of [...HEAD_SIZES].reverse()) {
    for (const eyes of ['open', 'closed'] as const) {
      const h = heads.get(`${size}-${eyes}`)!;
      over(sheet, h, x, y0);
      x += size + 8;
    }
    x += 8;
  }
  x += 16;
  for (const size of [256, 128, 64, 48, 32, 16]) {
    over(sheet, icons.get(size)!, x, y0);
    x += size + 12;
  }
  return sheet;
}

function onBackground(f: Rgba): Rgba {
  const out = createImage(f.width, f.height, BG);
  over(out, f, 0, 0);
  return out;
}

export async function bake(opts: BakeOptions = {}): Promise<BakeResult> {
  const log = opts.log ?? (() => undefined);
  const outDir = resolve(opts.outDir ?? DEFAULT_OUT_DIR);
  const reviewDir = opts.reviewDir === null ? null : resolve(opts.reviewDir ?? DEFAULT_REVIEW_DIR);

  const source = await findAllayTexture({ texture: opts.texture, gameDir: opts.gameDir, download: opts.download, log });
  const texture = decodePng(source.bytes);
  if (texture.width !== texture.height || texture.width % 32 !== 0) {
    throw new Error(`悦灵贴图应当是 32×32（或其整数倍的正方形），实际是 ${texture.width}×${texture.height}`);
  }
  const closed = closedEyes(texture);

  const work = await mkdtemp(join(tmpdir(), 'allay-mascot-bake-'));
  const pageDir = join(work, 'page');
  try {
    log('打包内部模板和渲染页…');
    const templateCode = await bundleTemplate();
    await buildPage(pageDir);

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
    env.ALLAY_BAKE_PAGE_DIR = pageDir;
    const executablePath = createRequire(join(ROOT, 'apps/desktop/package.json'))('electron') as string;
    log('在不显示的窗口里启动引擎…');
    const app = await electron.launch({ executablePath, args: [join(import.meta.dirname, 'electron-main.mjs')], env });
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.bakeReady === true, undefined, { timeout: 60_000 });
      const texIn = (img: Rgba) => ({ width: img.width, height: img.height, base64: Buffer.from(img.data).toString('base64') });
      await page.evaluate(([code, tex]) => window.bake.setup(code, tex), [templateCode, { [ALLAY_TEXTURE_ID]: texIn(texture), [CLOSED_TEXTURE_ID]: texIn(closed) }] as const);

      type RenderParams = { view: 'body' | 'head'; clip?: ClipName; texture: string; headK?: number };
      type RenderOut = Awaited<ReturnType<BakePage['render']>>;
      const render = async (params: RenderParams, size: number, indices: number[]): Promise<Rgba[]> => {
        // ParamValues 是递归类型，直接交给 page.evaluate 的序列化类型推导会无限展开；这里的参数都是平铺的 JSON
        const call = (arg: [RenderParams, number, number[]]): Promise<RenderOut> =>
          window.bake.render(arg[0] as Parameters<BakePage['render']>[0], arg[1], arg[2]);
        const r = (await page.evaluate(call as (arg: unknown) => Promise<unknown>, [params, size, indices])) as RenderOut;
        if (r.warnings.length > 0) throw new Error(`模板警告：${r.warnings.join('; ')}`);
        return r.frames.map((b64) => rgbaFromBase64(b64, size));
      };

      // 全身：两套尺寸 × 四个动作
      const clipFrames = new Map<number, Record<ClipName, Rgba[]>>();
      for (const size of ATLAS_SIZES) {
        const byClip = {} as Record<ClipName, Rgba[]>;
        for (const clip of CLIP_ORDER) {
          log(`渲染 ${clip} @ ${size}px（${CLIPS[clip].frames} 帧）`);
          const indices = Array.from({ length: CLIPS[clip].frames }, (_, i) => i);
          byClip[clip] = await render({ view: 'body', clip, texture: ALLAY_TEXTURE_ID }, size, indices);
        }
        clipFrames.set(size, byClip);
      }

      // 正面头像：睁眼和闭眼
      log('渲染头像和应用图标…');
      const heads = new Map<string, Rgba>();
      for (const size of HEAD_SIZES) {
        for (const eyes of ['open', 'closed'] as const) {
          const [img] = await render({ view: 'head', texture: eyes === 'open' ? ALLAY_TEXTURE_ID : CLOSED_TEXTURE_ID, headK: headScale(size) }, size, [0]);
          heads.set(`${size}-${eyes}`, img!);
        }
      }

      // 应用图标：头像（整数倍放大，约占 70%）放在渐变圆角方形上
      const icons = new Map<number, Rgba>();
      for (const size of ICON_SIZES) {
        const k = Math.max(1, Math.round((size * 0.7) / 5));
        const face = 5 * k;
        const renderSize = Math.max(16, face);
        const [img] = await render({ view: 'head', texture: ALLAY_TEXTURE_ID, headK: k }, renderSize, [0]);
        const off = Math.floor((renderSize - face) / 2);
        const icon = iconPlate(size);
        over(icon, crop(img!, off, off, face, face), Math.floor((size - face) / 2), Math.floor((size - face) / 2));
        icons.set(size, icon);
      }

      // ---- 写文件 ----
      await mkdir(outDir, { recursive: true });
      const files: string[] = [];
      const put = async (dir: string, name: string, bytes: Uint8Array, list: string[]) => {
        await writeFile(join(dir, name), bytes);
        list.push(name);
      };
      for (const size of ATLAS_SIZES) {
        const byClip = clipFrames.get(size)!;
        const all = CLIP_ORDER.flatMap((c) => byClip[c]);
        await put(outDir, `allay-${size}.png`, encodePng(composeAtlas(all, size, ATLAS_COLUMNS)), files);
      }
      let start = 0;
      const clips = {} as AtlasJson['clips'];
      for (const clip of CLIP_ORDER) {
        clips[clip] = { start, count: CLIPS[clip].frames };
        start += CLIPS[clip].frames;
      }
      const atlas: AtlasJson = { fps: FPS, columns: ATLAS_COLUMNS, frames: start, sizes: [...ATLAS_SIZES], clips, handAnchor: allHandAnchors(CLIP_ORDER) };
      await put(outDir, 'allay.atlas.json', Buffer.from(`${JSON.stringify(atlas, null, 2)}\n`), files);
      for (const size of HEAD_SIZES) {
        await put(outDir, `allay-head-${size}.png`, encodePng(heads.get(`${size}-open`)!), files);
        await put(outDir, `allay-head-${size}-closed.png`, encodePng(heads.get(`${size}-closed`)!), files);
      }
      for (const size of ICON_SIZES) await put(outDir, `icon-${size}.png`, encodePng(icons.get(size)!), files);
      await put(outDir, 'icon.ico', encodeIco(ICO_SIZES.map((s) => icons.get(s)!)), files);

      const reviewFiles: string[] = [];
      if (reviewDir) {
        await mkdir(reviewDir, { recursive: true });
        const big = clipFrames.get(288)!;
        await put(reviewDir, 'mascot-contact-sheet.png', encodePng(contactSheet(big, heads, icons)), reviewFiles);
        for (const clip of CLIP_ORDER) await put(reviewDir, `allay-${clip}.apng`, encodeApng(big[clip].map(onBackground), FPS), reviewFiles);
      }
      return { origin: source.origin, outDir, files, reviewFiles };
    } finally {
      await app.close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
