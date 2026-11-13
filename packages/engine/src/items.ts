// 物品（docs/02-engine.md 2.8）：把 16×16 贴图按不透明像素挤出 1 像素厚度的网格。
// 正反面各一层（用 alphaTest 抠出形状），四周补侧壁；同一行（列）上相邻、同色、同朝向的侧壁合并成一个四边形。
// 高度为 1，厚度为 1/16，中心在原点。方块 ID 按方块渲染（03-assets.md 3.7）。
import { getBlock, getItem, normalizeResourceId } from '@allay/assets';
import type { ItemHandle } from '@allay/template-sdk';
import * as THREE from 'three';
import { createBlockHandle } from './blocks';
import { textureInfo, type EngineResources, type TextureInfo, type Warn } from './resources';

/** 侧壁的明暗（与方块的面明暗同一套系数，sRGB 空间） */
const WALL_SHADE = { top: 1.0, bottom: 0.5, left: 0.6, right: 0.6 } as const;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 第 0 帧里 (x, y)（左上为原点）的 RGBA */
function pixelAt(info: TextureInfo, x: number, y: number): number {
  const o = (y * info.width + x) * 4;
  const p = info.pixels;
  return ((p[o]! << 24) | (p[o + 1]! << 16) | (p[o + 2]! << 8) | p[o + 3]!) >>> 0;
}

/** 物品网格。纯函数：同一张图永远得到同一个几何体 */
export function buildItemGeometry(info: TextureInfo): THREE.BufferGeometry {
  const W = info.frameWidth;
  const H = info.frameHeight;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (info.pixels[(y * info.width + x) * 4 + 3] ?? 0) >= 128;
  const s = 1 / H;
  const halfW = (W * s) / 2;
  const depth = 1 / 16;
  const zf = depth / 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const quad = (corners: readonly (readonly [number, number, number])[], uvs: readonly number[], shade: number) => {
    const base = pos.length / 3;
    const k = srgbToLinear(shade);
    corners.forEach((c, i) => {
      pos.push(c[0], c[1], c[2]);
      uv.push(uvs[i * 2]!, uvs[i * 2 + 1]!);
      color.push(k, k, k);
    });
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // 像素 (x, y) 的左上角在网格坐标里的位置
  const X = (x: number) => -halfW + x * s;
  const Y = (y: number) => 0.5 - y * s;
  // 贴图 UV：u = x / W，v = 1 - y / H（贴图在 CPU 上翻过行）
  const U = (x: number) => x / W;
  const V = (y: number) => 1 - y / H;

  // 正面（+z）和背面（−z，左右镜像，和游戏一样从背后看是反的）
  quad([[X(0), Y(H), zf], [X(W), Y(H), zf], [X(W), Y(0), zf], [X(0), Y(0), zf]], [0, 0, 1, 0, 1, 1, 0, 1], 1);
  quad([[X(W), Y(H), -zf], [X(0), Y(H), -zf], [X(0), Y(0), -zf], [X(W), Y(0), -zf]], [1, 0, 0, 0, 0, 1, 1, 1], 1);

  // 上下侧壁：逐行扫描，合并相邻同色的像素
  for (const dir of ['top', 'bottom'] as const) {
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        const exposed = (xx: number) => opaque(xx, y) && !opaque(xx, dir === 'top' ? y - 1 : y + 1);
        if (!exposed(x)) {
          x++;
          continue;
        }
        const c = pixelAt(info, x, y);
        let x1 = x + 1;
        while (x1 < W && exposed(x1) && pixelAt(info, x1, y) === c) x1++;
        const yy = dir === 'top' ? Y(y) : Y(y + 1);
        const vc = V(y + 0.5);
        if (dir === 'top') quad([[X(x), yy, zf], [X(x1), yy, zf], [X(x1), yy, -zf], [X(x), yy, -zf]], [U(x), vc, U(x1), vc, U(x1), vc, U(x), vc], WALL_SHADE.top);
        else quad([[X(x), yy, -zf], [X(x1), yy, -zf], [X(x1), yy, zf], [X(x), yy, zf]], [U(x), vc, U(x1), vc, U(x1), vc, U(x), vc], WALL_SHADE.bottom);
        x = x1;
      }
    }
  }
  // 左右侧壁：逐列扫描
  for (const dir of ['left', 'right'] as const) {
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        const exposed = (yy: number) => opaque(x, yy) && !opaque(dir === 'left' ? x - 1 : x + 1, yy);
        if (!exposed(y)) {
          y++;
          continue;
        }
        const c = pixelAt(info, x, y);
        let y1 = y + 1;
        while (y1 < H && exposed(y1) && pixelAt(info, x, y1) === c) y1++;
        const xx = dir === 'left' ? X(x) : X(x + 1);
        const uc = U(x + 0.5);
        if (dir === 'left') quad([[xx, Y(y1), -zf], [xx, Y(y1), zf], [xx, Y(y), zf], [xx, Y(y), -zf]], [uc, V(y1), uc, V(y1), uc, V(y), uc, V(y)], WALL_SHADE.left);
        else quad([[xx, Y(y1), zf], [xx, Y(y1), -zf], [xx, Y(y), -zf], [xx, Y(y), zf]], [uc, V(y1), uc, V(y1), uc, V(y), uc, V(y)], WALL_SHADE.right);
        y = y1;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** ctx.resources.item(id)（04-templates.md 4.5） */
export async function createItemHandle(resources: EngineResources, id: string, warn: Warn): Promise<ItemHandle> {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) throw new TypeError('invalid item id');
  const def = getItem(id);
  if (!def && getBlock(id)) {
    const block = await createBlockHandle(resources, id, undefined, warn);
    return { single: () => block.single() };
  }
  let texture: THREE.Texture;
  if (def) {
    texture = await resources.texture(normalizeResourceId(def.tex) ?? def.tex, warn);
  } else {
    warn(`item ${id} is not in the item catalog; a placeholder is used`);
    texture = resources.placeholderTexture();
  }
  const info = textureInfo(texture);
  if (!info) throw new Error('texture without pixel data');
  return {
    single() {
      const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 });
      return new THREE.Mesh(buildItemGeometry(info), material);
    },
  };
}
