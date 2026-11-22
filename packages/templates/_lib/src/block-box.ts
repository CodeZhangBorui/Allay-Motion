// 带贴图的长方体（第 3 批加入，docs/templates/batch-3.md）：活塞、门这类不是整块方块的东西，用几个长方体按贴图的像素拼。
// 每个面给贴图（材质序号）和贴图上的一块（像素坐标，按 16 × 16 的贴图写），面的明暗照方块（block-kit 的 FACE_SHADE）烘进顶点色。
// 坐标同引擎的方块：+x 东、+y 上、+z 南（朝向默认相机）；贴图的上边朝 +y，顶面的上边朝北、底面的上边朝南。
import type { SetupContext } from '@allay/template-sdk';
import { FACE_SHADE, srgbToLinear } from './block-kit';

type Three = SetupContext['THREE'];

export type BoxFaceName = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';

export interface BoxFace {
  /** 材质序号（几何体的 group.materialIndex） */
  material: number;
  /** 贴图上的一块：[u0, v0, u1, v1]，单位是贴图像素（0–16），v 从上往下；u0 > u1 时左右翻转 */
  uv: readonly number[];
  /** 贴图在面上顺时针转几个 90°（0–3） */
  rotate?: number;
  /** 盖掉面明暗的系数（sRGB） */
  shade?: number;
}

/** 从面外看的四个角：左下、右下、右上、左上（同引擎 blocks.ts 的 FACE_QUADS），单位立方体 [-0.5, 0.5]³ */
const QUADS: Readonly<Record<BoxFaceName, readonly (readonly [number, number, number])[]>> = {
  up: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
  down: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]],
  north: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
  south: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
  east: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]],
  west: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]],
};

export const BOX_FACES: readonly BoxFaceName[] = ['up', 'down', 'north', 'south', 'east', 'west'];

/**
 * 一个长方体：尺寸 (sx, sy, sz)，中心在 (cx, cy, cz)。只画 faces 里给了的面；同一材质的面合成一组（一次绘制）。
 * shading 为假时不加面明暗（顶点色都是 1）。
 */
export function boxGeometry(
  THREE: Three,
  size: readonly number[],
  faces: Partial<Record<BoxFaceName, BoxFace>>,
  opts: { center?: readonly number[]; shading?: boolean } = {},
) {
  const [sx = 1, sy = 1, sz = 1] = size;
  const [cx = 0, cy = 0, cz = 0] = opts.center ?? [];
  const shading = opts.shading !== false;
  const byMaterial = new Map<number, BoxFaceName[]>();
  for (const name of BOX_FACES) {
    const f = faces[name];
    if (!f) continue;
    const list = byMaterial.get(f.material) ?? [];
    list.push(name);
    byMaterial.set(f.material, list);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const geometry = new THREE.BufferGeometry();
  for (const material of [...byMaterial.keys()].sort((a, b) => a - b)) {
    const start = index.length;
    for (const name of byMaterial.get(material)!) {
      const f = faces[name]!;
      const base = pos.length / 3;
      const k = srgbToLinear(f.shade ?? (shading ? FACE_SHADE[name] : 1));
      const [u0 = 0, v0 = 0, u1 = 16, v1 = 16] = f.uv;
      // 贴图坐标：u = 像素 / 16，v = 1 − 像素 / 16（v = 1 是顶部）。角的顺序同 QUADS：左下、右下、右上、左上
      const corners = [
        [u0 / 16, 1 - v1 / 16],
        [u1 / 16, 1 - v1 / 16],
        [u1 / 16, 1 - v0 / 16],
        [u0 / 16, 1 - v0 / 16],
      ];
      const rot = (((f.rotate ?? 0) % 4) + 4) % 4;
      QUADS[name].forEach((p, i) => {
        pos.push(cx + p[0] * sx, cy + p[1] * sy, cz + p[2] * sz);
        // 顺时针转 rot 个 90°：第 i 个角用原来第 i + rot 个角的贴图坐标
        const c = corners[(i + rot) % 4]!;
        uv.push(c[0]!, c[1]!);
        color.push(k, k, k);
      });
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    geometry.groups.push({ start, count: index.length - start, materialIndex: material });
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(color), 3));
  geometry.setIndex(index);
  return geometry;
}
