// 015 幽匿蔓延 allay.builtin.sculk-spread（docs/templates/sculk-spread.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 起点是几个幽匿催发体（block/sculk_catalyst_top_bloom，带动画），幽匿一格格成片蔓延：还没变的格子先从已经变了的邻格那边
// 爬进脉络（block/sculk_vein），然后整格变成幽匿（block/sculk，带动画），变的那一下闪一下青光；铺满后明暗一阵阵从起点往外脉动。
// 退出时最后长出来的先退，脉络留一会儿，灵魂（particle/sculk_soul_0–10，11 帧）从退去的格子里飘上来。
// 每格变成幽匿的先后在 setup 里按带随机权重的最短路算好（layout.ts），存进一张阈值贴图；着色器只读它和 uniform。
// 和像素溶解（T5）的区别：成片连着长，边缘是爬进来的脉络而不是一圈强调色，铺满后还有脉动，退出带灵魂粒子。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { sampleIndices } from '../../_lib/src/cues';
import { num } from '../../_lib/src/gui-kit';
import { frameUniforms, GLSL_COMMON, linearColor, optionalTexture, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { fitLife, particleBatch } from '../../_lib/src/shader-particles';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { convertAt, LINGER, recedeAt, recedeThreshold, seedCells, spreadThreshold, spreadTimes } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform sampler2D uTimes;
uniform vec2 uGrid;
uniform vec2 uOrigin;
uniform float uTile;
uniform float uA;
uniform float uB;
uniform float uLeaving;
uniform float uLead;
uniform float uLinger;
uniform float uTime;
uniform float uPulse;
uniform float uVeinWidth;
uniform sampler2D uSculk;
uniform vec2 uSculkOff;
uniform vec2 uSculkRep;
uniform float uHasSculk;
uniform sampler2D uVein;
uniform vec2 uVeinOff;
uniform vec2 uVeinRep;
uniform float uHasVein;
uniform sampler2D uBloom;
uniform vec2 uBloomOff;
uniform vec2 uBloomRep;
uniform sampler2D uCatalyst;
uniform float uHasCatalyst;
uniform vec3 uBase;
uniform vec3 uGlow;
uniform float uSeed;
varying vec2 vPos;

float timeAt(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uGrid.x) || c.y >= int(uGrid.y)) return 2.0;
  return texelFetch(uTimes, c, 0).r;
}

/** 一格幽匿：贴图（没有时按格子深浅的底色），起点是催发体 */
vec3 sculkAt(vec2 g, ivec2 c, float s) {
  vec3 col;
  if (s < 1e-6 && uHasCatalyst > 0.5) {
    col = uLeaving < 0.5 ? tileFrame(uBloom, uBloomOff, uBloomRep, g).rgb : texture2D(uCatalyst, fract(g)).rgb;
  } else if (uHasSculk > 0.5) {
    col = tileFrame(uSculk, uSculkOff, uSculkRep, g).rgb;
  } else {
    col = uBase * (0.8 + 0.4 * rand2(c, uint(uSeed)));
    if (s < 1e-6) col = mix(col, uGlow, step(max(abs(fract(g.x) - 0.5), abs(fract(g.y) - 0.5)), 0.18) * 0.8);
  }
  return col;
}

/** 脉络的遮罩（0 / 1）：贴图的不透明像素；没有贴图时是几条带抖动的细线 */
float veinAt(vec2 g, ivec2 c) {
  float m;
  if (uHasVein > 0.5) {
    m = step(0.5, tileFrame(uVein, uVeinOff, uVeinRep, g).a);
  } else {
    vec2 f = fract(g);
    float j = rand2(c, uint(uSeed) ^ 0x3cu);
    float a = abs(f.y - 0.5 - 0.18 * sin(f.x * 6.2832 + j * 6.0));
    float b = abs(f.x - 0.5 - 0.18 * sin(f.y * 6.2832 + j * 9.0));
    m = step(min(a, b), 0.05);
  }
  return m;
}

void main() {
  vec2 g = (vPos - uOrigin) / uTile;
  ivec2 c = ivec2(floor(g));
  vec2 f = fract(g);
  float s = timeAt(c);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  if (uLeaving < 0.5) {
    if (s < uA) {
      col = sculkAt(g, c, s);
      // 刚变成幽匿的那一下亮一下：贴图本身变亮（亮点亮得多），再带一点青光
      float flash = exp(-(uA - s) / 0.02);
      col = col * (1.0 + 2.2 * flash) + uGlow * 0.12 * flash;
      // 明暗脉动：一圈圈从起点往外走，越亮的像素（幽匿上的亮点）亮得越多
      float wave = fract(uTime * 0.85) * 1.5 - 0.25;
      float pulse = uPulse * (0.35 + 0.65 * exp(-pow((s - wave) / 0.09, 2.0)));
      pulse *= 0.5 + 0.5 * sin(uTime * 5.3);
      col *= 1.0 + pulse * (0.4 + 2.5 * luma(col));
      alpha = 1.0;
    } else {
      // 脉络从已经变成幽匿的邻格那一边爬进来：离那条边的距离小于它变了多久
      float reach = 0.0;
      float l = timeAt(c + ivec2(-1, 0));
      float r = timeAt(c + ivec2(1, 0));
      float d = timeAt(c + ivec2(0, -1));
      float u = timeAt(c + ivec2(0, 1));
      if (l < uA && f.x < (uA - l) / uLead * uVeinWidth) reach = 1.0;
      if (r < uA && 1.0 - f.x < (uA - r) / uLead * uVeinWidth) reach = 1.0;
      if (d < uA && f.y < (uA - d) / uLead * uVeinWidth) reach = 1.0;
      if (u < uA && 1.0 - f.y < (uA - u) / uLead * uVeinWidth) reach = 1.0;
      if (reach > 0.5 && veinAt(g, c) > 0.5) {
        col = uHasVein > 0.5 ? tileFrame(uVein, uVeinOff, uVeinRep, g).rgb : uGlow * 0.7;
        alpha = 1.0;
      }
    }
  } else {
    // 退去：最后长出来的先退（1 − s 小的先），退了以后脉络还留 uLinger
    float order = 1.0 - s;
    if (order >= uB) {
      col = sculkAt(g, c, s);
      float wave = fract(uTime * 0.85) * 1.5 - 0.25;
      float pulse = uPulse * (0.35 + 0.65 * exp(-pow((s - wave) / 0.09, 2.0))) * (0.5 + 0.5 * sin(uTime * 5.3));
      col *= 1.0 + pulse * (0.4 + 2.5 * luma(col));
      alpha = 1.0;
    } else if (uB - order < uLinger && veinAt(g, c) > 0.5) {
      col = uHasVein > 0.5 ? tileFrame(uVein, uVeinOff, uVeinRep, g).rgb : uGlow * 0.7;
      alpha = 1.0 - (uB - order) / uLinger;
    }
  }
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const SOUL_VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aA;
attribute vec4 aB;
uniform float uTime;
uniform float uTexel;
varying vec2 vCorner;
varying float vAge;
void main() {
  float age = uTime - aA.z;
  vAge = age / aA.w;
  vCorner = aCorner;
  if (age < 0.0 || age > aA.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 pos = aA.xy + vec2(sin(age * 3.0 + aB.w * 6.2832) * aB.x, aB.y * age);
  pos = (floor(pos / uTexel) + 0.5) * uTexel;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + aCorner * aB.z, 0.0, 1.0);
}
`;

const SOUL_FRAGMENT = /* glsl */ `
uniform sampler2D uS0; uniform sampler2D uS1; uniform sampler2D uS2; uniform sampler2D uS3;
uniform sampler2D uS4; uniform sampler2D uS5; uniform sampler2D uS6; uniform sampler2D uS7;
uniform sampler2D uS8; uniform sampler2D uS9; uniform sampler2D uS10;
uniform float uHasSoul;
uniform vec3 uGlow;
varying vec2 vCorner;
varying float vAge;
void main() {
  vec2 uv = vCorner + 0.5;
  vec4 c;
  if (uHasSoul > 0.5) {
    // 11 帧，寿命里均匀走完（游戏里这个粒子也是一次放完）
    int k = int(clamp(floor(vAge * 11.0), 0.0, 10.0));
    if (k == 0) c = texture2D(uS0, uv);
    else if (k == 1) c = texture2D(uS1, uv);
    else if (k == 2) c = texture2D(uS2, uv);
    else if (k == 3) c = texture2D(uS3, uv);
    else if (k == 4) c = texture2D(uS4, uv);
    else if (k == 5) c = texture2D(uS5, uv);
    else if (k == 6) c = texture2D(uS6, uv);
    else if (k == 7) c = texture2D(uS7, uv);
    else if (k == 8) c = texture2D(uS8, uv);
    else if (k == 9) c = texture2D(uS9, uv);
    else c = texture2D(uS10, uv);
  } else {
    float r = length(vCorner) * 2.0;
    c = vec4(uGlow, (1.0 - smoothstep(0.35, 0.6, r)) * (1.0 - vAge * 0.6));
  }
  float a = c.a * (1.0 - smoothstep(0.8, 1.0, vAge));
  if (a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const inDuration = num(params.inDuration, 1);
    const hold = num(params.hold, 0.25);
    const outDuration = num(params.outDuration, 0.9);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const volume = num(params.volume, 0.7);
    const tile = Math.max(30, num(params.blockSize, 135));

    // 格子：行列向上取整，多一圈，居中
    const cols = Math.ceil(W / tile) + 1;
    const rows = Math.ceil(H / tile) + 1;
    const originX = (-cols * tile) / 2;
    const originY = (-rows * tile) / 2;
    const n = cols * rows;
    // 起点：一个时在正中，多个时铺开（layout.ts 的 seedCells）
    const seedCount = Math.max(1, Math.min(8, Math.round(num(params.seeds, 3))));
    const seeds = seedCells(cols, rows, seedCount, ctx.random('seeds'));
    const spread = spreadTimes(cols, rows, seeds, ctx.random('spread'));
    const times = spread.times;
    const timeTex = new THREE.DataTexture(times, cols, rows, THREE.RedFormat, THREE.FloatType);
    timeTex.magFilter = THREE.NearestFilter;
    timeTex.minFilter = THREE.NearestFilter;
    timeTex.generateMipmaps = false;
    timeTex.needsUpdate = true;

    const sculk = await optionalTexture(ctx, ['minecraft:block/sculk']);
    const vein = await optionalTexture(ctx, ['minecraft:block/sculk_vein']);
    const bloom = await optionalTexture(ctx, ['minecraft:block/sculk_catalyst_top_bloom']);
    const catalyst = await optionalTexture(ctx, ['minecraft:block/sculk_catalyst_top']);
    const fs = frameUniforms(ctx, sculk);
    const fv = frameUniforms(ctx, vein);
    const fb = frameUniforms(ctx, bloom);
    const glow = linearColor(ctx, params.glowColor, '#29DFEB');
    const u = {
      uTimes: { value: timeTex },
      uGrid: { value: new THREE.Vector2(cols, rows) },
      uOrigin: { value: new THREE.Vector2(originX, originY) },
      uTile: { value: tile },
      uA: { value: -1 },
      uB: { value: -1 },
      uLeaving: { value: 0 },
      // 脉络爬过一格要多久（阈值的单位）：一条平均的边
      uLead: { value: spread.unit * 1.1 },
      uLinger: { value: LINGER },
      uTime: { value: 0 },
      uPulse: { value: num(params.pulse, 0.5) },
      uVeinWidth: { value: num(params.veinWidth, 1) },
      uSculk: { value: sculk },
      uSculkOff: fs.off,
      uSculkRep: fs.rep,
      uHasSculk: { value: sculk ? 1 : 0 },
      uVein: { value: vein },
      uVeinOff: fv.off,
      uVeinRep: fv.rep,
      uHasVein: { value: vein ? 1 : 0 },
      uBloom: { value: bloom },
      uBloomOff: fb.off,
      uBloomRep: fb.rep,
      uCatalyst: { value: catalyst },
      uHasCatalyst: { value: bloom && catalyst ? 1 : 0 },
      uBase: { value: linearColor(ctx, '#0B1E26', '#0B1E26') },
      uGlow: { value: glow },
      uSeed: { value: shaderSeed(params.seed) },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    const easeAt = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : ease(x));
    // 缓动后的进度第一次到 target 的阶段进度（先粗扫再二分，缓动不一定单调）
    const invert = (target: number) => {
      let lo = 0;
      for (let k = 1; k <= 64; k++) {
        if (easeAt(k / 64) >= target) {
          let a = lo;
          let b = k / 64;
          for (let m = 0; m < 24; m++) {
            const mid = (a + b) / 2;
            if (easeAt(mid) >= target) b = mid;
            else a = mid;
          }
          return b;
        }
        lo = k / 64;
      }
      return 1;
    };
    const cellX = (i: number) => originX + ((i % cols) + 0.5) * tile;
    const cellY = (i: number) => originY + (Math.floor(i / cols) + 0.5) * tile;

    // 灵魂：从随机的几格里，在它退去的时候飘上来；退出阶段结束前全部消失
    const count = Math.max(0, Math.round(num(params.particles, 26)));
    const prng = ctx.random('souls');
    const aA = new Float32Array(Math.max(1, count) * 4);
    const aB = new Float32Array(Math.max(1, count) * 4);
    const outLen = win.out.end - win.out.start;
    const last = win.out.end - 1e-3;
    for (let i = 0; i < count; i++) {
      const cell = Math.floor(prng.next() * n);
      const f = fitLife(win.out.start + invert(recedeAt(times[cell]!)) * outLen, 0.7 + prng.next() * 0.5, win.out.start, last);
      aA.set([cellX(cell) + (prng.next() - 0.5) * tile * 0.5, cellY(cell), f.birth, f.life], i * 4);
      aB.set([tile * (0.08 + prng.next() * 0.12), 120 + prng.next() * 140, tile * 0.62, prng.next()], i * 4);
    }
    const soulTex = count > 0 ? await Promise.all(Array.from({ length: 11 }, (_, k) => optionalTexture(ctx, [`minecraft:particle/sculk_soul_${k}`]))) : [];
    const hasSoul = soulTex.length === 11 && soulTex.every((x) => x !== null);
    const soulUniforms: Record<string, { value: unknown }> = { uTime: { value: 0 }, uTexel: { value: tile / 16 }, uHasSoul: { value: hasSoul ? 1 : 0 }, uGlow: { value: glow } };
    soulTex.forEach((tex, k) => {
      soulUniforms[`uS${k}`] = { value: tex };
    });
    const souls = count > 0 ? particleBatch(ctx, { count, attributes: { aA: { size: 4, data: aA }, aB: { size: 4, data: aB } }, vertex: SOUL_VERTEX, fragment: SOUL_FRAGMENT, uniforms: soulUniforms, renderOrder: 1 }) : null;
    const soulTime = soulUniforms.uTime!;

    // 音效：蔓延时在按先后均匀抽样的几格（最多 6 个，含最先和最后变的那一格）变成幽匿的时刻放，带位置：舞台半宽当作 8 格；
    // 退出开始时放一次
    const toBlocks = 8 / (W / 2);
    if (typeof params.spreadSound === 'string') {
      const order = Array.from(times, (_, i) => i).sort((a, b) => times[a]! - times[b]! || a - b);
      for (const j of sampleIndices(order.length, 6)) {
        const i = order[j]!;
        ctx.audio.cue(params.spreadSound, win.in.start + invert(convertAt(times[i]!)) * (win.in.end - win.in.start), { gain: volume, position: { x: cellX(i) * toBlocks, y: cellY(i) * toBlocks, z: -6 } });
      }
    }
    if (typeof params.bloomSound === 'string') ctx.audio.cue(params.bloomSound, win.in.start, { gain: volume });
    if (typeof params.recedeSound === 'string') ctx.audio.cue(params.recedeSound, win.out.start, { gain: volume });

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const leaving = t > win.cutTime;
        u.uLeaving.value = leaving ? 1 : 0;
        u.uA.value = spreadThreshold(eased(t, win.in, ease));
        u.uB.value = recedeThreshold(eased(t, win.out, ease));
        u.uTime.value = t;
        soulTime.value = t;
      },
      dispose() {
        quad.dispose();
        timeTex.dispose();
        souls?.dispose();
      },
    };
  },
};

export default template;
