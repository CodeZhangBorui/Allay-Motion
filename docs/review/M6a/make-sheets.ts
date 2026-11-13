// M6a 评审用的关键帧联络图：把 T-TPL-5 的基准图（tests/fixtures/baselines/<模板 id>/，纯色假资源栈渲染）
// 缩小一半、铺在棋盘格上（看得出透明的地方），每个模板一张。不含任何原版贴图。
// 用法：pnpm exec tsx docs/review/M6a/make-sheets.ts（先 pnpm templates:baselines）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from '../../../scripts/mascot-bake/png';

const ROOT = resolve(import.meta.dirname, '../../..');
const IDS = ['block-fall', 'item-stinger', 'loading-screen', 'pixel-dissolve', 'advancement-toast'];
const ASPECTS = [
  { name: '16x9', w: 320, h: 180 },
  { name: '9x16', w: 180, h: 320 },
  { name: '1x1', w: 240, h: 240 },
];
const KEYS = ['p0', 'p25', 'cut', 'p75', 'p100'];
const GAP = 8;

for (const id of IDS) {
  const width = GAP + KEYS.length * (320 + GAP);
  const height = GAP + ASPECTS.reduce((n, a) => n + a.h + GAP, 0);
  const out = new Uint8Array(width * height * 4).fill(255);
  let y0 = GAP;
  for (const a of ASPECTS) {
    KEYS.forEach((key, col) => {
      const src = decodePng(readFileSync(join(ROOT, 'tests/fixtures/baselines', `allay.builtin.${id}`, `${a.name}-${key}.png`)));
      const x0 = GAP + col * (320 + GAP);
      for (let y = 0; y < a.h; y++) {
        for (let x = 0; x < a.w; x++) {
          // 2×2 平均（直通 alpha 先换成预乘再平均），再盖到 8 像素的棋盘格上
          let r = 0;
          let g = 0;
          let b = 0;
          let al = 0;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            const o = ((2 * y + dy) * src.width + 2 * x + dx) * 4;
            const k = src.data[o + 3]! / 255;
            r += src.data[o]! * k;
            g += src.data[o + 1]! * k;
            b += src.data[o + 2]! * k;
            al += k;
          }
          const bg = ((x >> 3) + (y >> 3)) % 2 ? 200 : 235;
          const o = ((y0 + y) * width + x0 + x) * 4;
          out[o] = Math.round(r / 4 + bg * (1 - al / 4));
          out[o + 1] = Math.round(g / 4 + bg * (1 - al / 4));
          out[o + 2] = Math.round(b / 4 + bg * (1 - al / 4));
          out[o + 3] = 255;
        }
      }
    });
    y0 += a.h + GAP;
  }
  const file = join(import.meta.dirname, `${id}.png`);
  writeFileSync(file, encodePng({ width, height, data: out }));
  console.log(file);
}
