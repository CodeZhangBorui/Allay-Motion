// T-TPL-4 的随机合法参数：按 manifest 的参数定义，用固定种子的伪随机数生成（测试可复现）。
// 方块只从目录里不透明的整块方块里挑：半透明、镂空的方块本来就盖不满画面，不属于“合法参数下应当铺满”的情形。
import { BLOCKS } from '../../packages/assets/src/index';
import { EASING_NAMES, type ParamDef, type ParamValue, type ParamValues } from '../../packages/template-sdk/src/index';

/** mulberry32 */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OPAQUE_BLOCKS = Object.entries(BLOCKS)
  .filter(([, def]) => (def.render ?? 'opaque') === 'opaque')
  .map(([id]) => id)
  .sort();

function randomValue(def: ParamDef, r: () => number): ParamValue {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const between = (a: number, b: number) => a + (b - a) * r();
  switch (def.type) {
    case 'number':
    case 'duration':
      // 端点也要测到
      return r() < 0.15 ? pick([def.min, def.max]) : between(def.min, def.max);
    case 'integer':
      return Math.floor(between(def.min, def.max + 1 - 1e-9));
    case 'seed':
      return Math.floor(r() * 1_000_000);
    case 'boolean':
      return r() < 0.5;
    case 'enum':
      return pick(def.options).value;
    case 'easing':
      return r() < 0.8 ? pick(EASING_NAMES) : [r(), between(-0.5, 1.5), r(), between(-0.5, 1.5)];
    case 'angle':
      return Math.floor(r() * 360);
    case 'color': {
      const hex = () => Math.floor(r() * 256).toString(16).padStart(2, '0').toUpperCase();
      return `#${hex()}${hex()}${hex()}${def.alpha ? hex() : ''}`;
    }
    case 'blockList': {
      const n = 1 + Math.floor(r() * (def.max ?? 8));
      return Array.from({ length: n }, () => ({ id: pick(OPAQUE_BLOCKS), weight: Math.round(between(0.1, 5) * 100) / 100 }));
    }
    case 'block':
      return pick(OPAQUE_BLOCKS);
    case 'font':
      // 字体族只取测试环境里一定有的两个；样式全部随机
      return {
        family: pick(['minecraft:default', 'system:sans']),
        bold: r() < 0.5,
        italic: r() < 0.5,
        underline: r() < 0.3,
        strikethrough: r() < 0.3,
        shadow: r() < 0.5,
        outline: r() < 0.3 ? '#000000' : null,
      };
    case 'sound':
      return r() < 0.2 ? null : pick(['minecraft:block.stone.place', 'minecraft:block.wood.break', 'minecraft:ui.toast.in']);
    default:
      return def.default as ParamValue;
  }
}

/** n 组随机合法参数 */
export function randomParamSets(defs: readonly ParamDef[], n: number, seed: number): ParamValues[] {
  const r = prng(seed);
  return Array.from({ length: n }, () => Object.fromEntries(defs.map((d) => [d.key, randomValue(d, r)])));
}
