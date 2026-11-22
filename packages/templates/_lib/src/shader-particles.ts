// 在着色器里按闭式算位置的一批粒子（第 4 批）：N 个四边形放在一个几何体里，一次绘制。
// 每个粒子的出生时刻、初速度这些量在 setup 里用 ctx.random 定好，写进顶点属性；顶点着色器只读 uniform（时刻、进度）
// 和这些属性，用闭式算出粒子此刻的位置、大小、不透明度（硬性规则 2；同 _lib/particles.ts 的做法，只是搬到 GPU 上）。
// update(t) 里只改 uniform，不改几何体。
import type { SetupContext } from '@allay/template-sdk';
import type { Uniforms } from './shader-kit';

type Three = SetupContext['THREE'];
type Mesh = InstanceType<Three['Mesh']>;
type ShaderMaterial = InstanceType<Three['ShaderMaterial']>;

export interface ParticleAttribute {
  /** 每个粒子几个分量（1–4） */
  size: number;
  /** count × size 个数，按粒子排 */
  data: Float32Array;
}

export interface ParticleBatchOptions {
  count: number;
  /** 每个粒子的属性（着色器里的 attribute 名字 → 数据）。另外自动带上 aCorner（四边形的角，−0.5–0.5） */
  attributes: Record<string, ParticleAttribute>;
  vertex: string;
  fragment: string;
  uniforms: Uniforms;
  renderOrder?: number;
}

export interface ParticleBatch {
  mesh: Mesh;
  material: ShaderMaterial;
  dispose(): void;
}

/** 一批粒子：count 个四边形，每个粒子的属性在四个角上各复制一份 */
export function particleBatch(ctx: SetupContext, opts: ParticleBatchOptions): ParticleBatch {
  const { THREE } = ctx;
  const n = Math.max(1, Math.floor(opts.count));
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(n * 12);
  const corner = new Float32Array(n * 8);
  const index: number[] = [];
  const corners = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
  for (let i = 0; i < n; i++) {
    corner.set(corners, i * 8);
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  // position 只是给 Three 一个顶点数；真正的位置由顶点着色器算
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  for (const [name, attr] of Object.entries(opts.attributes)) {
    const size = Math.min(4, Math.max(1, Math.floor(attr.size)));
    const data = new Float32Array(n * 4 * size);
    for (let i = 0; i < n; i++) {
      for (let v = 0; v < 4; v++) {
        for (let k = 0; k < size; k++) data[(i * 4 + v) * size + k] = attr.data[i * size + k] ?? 0;
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({ uniforms: opts.uniforms, vertexShader: opts.vertex, fragmentShader: opts.fragment, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder ?? 0;
  ctx.scene.add(mesh);
  return {
    mesh,
    material,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * 粒子的出生时刻和寿命收进 [first, last]：出生不早于 first，死亡不晚于 last（首末帧前后一个粒子都不留）。
 * 出生太晚、剩下的时间不到 minLife 的往前挪；时间窗本身比 minLife 还短时寿命就是整个时间窗。
 */
export function fitLife(birth: number, life: number, first: number, last: number, minLife = 0.05): { birth: number; life: number } {
  const span = Math.max(0, last - first);
  const min = Math.min(minLife, span);
  const b = Math.min(Math.max(birth, first), last - min);
  return { birth: b, life: Math.max(min, Math.min(life, last - b)) };
}
