// 列表排序的纯函数（方块列表的拖动排序用，2026-11 反馈：方块排列顺序）。

/** 把第 from 项移到第 to 项的位置（其余项的相对顺序不变）；下标越界时原样返回 */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}
