// M1 的资源桩：resolveResource 的临时实现。贴图由代码生成，不读任何文件（AGENTS.md 硬性规则 1）。
// M2 换成经主进程的三层资源栈。
import type { ResourceKind, ResourcePayload } from '@allay/template-sdk';

/** 资源栈指纹：桩实现只有一个固定的内容 */
export const STUB_RESOURCE_STAMP = 'm1-stub-1';

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 已知 ID 的底色；其他 ID 按名字散列出一个颜色 */
const BASE_COLORS: Record<string, [number, number, number]> = {
  'minecraft:block/diamond_block': [78, 196, 212],
};

/**
 * 16×16 的占位方块贴图：底色加按位置散列的明暗颗粒，外圈一像素的亮边和暗边，看起来像个方块。
 * 纯函数，同一个 ID 永远同一张图。
 */
export function placeholderBlockTexture(id: string): ResourcePayload {
  const size = 16;
  const h = hash(id);
  const base = BASE_COLORS[id] ?? [64 + (h & 127), 64 + ((h >> 8) & 127), 64 + ((h >> 16) & 127)];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash(`${id}:${x}:${y}`);
      let k = 0.86 + ((n & 255) / 255) * 0.22;
      if (x === 0 || y === 0) k = 1.28;
      else if (x === size - 1 || y === size - 1) k = 0.62;
      else if ((x === 3 || x === 12) && y > 2 && y < 13 && (n & 3) === 0) k = 1.18;
      const o = (y * size + x) * 4;
      data[o] = Math.min(255, Math.round(base[0] * k));
      data[o + 1] = Math.min(255, Math.round(base[1] * k));
      data[o + 2] = Math.min(255, Math.round(base[2] * k));
      data[o + 3] = 255;
    }
  }
  return { kind: 'rgba', width: size, height: size, data };
}

/** resolveResource 的桩：只认 minecraft:block/* 的贴图 */
export async function stubResolveResource(kind: ResourceKind, id: string): Promise<ResourcePayload | null> {
  if (kind !== 'texture') return null;
  if (!/^minecraft:block\/[a-z0-9_]+$/.test(id)) return null;
  return placeholderBlockTexture(id);
}
