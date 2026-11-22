// packages/templates/_lib 里第 3 批加的方块类共用源码（docs/templates/batch-3.md）：
// 方块排列（和 block-wipe、block-fall 各自那份逐格一致）、网格、顺序图案、音效抽样、按种类分组、带贴图的长方体、碎屑的闭式运动。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { arrangeCells as arrangeLib, ARRANGEMENTS, bandEntry as bandLib, toArrangement } from '../../packages/templates/_lib/src/block-arrangement';
import { boxGeometry } from '../../packages/templates/_lib/src/block-box';
import { createDebris, debrisPosition, type DebrisParticle } from '../../packages/templates/_lib/src/block-debris';
import { createTiles, MAX_TILE_TEXTURES } from '../../packages/templates/_lib/src/block-tiles';
import { blockList, cuePosition, groupByKind, jittered, orderValues, ORDER_PATTERNS, sampleCueIndices, wallGrid } from '../../packages/templates/_lib/src/block-kit';
import { sampleIndices } from '../../packages/templates/_lib/src/cues';
import { arrangeCells as arrangeWipe, bandEntry as bandWipe } from '../../packages/templates/block-wipe/src/arrangement';
import { arrangeCells as arrangeFall } from '../../packages/templates/block-fall/src/arrangement';
import type { SetupContext } from '../../packages/template-sdk/src/index';

// three 是引擎的依赖（根目录没有）：从引擎包解析（同 T-ANIM-1），取 ES 模块那份（require 解析到的是 three.cjs，会报弃用警告）
type Three = SetupContext['THREE'];
const THREE_CJS = createRequire(new URL('../../packages/engine/package.json', import.meta.url)).resolve('three');
const THREE = (await import(pathToFileURL(THREE_CJS.replace(/three\.cjs$/, 'three.module.js')).href)) as Three;

/** 测试用的确定随机数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

describe('T-TPL-LIB-B1 方块排列：_lib 的一份和 block-wipe、block-fall 各自那份逐格一致', () => {
  it('六种排列、不同的网格和方块列表、同样的随机数，结果相同', () => {
    const lists = [[{ weight: 1 }], [{ weight: 3 }, { weight: 1 }], [{ weight: 2 }, { weight: 1 }, { weight: 2 }], Array.from({ length: 7 }, () => ({ weight: 1 })), [{ weight: 1.5 }, { weight: 0.25 }, { weight: 4 }]];
    for (const arrangement of ARRANGEMENTS) {
      for (const entries of lists) {
        for (const [cols, rows] of [[4, 3], [12, 8], [17, 31], [40, 24]] as const) {
          for (const seed of [1, 7, 20261113]) {
            const lib = arrangeLib(arrangement, entries, cols, rows, rng(seed));
            expect(lib, `${arrangement} ${cols}x${rows} ${entries.length}`).toEqual(arrangeWipe(arrangement, entries, cols, rows, rng(seed)));
            expect(lib).toEqual(arrangeFall(arrangement, entries, cols, rows, rng(seed)));
          }
        }
      }
    }
    for (let band = 0; band < 30; band++) expect(bandLib([{ weight: 1.5 }, { weight: 1 }, { weight: 0.5 }], band)).toBe(bandWipe([{ weight: 1.5 }, { weight: 1 }, { weight: 0.5 }], band));
    expect(toArrangement('rings')).toBe('rings');
    expect(toArrangement('nope')).toBe('random');
  });
});

describe('T-TPL-LIB-B2 网格和方块列表', () => {
  it('网格同 block-wipe：边长 = 宽 / 列数，行数 ceil(高 / 边长) + 1，垂直居中，上下都盖过舞台', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]] as const) {
      for (const cols of [4, 10, 12, 24, 40]) {
        const g = wallGrid(w, h, cols);
        expect(g.size).toBeCloseTo(w / cols);
        expect(g.rows).toBe(Math.ceil(h / (w / cols)) + 1);
        expect(g.count).toBe(g.cols * g.rows);
        // 第一行、最后一行的外沿在舞台之外（或正好在边上）
        expect(g.py[0]! + g.size / 2).toBeGreaterThanOrEqual(h / 2 - 1e-9);
        expect(g.py[g.count - 1]! - g.size / 2).toBeLessThanOrEqual(-h / 2 + 1e-9);
        expect(g.px[0]! - g.size / 2).toBeCloseTo(-w / 2);
        expect(g.px[g.cols - 1]! + g.size / 2).toBeCloseTo(w / 2);
      }
    }
  });

  it('方块列表：去掉权重不合法的项；全都不合法时用后备列表；按种类分组时同一个 ID 只算一种', () => {
    const fallback = [{ id: 'minecraft:stone', weight: 1 }];
    expect(blockList([{ id: 'minecraft:dirt', weight: 2 }, { id: 'minecraft:sand', weight: 0 }, 'x', null], fallback)).toEqual([{ id: 'minecraft:dirt', weight: 2 }]);
    expect(blockList([], fallback)).toEqual(fallback);
    expect(blockList(undefined, fallback)).not.toBe(fallback);
    const entries = [{ id: 'a:x', weight: 1 }, { id: 'a:y', weight: 1 }, { id: 'a:x', weight: 2 }];
    const g = groupByKind(entries, [0, 1, 2, 2, 1]);
    expect(g.kinds).toEqual(['a:x', 'a:y']);
    expect(Array.from(g.cellKind)).toEqual([0, 1, 0, 0, 1]);
    expect(Array.from(g.cellIndex)).toEqual([0, 0, 1, 2, 1]);
    expect(g.kindCount).toEqual([3, 2]);
  });
});

describe('T-TPL-LIB-B3 顺序图案', () => {
  const g = wallGrid(1920, 1080, 12);
  const r = rng(3);
  const noise = (x: number, y: number) => Math.sin(x * 3.1) * Math.cos(y * 2.3);
  it('每种图案都归一化到 [0, 1]；方向对', () => {
    for (const p of ORDER_PATTERNS) {
      const u = orderValues(p, g.px, g.py, 1920, 1080, () => r.next(), noise);
      expect(Math.min(...u)).toBe(0);
      expect(Math.max(...u)).toBe(1);
    }
    const ltr = orderValues('leftToRight', g.px, g.py, 1920, 1080, () => 0, noise);
    expect(ltr[0]).toBe(0);
    expect(ltr[g.cols - 1]).toBe(1);
    const btt = orderValues('bottomToTop', g.px, g.py, 1920, 1080, () => 0, noise);
    expect(btt[g.count - 1]).toBe(0);
    expect(btt[0]).toBe(1);
    const center = orderValues('centerOut', g.px, g.py, 1920, 1080, () => 0, noise);
    const mid = Math.floor(g.rows / 2) * g.cols + g.cols / 2;
    expect(center[mid]!).toBeLessThan(center[0]!);
    // 错落之后仍然归一化
    const j = jittered(ltr, 0.3, () => r.next());
    expect(Math.min(...j)).toBe(0);
    expect(Math.max(...j)).toBe(1);
  });
});

describe('T-TPL-LIB-B4 音效抽样和声源位置', () => {
  it('最多 12 个，按时刻均匀抽样（同 block-wipe：第一个、最后一个都在），不够 12 个时全取', () => {
    const times = Array.from({ length: 100 }, (_, i) => (i * 37) % 100);
    const picked = sampleCueIndices(times);
    expect(picked).toHaveLength(12);
    const t = picked.map((i) => times[i]!);
    expect(t[0]).toBe(0);
    expect(t[11]).toBe(99);
    for (let k = 1; k < 12; k++) expect(t[k]!).toBeGreaterThan(t[k - 1]!);
    expect(sampleCueIndices([3, 1, 2])).toEqual([1, 2, 0]);
    expect(sampleCueIndices([5])).toEqual([0]);
    expect(sampleCueIndices([])).toEqual([]);
    expect(sampleCueIndices(times, 4)).toHaveLength(4);
    // 抽样规则就是 cues.ts 的：按时刻排好的 cue 抽到的序号和 sampleIndices 一样
    const sorted = Array.from({ length: 50 }, (_, i) => i * 0.1);
    expect(sampleCueIndices(sorted)).toEqual(sampleIndices(50));
    expect(sampleCueIndices(sorted, 1)).toEqual(sampleIndices(50, 1));
  });
  it('舞台半宽当 8 格，听者在画面前 6 格', () => {
    expect(cuePosition(960, 0, 1920)).toEqual({ x: 8, y: 0, z: -6 });
    expect(cuePosition(-540, 540, 1080)).toEqual({ x: -8, y: 8, z: -6 });
  });
});

describe('T-TPL-LIB-B5 带贴图的长方体', () => {
  it('同一材质的面合成一组；只画给了的面；顶点色是面明暗（线性）', () => {
    const g = boxGeometry(THREE, [2, 1, 1], {
      south: { material: 0, uv: [0, 0, 16, 16] },
      north: { material: 0, uv: [16, 0, 0, 16] },
      up: { material: 1, uv: [0, 0, 16, 4] },
    });
    expect(g.groups).toEqual([
      { start: 0, count: 12, materialIndex: 0 },
      { start: 12, count: 6, materialIndex: 1 },
    ]);
    const pos = g.getAttribute('position')!;
    expect(pos.count).toBe(12);
    // 宽 2：x 在 ±1
    const xs = Array.from({ length: pos.count }, (_, i) => pos.getX(i));
    expect(Math.max(...xs)).toBe(1);
    expect(Math.min(...xs)).toBe(-1);
    // 南面的明暗 0.8（sRGB）→ 线性约 0.604；顶面 1.0
    const color = g.getAttribute('color')!;
    expect(color.getX(0)).toBeCloseTo(0.6038, 3);
    expect(color.getX(11)).toBeCloseTo(1, 6);
  });
  it('贴图坐标：像素 → 0–1，v = 1 是顶部；转 90° 时角换位', () => {
    const plain = boxGeometry(THREE, [1, 1, 1], { south: { material: 0, uv: [0, 4, 16, 16] } });
    const uv = plain.getAttribute('uv')!;
    // 左下、右下、右上、左上
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0]);
    expect([uv.getX(2), uv.getY(2)]).toEqual([1, 0.75]);
    const turned = boxGeometry(THREE, [1, 1, 1], { south: { material: 0, uv: [0, 0, 16, 16], rotate: 1 } });
    const tv = turned.getAttribute('uv')!;
    // 转 90°（顺时针）：左下角用原来右下角的贴图坐标
    expect([tv.getX(0), tv.getY(0)]).toEqual([1, 0]);
  });
});

describe('T-TPL-LIB-B6 碎屑的闭式运动', () => {
  const p: DebrisParticle = { x: 10, y: 20, z: 0, vx: 30, vy: 40, vz: -5, birth: 1, life: 0.8, size: 4, u0: 0, v0: 0, uvSize: 0.25, texture: 0 };
  const opts = { gravity: 300, drag: 0.4 };
  it('和逐步积分（很小的步长）一致；寿命之外是 null', () => {
    let x = p.x;
    let y = p.y;
    let vx = p.vx;
    let vy = p.vy;
    const dt = 1e-5;
    for (let t = 0; t < 0.5; t += dt) {
      vx += -opts.drag * vx * dt;
      vy += (-opts.gravity - opts.drag * vy) * dt;
      x += vx * dt;
      y += vy * dt;
    }
    const at = debrisPosition(p, 1.5, opts)!;
    expect(at[0]).toBeCloseTo(x, 2);
    expect(at[1]).toBeCloseTo(y, 2);
    expect(debrisPosition(p, 0.99, opts)).toBeNull();
    expect(debrisPosition(p, 1.81, opts)).toBeNull();
    expect(debrisPosition(p, 1, opts)).toEqual([10, 20, 0]);
  });
  it('一组粒子是一个实例化网格，每片一份属性；没有粒子时是空对象', () => {
    const ctx = { THREE } as unknown as SetupContext;
    const tex = new THREE.Texture();
    const d = createDebris(ctx, [tex], [p, { ...p, x: 0, texture: 3 }], { ...opts, renderOrder: 2 });
    const mesh = d.object as InstanceType<Three['InstancedMesh']>;
    expect(mesh.count).toBe(2);
    expect(mesh.renderOrder).toBe(2);
    expect(mesh.geometry.getAttribute('aPos')!.count).toBe(2);
    // 超出贴图张数的序号钳到最后一张
    expect(mesh.geometry.getAttribute('aMeta')!.getW(1)).toBe(0);
    d.setTime(1.2);
    expect((mesh.material as InstanceType<Three['ShaderMaterial']>).uniforms.uTime!.value).toBe(1.2);
    d.dispose();
    expect(createDebris(ctx, [tex], [], opts).count).toBe(0);
  });
});

describe('T-TPL-LIB-B7 成批的贴图方片', () => {
  it('一组方片是一个实例化网格；每块的贴图序号、贴图里的一块、颜色写进实例属性；贴图超过 8 张时只用前 8 张', () => {
    const ctx = { THREE } as unknown as SetupContext;
    const textures = Array.from({ length: 10 }, () => new THREE.Texture());
    const tiles = createTiles(ctx, textures, 3, { renderOrder: 4 });
    const geo = tiles.mesh.geometry;
    expect(tiles.count).toBe(3);
    expect(tiles.mesh.renderOrder).toBe(4);
    tiles.setTile(1, { texture: 9, u0: 0.25, v0: 0.5, du: 0.25, dv: 0.25, tint: [0.5, 0.25, 1] });
    // 序号钳到最后一张能用的（第 8 张，下标 7）
    expect(geo.getAttribute('aTex')!.getX(1)).toBe(MAX_TILE_TEXTURES - 1);
    const rect = geo.getAttribute('aRect')!;
    expect([rect.getX(1), rect.getY(1), rect.getZ(1), rect.getW(1)]).toEqual([0.25, 0.5, 0.25, 0.25]);
    // 没设的那块：整张贴图、白色
    expect([rect.getX(0), rect.getY(0), rect.getZ(0), rect.getW(0)]).toEqual([0, 0, 1, 1]);
    expect(geo.getAttribute('aTint')!.getX(0)).toBe(1);
    const material = tiles.mesh.material as InstanceType<Three['ShaderMaterial']>;
    expect(material.transparent).toBe(false);
    expect(Object.keys(material.uniforms).filter((k) => k.startsWith('uTex'))).toHaveLength(MAX_TILE_TEXTURES);
    // 动画贴图：uniform 直接引用引擎贴图自己的 offset / repeat（不复制、不改贴图）
    expect(material.uniforms.uOff0!.value).toBe(textures[0]!.offset);
    tiles.dispose();
    const glass = createTiles(ctx, [textures[0]!], 1, { transparent: true });
    expect((glass.mesh.material as InstanceType<Three['ShaderMaterial']>).transparent).toBe(true);
    expect((glass.mesh.material as InstanceType<Three['ShaderMaterial']>).depthWrite).toBe(false);
  });
});
