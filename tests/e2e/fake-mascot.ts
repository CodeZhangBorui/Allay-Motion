// 测试时生成的假悦灵烘焙产物（docs/decisions.md M5b）：文件名、图集网格、atlas.json 与 pnpm mascot:bake 的约定相同，
// 画面是纯色分区色块（每个动作一种颜色，帧号决定色块的位置），不含任何原版贴图。只写进测试的临时目录。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIP_ORDER, CLIPS } from '../../packages/mascot/model/allay.motions';
import { allHandAnchors } from '../../packages/mascot/model/allay.rig';
import { ATLAS_COLUMNS, ATLAS_SIZES, HEAD_SIZES, type AtlasJson } from '../../packages/mascot/src/atlas';
import { encodePng, type Rgba } from '../../scripts/mascot-bake/png';

const COLORS: Record<string, [number, number, number]> = { hover: [60, 183, 244], fly: [43, 108, 155], dance: [155, 133, 232], sad: [120, 120, 128] };

function fill(img: Rgba, x0: number, y0: number, w: number, h: number, [r, g, b]: [number, number, number]): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
}

export function writeFakeMascot(dir: string): AtlasJson {
  mkdirSync(dir, { recursive: true });
  let start = 0;
  const clips = {} as AtlasJson['clips'];
  const frameClip: string[] = [];
  for (const c of CLIP_ORDER) {
    clips[c] = { start, count: CLIPS[c].frames };
    for (let i = 0; i < CLIPS[c].frames; i++) frameClip.push(c);
    start += CLIPS[c].frames;
  }
  const atlas: AtlasJson = { fps: 30, columns: ATLAS_COLUMNS, frames: start, sizes: [...ATLAS_SIZES], clips, handAnchor: allHandAnchors(CLIP_ORDER) };
  for (const size of ATLAS_SIZES) {
    const side = ATLAS_COLUMNS * size;
    const img: Rgba = { width: side, height: side, data: new Uint8Array(side * side * 4) };
    frameClip.forEach((clip, idx) => {
      const ox = (idx % ATLAS_COLUMNS) * size;
      const oy = Math.floor(idx / ATLAS_COLUMNS) * size;
      const box = Math.round(size * 0.4);
      const shift = Math.round(((idx - clips[clip as keyof typeof clips].start) % 8) * size * 0.02);
      fill(img, ox + Math.round(size * 0.3) + shift, oy + Math.round(size * 0.25), box, box, COLORS[clip]!);
    });
    writeFileSync(join(dir, `allay-${size}.png`), encodePng(img));
  }
  for (const s of HEAD_SIZES)
    for (const closed of [false, true]) {
      const img: Rgba = { width: s, height: s, data: new Uint8Array(s * s * 4) };
      fill(img, 0, 0, s, s, closed ? [43, 108, 155] : [60, 183, 244]);
      writeFileSync(join(dir, `allay-head-${s}${closed ? '-closed' : ''}.png`), encodePng(img));
    }
  writeFileSync(join(dir, 'allay.atlas.json'), JSON.stringify(atlas));
  return atlas;
}
