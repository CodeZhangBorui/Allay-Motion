// 成批的贴图方片（第 3 批加入，docs/templates/batch-3.md）：一个实例化网格画很多块带贴图的方片，每块可以用不同的贴图（最多 8 张）、
// 取贴图里的一块、乘自己的颜色（明暗、光照）。位置、朝向、大小由模板按实例矩阵摆；动画贴图（.mcmeta）跟着引擎走。
// 用在传送门的碎片（portal-gate）、矿道的墙面（tunnel-rush）这类“很多块、贴图各不相同”的东西上，一次绘制。
import type { SetupContext } from '@allay/template-sdk';

type Three = SetupContext['THREE'];
type Texture = InstanceType<Three['Texture']>;
type Matrix4 = InstanceType<Three['Matrix4']>;
type InstancedMesh = InstanceType<Three['InstancedMesh']>;

export const MAX_TILE_TEXTURES = 8;

export interface TileOptions {
  /** 半透明（按贴图的 alpha 混合，进透明队列）；默认不透明、按 alphaTest 抠图 */
  transparent?: boolean;
  /** 抠图的阈值（不透明时），默认 0.5 */
  alphaTest?: number;
  /** 两面都画 */
  doubleSided?: boolean;
  renderOrder?: number;
}

export interface Tile {
  texture: number;
  /** 贴图里的一块：左上角 (u0, v0)、宽高 (du, dv)，都按 0–1、v 从上往下；默认整张 */
  u0?: number;
  v0?: number;
  du?: number;
  dv?: number;
  /** 乘在贴图上的颜色（线性 RGB）；默认白色 */
  tint?: readonly [number, number, number];
}

export interface Tiles {
  mesh: InstancedMesh;
  count: number;
  /** 第 i 块的贴图和颜色（在 setup 里设好；改了之后调 commitTiles） */
  setTile(i: number, tile: Tile): void;
  commitTiles(): void;
  setMatrix(i: number, m: Matrix4): void;
  /** 一帧里摆完所有方片后调用一次 */
  commit(): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute float aTex;
attribute vec4 aRect;
attribute vec3 aTint;
varying vec2 vUv;
varying vec3 vTint;
flat varying float vTex;
void main() {
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
  // 贴图的 v = 1 是顶部（引擎在 CPU 上翻过行）
  vUv = vec2(aRect.x + uv.x * aRect.z, 1.0 - (aRect.y + (1.0 - uv.y) * aRect.w));
  vTint = aTint;
  vTex = aTex;
}
`;

function fragment(n: number, transparent: boolean, alphaTest: number): string {
  const decl: string[] = [];
  const pick: string[] = [];
  for (let i = 0; i < n; i++) {
    decl.push(`uniform sampler2D uTex${i};\nuniform vec2 uOff${i};\nuniform vec2 uRep${i};`);
    const sample = `c = textureGrad(uTex${i}, uOff${i} + vUv * uRep${i}, dx * uRep${i}, dy * uRep${i});`;
    pick.push(i === n - 1 ? `{ ${sample} }` : `if (vTex < ${i}.5) { ${sample} } else `);
  }
  const out = transparent ? 'gl_FragColor = vec4(c.rgb * vTint, c.a);' : `if (c.a < ${alphaTest.toFixed(3)}) discard;\n  gl_FragColor = vec4(c.rgb * vTint, 1.0);`;
  return /* glsl */ `
${decl.join('\n')}
varying vec2 vUv;
varying vec3 vTint;
flat varying float vTex;
void main() {
  // 导数在分支外面取：相邻两块的序号不同时，分支里的隐式导数没有定义
  vec2 dx = dFdx(vUv);
  vec2 dy = dFdy(vUv);
  vec4 c = vec4(0.0);
  ${pick.join('')}
  ${out}
}
`;
}

/** 建一组方片（单位正方形，中心在原点，朝 +z）。textures 是引擎给的贴图，只读不改 */
export function createTiles(ctx: SetupContext, textures: readonly Texture[], count: number, opts: TileOptions = {}): Tiles {
  const { THREE } = ctx;
  const n = Math.max(1, Math.round(count));
  const slots = textures.slice(0, MAX_TILE_TEXTURES);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const texAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const rectAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
  for (let i = 0; i < n; i++) rectAttr.setXYZW(i, 0, 0, 1, 1);
  geometry.setAttribute('aTex', texAttr);
  geometry.setAttribute('aRect', rectAttr);
  geometry.setAttribute('aTint', tintAttr);
  // 引用引擎贴图自己的 offset / repeat（动画贴图每个子帧由引擎改），只读。
  // 用 Object.fromEntries 建表：打包后的 JS 没有类型标注，空对象再逐个加键在 checkJs 下推不出索引签名
  const uniforms = Object.fromEntries(
    slots.flatMap((tex, i): [string, { value: unknown }][] => [
      [`uTex${i}`, { value: tex }],
      [`uOff${i}`, { value: tex.offset }],
      [`uRep${i}`, { value: tex.repeat }],
    ]),
  );
  const transparent = opts.transparent === true;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: fragment(Math.max(1, slots.length), transparent, opts.alphaTest ?? 0.5),
    transparent,
    depthWrite: !transparent,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder ?? 0;
  return {
    mesh,
    count: n,
    setTile(i, tile) {
      texAttr.setX(i, Math.min(slots.length - 1, Math.max(0, Math.round(tile.texture))));
      rectAttr.setXYZW(i, tile.u0 ?? 0, tile.v0 ?? 0, tile.du ?? 1, tile.dv ?? 1);
      const c = tile.tint ?? [1, 1, 1];
      tintAttr.setXYZ(i, c[0], c[1], c[2]);
    },
    commitTiles() {
      texAttr.needsUpdate = true;
      rectAttr.needsUpdate = true;
      tintAttr.needsUpdate = true;
    },
    setMatrix(i, m) {
      mesh.setMatrixAt(i, m);
    },
    commit() {
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
