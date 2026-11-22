// 007 挖掘裂纹 allay.builtin.mining-crack（docs/templates/mining-crack.md）。
// 进入：方块按“放置顺序”一块块放出来砌成墙；退出：每块方块的裂纹从 0 级走到 9 级，然后碎成带这块方块贴图的碎屑落下。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { arrangeCells, toArrangement } from '../../_lib/src/block-arrangement';
import { createDebris, type DebrisParticle } from '../../_lib/src/block-debris';
import { blockList, clamp01, cuePosition, depthScale, groupByKind, jittered, kindInstances, orderValues, sampleCueIndices, srgbToLinear, wallGrid, type BlockEntry } from '../../_lib/src/block-kit';
import { num, rgbOf } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import {
  BREAK_ORDERS,
  breakTiming,
  builderOrder,
  CRACK_STAGES,
  crackStage,
  DEBRIS_DRAG,
  DEBRIS_GRAVITY,
  debrisPerBlock,
  debrisVelocity,
  hitTimes,
  PLACE_ORDERS,
  placeScale,
  POP_TIME,
  type BreakOrder,
  type PlaceOrder,
} from './layout';

const DEFAULT_BLOCKS: readonly BlockEntry[] = [
  { id: 'minecraft:stone', weight: 12 },
  { id: 'minecraft:andesite', weight: 3 },
  { id: 'minecraft:coal_ore', weight: 1 },
  { id: 'minecraft:iron_ore', weight: 1 },
];

/** 碎屑用哪个面的贴图：草方块一类的碎屑在游戏里是泥土（底面），其余取侧面 */
const DOWN_PARTICLE = new Set(['minecraft:grass_block', 'minecraft:podzol', 'minecraft:mycelium', 'minecraft:crimson_nylium', 'minecraft:warped_nylium']);
/** 着色的树叶：碎屑也带树叶的颜色（方块目录的 foliage 常量，packages/assets/data/tints.json） */
const FOLIAGE: Readonly<Record<string, string>> = {
  'minecraft:oak_leaves': '#77AB2F',
  'minecraft:jungle_leaves': '#77AB2F',
  'minecraft:acacia_leaves': '#77AB2F',
  'minecraft:dark_oak_leaves': '#77AB2F',
  'minecraft:mangrove_leaves': '#77AB2F',
  'minecraft:spruce_leaves': '#619961',
  'minecraft:birch_leaves': '#80A755',
};
/** 游戏里方块碎屑的颜色乘 0.6（sRGB） */
const DEBRIS_SHADE = 0.6;

const CRACK_VERTEX = /* glsl */ `
attribute float aStage;
varying vec2 vUv;
flat varying float vStage;
void main() {
  vStage = aStage;
  if (aStage < -0.5 || aStage > 9.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vUv = uv;
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
}
`;

function crackFragment(): string {
  const decl = Array.from({ length: CRACK_STAGES }, (_, i) => `uniform sampler2D uS${i};`).join('\n');
  const pick = Array.from({ length: CRACK_STAGES }, (_, i) => {
    const s = `c = textureGrad(uS${i}, vUv, dx, dy);`;
    return i === CRACK_STAGES - 1 ? `{ ${s} }` : `if (vStage < ${i}.5) { ${s} } else `;
  }).join('');
  return /* glsl */ `
${decl}
varying vec2 vUv;
flat varying float vStage;
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 dx = dFdx(vUv);
  vec2 dy = dFdy(vUv);
  vec4 c = vec4(0.0);
  ${pick}
  if (c.a < 0.1) discard;
  // 游戏里裂纹的混合是“2 × 裂纹 × 底下的颜色”（sRGB 空间）。引擎要求普通混合（02-engine.md 2.6），
  // 所以变暗的像素画成黑色、不透明度 1 − m^2.2（线性空间里乘 m^2.2，约等于 sRGB 空间里乘 m）；
  // 变亮的像素普通混合做不出“乘”，用白色、小的不透明度近似。
  float m = 2.0 * dot(toSrgb(c.rgb), vec3(1.0 / 3.0));
  if (m < 1.0) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - pow(max(m, 0.0), 2.2));
  else gl_FragColor = vec4(1.0, 1.0, 1.0, clamp((pow(m, 2.2) - 1.0) * 0.22, 0.0, 0.5));
}
`;
}

const toPlaceOrder = (v: ParamValue | undefined): PlaceOrder => (typeof v === 'string' && (PLACE_ORDERS as readonly string[]).includes(v) ? (v as PlaceOrder) : 'buildUp');
const toBreakOrder = (v: ParamValue | undefined): BreakOrder => (typeof v === 'string' && (BREAK_ORDERS as readonly string[]).includes(v) ? (v as BreakOrder) : 'random');

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const cols = Math.round(num(params.cols, 10));
    const placeOrder = toPlaceOrder(params.placeOrder);
    const breakOrder = toBreakOrder(params.breakOrder);
    const crackTime = num(params.crackTime, 0.3);
    const debrisParam = num(params.debris, 8);
    const volume = num(params.volume, 0.6);
    const win = transitionWindows(stage.fps, num(params.inDuration, 0.6), num(params.hold, 0.15), num(params.outDuration, 1.1));
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;

    // 透视相机（fov 30）和面明暗，同 block-wipe 的 3d 样式：碎屑飞起来有前后
    const camera = ctx.createStageCamera({ fov: 30 });
    ctx.setCamera(camera);
    const camZ = camera.position.z;

    const grid = wallGrid(W, H, cols);
    const { size: s, count, px, py } = grid;
    const noise = (x: number, y: number) => ctx.noise2D(x, y, 'order');

    // 放置的先后（0 最先）。centerOut、diagonal 加一点错落，避免一圈圈同时出现
    let uPlace: Float64Array;
    if (placeOrder === 'buildUp' || placeOrder === 'columns') uPlace = builderOrder(placeOrder, grid.cols, grid.rows);
    else {
      const r = ctx.random('place');
      const base = orderValues(placeOrder, px, py, W, H, () => r.next(), noise);
      uPlace = placeOrder === 'random' ? base : jittered(base, 0.15, () => r.next());
    }

    // 挖掘的先后
    const rb = ctx.random('break');
    let uBreak: Float64Array;
    if (breakOrder === 'reverse') uBreak = uPlace.map((u) => 1 - u);
    else if (breakOrder === 'together') uBreak = Float64Array.from({ length: count }, () => rb.next());
    else uBreak = jittered(orderValues(breakOrder, px, py, W, H, () => rb.next(), noise), breakOrder === 'random' ? 0 : 0.12, () => rb.next());

    // 时间：放置在进入阶段里铺开（最后一块恰好在阶段末落定）；挖掘见 layout.ts 的 breakTiming
    const pop = Math.min(POP_TIME, inLen / 2);
    const placeAt = Float64Array.from(uPlace, (u) => win.in.start + u * (inLen - pop));
    const timing = breakTiming(outLen, crackTime, breakOrder === 'together');
    const breakStart = Float64Array.from(uBreak, (u) => win.out.start + u * timing.spread);
    const brokenAt = Float64Array.from(breakStart, (b) => b + timing.crack);

    // 方块：每个格子放哪种由“方块排列”决定（block-arrangement，同 block-wipe）；每种一组实例
    const entries = blockList(params.blocks, DEFAULT_BLOCKS);
    const arranged = arrangeCells(toArrangement(params.arrangement), entries, grid.cols, grid.rows, ctx.random('blocks'));
    const groups = groupByKind(entries, arranged);
    const instances = await kindInstances(ctx, groups, true);

    // 垫底：每格方块后面一块不透明的方片，和方块一起出现、一起碎掉（镂空、半透明的方块在剪辑点也不透明）
    const backingGeometry = new THREE.PlaneGeometry(1, 1);
    const backingMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgbOf(params.backing, '#1E1F22')) });
    const backing = new THREE.InstancedMesh(backingGeometry, backingMaterial, count);
    backing.frustumCulled = false;
    backing.renderOrder = 1;
    scene.add(backing);

    // 裂纹：每块方块外面套一个略大的立方体，着色器按这块的级数取 destroy_stage_0 … 9。
    // 十张都是可选贴图：缺任何一张（没有原版素材、资源包不全）就不画裂纹，方块到时候直接碎成碎屑，不记警告
    // 用 Object.fromEntries 建 uniform 表：打包后的 JS 没有类型标注，空对象再逐个加键在 checkJs 下推不出索引签名
    const crackEntries: [string, { value: unknown }][] = [];
    let crackComplete = true;
    for (let k = 0; k < CRACK_STAGES; k++) {
      const texture = await ctx.resources.texture(`minecraft:block/destroy_stage_${k}`, { optional: true });
      if (!texture) crackComplete = false;
      crackEntries.push([`uS${k}`, { value: texture }]);
    }
    const crackUniforms = Object.fromEntries(crackEntries);
    const crackGeometry = new THREE.BoxGeometry(1, 1, 1);
    const stageAttr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1), 1);
    crackGeometry.setAttribute('aStage', stageAttr);
    const crackMaterial = new THREE.ShaderMaterial({ uniforms: crackUniforms, vertexShader: CRACK_VERTEX, fragmentShader: crackFragment(), transparent: true, depthWrite: false });
    const cracks = new THREE.InstancedMesh(crackGeometry, crackMaterial, count);
    cracks.frustumCulled = false;
    cracks.renderOrder = 3;
    if (crackComplete) scene.add(cracks);

    // 碎屑：每块方块碎时迸出 n 片，取这块方块贴图里随机的 1/4 × 1/4（同游戏），受重力和阻力
    const perBlock = debrisPerBlock(debrisParam, count);
    const debrisTextures = [];
    for (const id of groups.kinds) debrisTextures.push((await ctx.resources.block(id, { shading: false })).faceTexture(DOWN_PARTICLE.has(id) ? 'down' : 'south'));
    const shade = srgbToLinear(DEBRIS_SHADE);
    const kindTint = groups.kinds.map((id): [number, number, number] => {
      const c = new THREE.Color(FOLIAGE[id] ?? '#FFFFFF');
      return [c.r * shade, c.g * shade, c.b * shade];
    });
    const particles: DebrisParticle[] = [];
    const rd = ctx.random('debris');
    for (let i = 0; i < count && perBlock > 0; i++) {
      const birth = brokenAt[i]!;
      const remaining = win.out.end - birth;
      for (let j = 0; j < perBlock; j++) {
        // 出生点在方块里（偏向朝相机的一半，碎屑不被身后的墙挡住）
        const ox = rd.next() - 0.5;
        const oy = rd.next() - 0.5;
        const oz = rd.next() * 0.5;
        const [vx, vy, vz] = debrisVelocity(ox, oy, oz, [rd.next(), rd.next(), rd.next(), rd.next(), rd.next()]);
        // 寿命照游戏的分布 4 / (r × 0.9 + 0.1) 刻（至少 5 刻），不超过阶段剩下的时间
        const life = Math.min(remaining - 1e-3, Math.max(0.25, 4 / (rd.next() * 0.9 + 0.1) / 20), timing.life);
        particles.push({
          x: px[i]! + ox * s,
          y: py[i]! + oy * s,
          z: oz * s,
          vx: vx * s,
          vy: vy * s,
          vz: vz * s,
          birth,
          life,
          size: s * (0.1 + 0.1 * rd.next()),
          u0: rd.next() * 0.75,
          v0: rd.next() * 0.75,
          uvSize: 0.25,
          texture: groups.cellKind[i]!,
          tint: kindTint[groups.cellKind[i]!]!,
        });
      }
    }
    const debris = createDebris(ctx, debrisTextures, particles, { gravity: DEBRIS_GRAVITY * s, drag: DEBRIS_DRAG, shrink: 0.25, renderOrder: 2 });
    scene.add(debris.object);

    // 音效：放置、敲击、碎裂各自最多 12 个 cue，按时刻均匀抽样（block-wipe 的做法）。
    // 音量和音高照游戏：放置、碎裂 1.0、0.8 倍音高；挖掘时每 4 刻敲一下，音量 0.25、0.5 倍音高（凭记忆）
    const cue = (sound: ParamValue | undefined, times: number[], cells: number[], gain: number, rate: number) => {
      if (typeof sound !== 'string') return;
      for (const k of sampleCueIndices(times)) {
        const i = cells[k]!;
        ctx.audio.cue(sound, times[k]!, { gain: volume * gain, rate, position: cuePosition(px[i]!, py[i]!, W) });
      }
    };
    const all = Array.from({ length: count }, (_, i) => i);
    cue(params.placeSound, Array.from(placeAt), all, 1, 0.8);
    const hitT: number[] = [];
    const hitCell: number[] = [];
    for (let i = 0; i < count; i++) {
      for (const t of hitTimes(breakStart[i]!, timing.crack)) {
        hitT.push(t);
        hitCell.push(i);
      }
    }
    cue(params.hitSound, hitT, hitCell, 0.25, 0.5);
    cue(params.breakSound, Array.from(brokenAt), all, 1, 0.8);

    // update 里复用的对象（update 内不分配内存）
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const backOut = ctx.ease.backOut;
    const stages = stageAttr.array;

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        for (let i = 0; i < count; i++) {
          let k = 1;
          let lift = 0;
          let crack = -1;
          if (entering) {
            const p = clamp01((t - placeAt[i]!) / pop);
            k = t < placeAt[i]! ? 0 : placeScale(p, backOut);
            // 弹出时朝相机抬起一点，落定后回到墙面，免得和邻居的面重合闪烁（同 block-wipe）
            if (p > 0 && p < 1) lift = (1 - p) * s * 0.35;
          } else {
            crack = crackStage(t, breakStart[i]!, timing.crack);
            if (crack >= CRACK_STAGES) k = 0;
          }
          pos.set(px[i]!, py[i]!, lift);
          scl.setScalar(k * s);
          m.compose(pos, quat, scl);
          instances[groups.cellKind[i]!]!.setMatrix(groups.cellIndex[i]!, m);
          // 垫底贴在方块背面，按透视放大到和方块中间的截面一样大：镂空的方块（玻璃、树叶）在画面边上也透不出垫底外面
          const zb = lift - (k * s) / 2 + 0.5;
          const f = depthScale(camZ, lift, zb);
          pos.set(px[i]! * f, py[i]! * f, zb);
          scl.set(k * s * f, k * s * f, 1);
          m.compose(pos, quat, scl);
          backing.setMatrixAt(i, m);
          // 裂纹套在方块外面（大一点点）
          pos.set(px[i]!, py[i]!, lift);
          scl.setScalar(k * s * 1.004);
          m.compose(pos, quat, scl);
          cracks.setMatrixAt(i, m);
          stages[i] = k > 0 ? crack : -1;
        }
        for (const g of instances) g?.commit();
        backing.instanceMatrix.needsUpdate = true;
        cracks.instanceMatrix.needsUpdate = true;
        stageAttr.needsUpdate = true;
        debris.setTime(t);
      },
      dispose() {
        backingGeometry.dispose();
        backingMaterial.dispose();
        crackGeometry.dispose();
        crackMaterial.dispose();
        debris.dispose();
      },
    };
  },
};

export default template;
