// 闭式的方块碎屑、粒子（第 3 批加入，docs/templates/batch-3.md）：一组朝向相机的小方片，每片取某张贴图里的一小块。
// 出生时刻、初速度、寿命都在 setup 里用 ctx.random 定好；位置由顶点着色器按 uTime 用闭式算（重力加线性阻力），
// update 里只改一个 uniform，不做逐帧积分（硬性规则 2）。一组粒子一次绘制，最多 8 张贴图。
import type { SetupContext } from '@allay/template-sdk';

type Three = SetupContext['THREE'];
type Texture = InstanceType<Three['Texture']>;
type Object3D = InstanceType<Three['Object3D']>;

export interface DebrisParticle {
  /** 出生位置（设计单位）和初速度（设计单位 / 秒） */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 出生时刻、寿命（秒）；年龄在 [0, life] 之外不画 */
  birth: number;
  life: number;
  /** 边长（设计单位） */
  size: number;
  /** 贴图里的一块：左上角 (u0, v0)、边长 uvSize，都按 0–1、v 从上往下 */
  u0: number;
  v0: number;
  uvSize: number;
  /** 用 textures 里的第几张 */
  texture: number;
  /** 染色（线性 RGB，0–1）；不给时是白色 */
  tint?: readonly [number, number, number];
  /** 绕视线方向的初始角（弧度）和角速度（弧度 / 秒） */
  angle?: number;
  spin?: number;
}

export interface DebrisOptions {
  /** 重力加速度（设计单位 / 秒²，向下为正） */
  gravity: number;
  /** 线性阻力（1 / 秒）：速度按 e^(−drag × 年龄) 衰减 */
  drag: number;
  /** 寿命最后这一段（占寿命的比例）里边长缩到 0；0 表示到时直接消失（同游戏里的粒子） */
  shrink?: number;
  /** 左右摆动（飘落的树叶）：x 方向加 amplitude × sin(2π × frequency × 年龄 + 初始角)，设计单位、赫兹 */
  sway?: { amplitude: number; frequency: number };
  renderOrder?: number;
}

export interface Debris {
  object: Object3D;
  count: number;
  setTime(t: number): void;
  dispose(): void;
}

export const MAX_DEBRIS_TEXTURES = 8;

/**
 * 一片碎屑在时刻 t 的位置（顶点着色器里同一个闭式的 CPU 版本，测试和需要知道落点的模板用）；不在寿命里时是 null。
 * dv/dt = a − drag × v，a = (0, −gravity, 0)：v = v0 e^(−k τ) + a / k (1 − e^(−k τ))，位置是它对 τ 的积分。
 */
export function debrisPosition(p: Pick<DebrisParticle, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'birth' | 'life' | 'angle'>, t: number, opts: Pick<DebrisOptions, 'gravity' | 'drag' | 'sway'>): [number, number, number] | null {
  const age = t - p.birth;
  if (age < 0 || age > p.life) return null;
  const k = Math.max(1e-3, opts.drag);
  const e = 1 - Math.exp(-k * age);
  const ay = -opts.gravity;
  const sway = opts.sway ? opts.sway.amplitude * Math.sin(2 * Math.PI * opts.sway.frequency * age + (p.angle ?? 0)) : 0;
  return [p.x + p.vx * (e / k) + sway, p.y + (p.vy - ay / k) * (e / k) + (ay / k) * age, p.z + p.vz * (e / k)];
}

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uDrag;
uniform float uShrink;
uniform vec2 uSway;
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aMeta;
attribute vec4 aRect;
attribute vec4 aTint;
varying vec2 vUv;
varying vec3 vTint;
flat varying float vTex;
void main() {
  float age = uTime - aMeta.x;
  if (age < 0.0 || age > aMeta.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // dv/dt = a − k v：v = v0 e^(−k τ) + a / k (1 − e^(−k τ))，位置是它的积分
  float k = uDrag;
  float e = 1.0 - exp(-k * age);
  vec3 a = vec3(0.0, -uGravity, 0.0);
  vec3 p = aPos + (aVel - a / k) * (e / k) + (a / k) * age;
  p.x += uSway.x * sin(6.28318530718 * uSway.y * age + aTint.w);
  float s = aMeta.z;
  if (uShrink > 0.0) s *= clamp((aMeta.y - age) / (uShrink * aMeta.y), 0.0, 1.0);
  float ang = aTint.w + aRect.w * age;
  vec2 c = position.xy;
  vec2 r = vec2(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  mv.xy += r * s;
  gl_Position = projectionMatrix * mv;
  // 贴图的 v = 1 是顶部（引擎在 CPU 上翻过行）
  vUv = vec2(aRect.x + uv.x * aRect.z, 1.0 - (aRect.y + (1.0 - uv.y) * aRect.z));
  vTint = aTint.rgb;
  vTex = aMeta.w;
}
`;

/** 片元着色器：n 张贴图，按每片的序号选一张；动画贴图的帧偏移由引擎改在贴图的 offset / repeat 上，这里照着用 */
function fragment(n: number): string {
  const decl: string[] = [];
  const pick: string[] = [];
  for (let i = 0; i < n; i++) {
    decl.push(`uniform sampler2D uTex${i};\nuniform vec2 uOff${i};\nuniform vec2 uRep${i};`);
    const sample = `c = textureGrad(uTex${i}, uOff${i} + vUv * uRep${i}, dx * uRep${i}, dy * uRep${i});`;
    pick.push(i === n - 1 ? `{ ${sample} }` : `if (vTex < ${i}.5) { ${sample} } else `);
  }
  return /* glsl */ `
${decl.join('\n')}
varying vec2 vUv;
varying vec3 vTint;
flat varying float vTex;
void main() {
  // 导数在分支外面取：相邻两片的序号不同时，分支里的隐式导数没有定义
  vec2 dx = dFdx(vUv);
  vec2 dy = dFdy(vUv);
  vec4 c = vec4(0.0);
  ${pick.join('')}
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb * vTint, 1.0);
}
`;
}

/**
 * 建一组碎屑。textures 是引擎给的贴图（方块面、粒子贴图），只读不改；particles 为空时返回一个空的对象。
 * 不透明（抠图），不进透明队列，所以不受排序影响。
 */
export function createDebris(ctx: SetupContext, textures: readonly Texture[], particles: readonly DebrisParticle[], opts: DebrisOptions): Debris {
  const { THREE } = ctx;
  const n = particles.length;
  if (n === 0 || textures.length === 0) {
    const empty = new THREE.Object3D();
    return { object: empty, count: 0, setTime: () => undefined, dispose: () => undefined };
  }
  const slots = textures.slice(0, MAX_DEBRIS_TEXTURES);
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const meta = new Float32Array(n * 4);
  const rect = new Float32Array(n * 4);
  const tint = new Float32Array(n * 4);
  particles.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    vel.set([p.vx, p.vy, p.vz], i * 3);
    meta.set([p.birth, Math.max(0, p.life), p.size, Math.min(slots.length - 1, Math.max(0, Math.round(p.texture)))], i * 4);
    rect.set([p.u0, p.v0, p.uvSize, p.spin ?? 0], i * 4);
    const c = p.tint ?? [1, 1, 1];
    tint.set([c[0], c[1], c[2], p.angle ?? 0], i * 4);
  });
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
  geometry.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
  geometry.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 4));
  geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4));
  const uniforms: Record<string, { value: unknown }> = {
    uTime: { value: -1 },
    uGravity: { value: opts.gravity },
    uDrag: { value: Math.max(1e-3, opts.drag) },
    uShrink: { value: Math.min(1, Math.max(0, opts.shrink ?? 0)) },
    uSway: { value: new THREE.Vector2(opts.sway?.amplitude ?? 0, opts.sway?.frequency ?? 0) },
  };
  slots.forEach((tex, i) => {
    uniforms[`uTex${i}`] = { value: tex };
    // 引用引擎贴图自己的 offset / repeat（动画贴图每个子帧由引擎改），只读
    uniforms[`uOff${i}`] = { value: tex.offset };
    uniforms[`uRep${i}`] = { value: tex.repeat };
  });
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: fragment(slots.length), side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder ?? 0;
  return {
    object: mesh,
    count: n,
    setTime(t: number) {
      uniforms.uTime!.value = t;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
