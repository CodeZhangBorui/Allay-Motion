// 066 烧穿 allay.builtin.fire-burn（docs/templates/fire-burn.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 进入：一排火（block/fire_0、fire_1，带动画）从下往上烧，烧过的地方是焦黑的幕，火线下面一窄条还在发红；
// 退出：焦黑的幕从几处被烧出洞，洞的边缘按格子发光（白黄 → 橙 → 暗红），火星从烧穿的边上往上飘，直到烧光。
// 格子按火焰贴图的像素大小走，边缘是方的（和游戏的像素画一致）。烧穿的先后在 setup 里算成一张阈值贴图；
// 火星是 GPU 上按闭式算位置的粒子。贴图缺失时火苗用程序画的火舌代替。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num, str } from '../../_lib/src/gui-kit';
import { frameUniforms, GLSL_COMMON, linearColor, optionalTexture, outputPixel, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { fitLife, particleBatch } from '../../_lib/src/shader-particles';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { burnProgress, burnThreshold, frontAt, frontRange, normalize, type WaveTerm } from './layout';

/** 退出阶段正在发光的那一圈占阈值的宽度 */
const RIM = 0.06;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform float uIn;
uniform float uLeaving;
uniform float uP;
uniform float uRim;
uniform float uTime;
uniform float uTexel;
uniform float uTile;
uniform vec2 uOrigin;
uniform vec2 uGrid;
uniform sampler2D uBurn;
uniform float uFrontBase;
uniform float uAmp;
uniform vec4 uWaveK;
uniform vec4 uWaveP;
uniform vec4 uWaveA;
uniform sampler2D uFire0;
uniform vec2 uFire0Off;
uniform vec2 uFire0Rep;
uniform sampler2D uFire1;
uniform vec2 uFire1Off;
uniform vec2 uFire1Rep;
uniform float uHasFire;
uniform vec3 uChar;
uniform vec3 uHot;
uniform vec3 uWarm;
uniform vec3 uDeep;
uniform float uGlow;
uniform float uSeed;
varying vec2 vPos;

float waveAt(float x) {
  vec4 s = uWaveA * sin(uWaveK * x + uWaveP);
  return (s.x + s.y + s.z + s.w) / max(1e-4, dot(abs(uWaveA), vec4(1.0)));
}

/** 焦黑的幕：按格子有深浅，零星的格子还在暗暗地烧着 */
vec3 charAt(vec2 cell, uint seed) {
  float n = vnoise(cell / 3.0, seed) * 0.6 + rand2(ivec2(cell), seed ^ 0x55u) * 0.4;
  vec3 c = uChar * (0.72 + 0.56 * n);
  float h = rand2(ivec2(cell), seed ^ 0xe1u);
  if (h < 0.004) {
    float f = 0.5 + 0.5 * sin(uTime * (3.0 + h * 900.0) + h * 2600.0);
    c = mix(c, uDeep * 1.3, 0.25 + 0.3 * f);
  }
  return c;
}

/** 发光的颜色：k = 0 最亮（白黄），k = 1 落回焦黑 */
vec3 glowRamp(float k, vec3 base) {
  if (k < 0.25) return mix(uHot, uWarm, k / 0.25);
  if (k < 0.6) return mix(uWarm, uDeep, (k - 0.25) / 0.35);
  return mix(uDeep, base, (k - 0.6) / 0.4);
}

void main() {
  uint seed = uint(uSeed);
  vec2 g = (vPos - uOrigin) / uTexel;
  vec2 cell = floor(g);
  vec2 cc = (cell + 0.5) * uTexel + uOrigin;
  vec4 col = vec4(0.0);
  if (uLeaving < 0.5) {
    if (uIn <= 0.0) discard;
    // 火线：按格子取高度，上面是火苗，下面是焦黑的幕
    float front = uFrontBase + uAmp * waveAt(cc.x);
    front = floor(front / uTexel) * uTexel;
    float d = (front - cc.y) / uTexel;
    if (d > 0.0) {
      vec3 c = charAt(cell, seed);
      // 火线下面一窄条还红着
      float k = clamp((d - 0.5) / (5.0 * uGlow + 0.5), 0.0, 1.0);
      c = glowRamp(0.15 + 0.85 * k, c);
      col = pm(c, 1.0);
    } else {
      // 火苗：一格火焰贴图（tile × tile）立在火线上，0 号、1 号贴图交替；没有贴图时画程序的火舌
      float h = (vPos.y - front) / uTile;
      if (h < 1.0) {
        float column = floor((vPos.x - uOrigin.x) / uTile);
        vec2 f = vec2(fract((vPos.x - uOrigin.x) / uTile), h);
        if (uHasFire > 0.5) {
          vec4 s = mod(column, 2.0) < 1.0 ? tileFrame(uFire0, uFire0Off, uFire0Rep, f) : tileFrame(uFire1, uFire1Off, uFire1Rep, f);
          col = pm(s.rgb, s.a);
        } else {
          float x = cc.x / uTexel;
          float tongue = 0.35 + 0.65 * vnoise(vec2(x * 0.35, uTime * 6.0 + x * 0.1), seed ^ 0x77u);
          float top = tongue * (0.55 + 0.45 * vnoise(vec2(x * 0.11, uTime * 2.0), seed ^ 0x99u));
          float hh = ((cc.y - front) / uTile);
          if (hh < top) col = pm(glowRamp(clamp(hh / max(top, 1e-3), 0.0, 1.0) * 0.75, uChar), 1.0);
        }
      }
    }
  } else {
    // 烧穿：阈值低于 P 的格子烧没了；离 P 不到 uRim 的格子发光
    ivec2 ci = ivec2(clamp(cell, vec2(0.0), uGrid - 1.0));
    float hb = texelFetch(uBurn, ci, 0).r;
    if (hb < uP) discard;
    vec3 c = charAt(cell, seed);
    float k = (hb - uP) / uRim;
    if (k < 1.0) {
      float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + rand2(ci, seed) * 40.0);
      c = glowRamp(k / max(uGlow, 0.05), c) * flicker;
    }
    col = pm(c, 1.0);
  }
  if (col.a <= 0.0) discard;
  gl_FragColor = straight(col);
}
`;

const EMBER_VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aA;
attribute vec4 aB;
uniform float uTime;
uniform float uTexel;
varying float vAge;
varying float vSeed;
void main() {
  float life = aA.w;
  float age = (uTime - aA.z) / life;
  vAge = age;
  vSeed = aB.w;
  if (age < 0.0 || age > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float s = age * life;
  // 往上飘、越飘越慢，左右摆
  vec2 pos = aA.xy + vec2(aB.x * s + sin(s * 7.0 + aB.w * 6.2832) * uTexel * 0.8, aB.y * (1.0 - exp(-2.2 * s)) / 2.2 + 40.0 * s);
  pos = (floor(pos / (uTexel * 0.5)) + 0.5) * uTexel * 0.5;
  float size = aB.z * (1.0 - 0.5 * age);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + aCorner * size, 0.0, 1.0);
}
`;

const EMBER_FRAGMENT = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uWarm;
uniform vec3 uDeep;
varying float vAge;
varying float vSeed;
void main() {
  vec3 c = vAge < 0.3 ? mix(uHot, uWarm, vAge / 0.3) : mix(uWarm, uDeep, (vAge - 0.3) / 0.7);
  float a = 1.0 - smoothstep(0.75, 1.0, vAge);
  gl_FragColor = vec4(c, a);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const inDuration = num(params.inDuration, 0.8);
    const hold = num(params.hold, 0.2);
    const outDuration = num(params.outDuration, 1);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const soul = str(params.fire, 'fire') === 'soul';
    const volume = num(params.volume, 0.7);
    const tile = Math.max(24, num(params.flameSize, 150));
    const texel = tile / 16;
    const glow = num(params.edgeGlow, 0.8);
    const px = outputPixel(stage);

    // 火苗贴图（两张交替，带动画）；灵魂火用 soul_fire_*
    const prefix = soul ? 'minecraft:block/soul_fire_' : 'minecraft:block/fire_';
    const fire0 = await optionalTexture(ctx, [`${prefix}0`]);
    const fire1 = (await optionalTexture(ctx, [`${prefix}1`])) ?? fire0;
    const f0 = frameUniforms(ctx, fire0);
    const f1 = frameUniforms(ctx, fire1);

    // 格子：按火焰贴图的像素，行列向上取整、居中
    const cols = Math.ceil(W / texel) + 2;
    const rows = Math.ceil(H / texel) + 2;
    const originX = (-cols * texel) / 2;
    const originY = (-rows * texel) / 2;

    // 火线的起伏：四个正弦（系数随机）
    const rng = ctx.random('front');
    const waveAmp = num(params.frontWave, 0.5) * H * 0.12;
    const terms: WaveTerm[] = [0.6, 1.4, 2.9, 5.3].map((f, i) => ({ k: (f * Math.PI * 2) / W, phase: rng.next() * Math.PI * 2, amp: 1 / (i + 1) }));
    const glowBand = texel * (5 * glow + 1);
    const range = frontRange(H / 2, waveAmp, tile, glowBand, 4 * px + texel);

    // 烧穿的先后：几个起火点（离得越近越早）加两层噪声，归一化到 [0, 1]
    const holes = Math.max(1, Math.round(num(params.holes, 4)));
    const hrng = ctx.random('holes');
    const ignite = Array.from({ length: holes }, () => ({ x: (hrng.next() - 0.5) * W * 0.8, y: (hrng.next() - 0.5) * H * 0.8, lag: hrng.next() * 0.35 }));
    const diag = Math.hypot(W, H);
    const burn = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = originX + (i + 0.5) * texel;
        const y = originY + (j + 0.5) * texel;
        let d = Infinity;
        for (const p of ignite) d = Math.min(d, p.lag + Math.hypot(x - p.x, y - p.y) / diag);
        burn[j * cols + i] = d + 0.15 * ctx.noise2D(x / 260, y / 260, 'burn') + 0.04 * ctx.noise2D(x / 70, y / 70, 'burn2');
      }
    }
    normalize(burn);
    const burnTex = new THREE.DataTexture(burn, cols, rows, THREE.RedFormat, THREE.FloatType);
    burnTex.magFilter = THREE.NearestFilter;
    burnTex.minFilter = THREE.NearestFilter;
    burnTex.generateMipmaps = false;
    burnTex.needsUpdate = true;

    const hot = linearColor(ctx, soul ? '#E6FFFF' : '#FFF4B8', '#FFF4B8');
    const warm = linearColor(ctx, soul ? '#3FD9E6' : '#FF8A1F', '#FF8A1F');
    const deep = linearColor(ctx, soul ? '#0E5C73' : '#9E1F0A', '#9E1F0A');
    const u = {
      uIn: { value: 0 },
      uLeaving: { value: 0 },
      uP: { value: -RIM },
      uRim: { value: RIM },
      uTime: { value: 0 },
      uTexel: { value: texel },
      uTile: { value: tile },
      uOrigin: { value: new THREE.Vector2(originX, originY) },
      uGrid: { value: new THREE.Vector2(cols, rows) },
      uBurn: { value: burnTex },
      uFrontBase: { value: range.from },
      uAmp: { value: waveAmp },
      uWaveK: { value: new THREE.Vector4(terms[0]!.k, terms[1]!.k, terms[2]!.k, terms[3]!.k) },
      uWaveP: { value: new THREE.Vector4(terms[0]!.phase, terms[1]!.phase, terms[2]!.phase, terms[3]!.phase) },
      uWaveA: { value: new THREE.Vector4(terms[0]!.amp, terms[1]!.amp, terms[2]!.amp, terms[3]!.amp) },
      uFire0: { value: fire0 },
      uFire0Off: f0.off,
      uFire0Rep: f0.rep,
      uFire1: { value: fire1 },
      uFire1Off: f1.off,
      uFire1Rep: f1.rep,
      uHasFire: { value: fire0 ? 1 : 0 },
      // 灵魂火保持默认的焦黑时换成偏蓝的灰（灵魂沙土的颜色）
      uChar: { value: linearColor(ctx, soul && str(params.charColor, '#1A1311').toUpperCase() === '#1A1311' ? '#11161A' : params.charColor, '#1A1311') },
      uHot: { value: hot },
      uWarm: { value: warm },
      uDeep: { value: deep },
      uGlow: { value: glow },
      uSeed: { value: shaderSeed(params.seed) },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    // 火星：进入时从火线上冒、退出时从正在烧穿的格子冒。出生时刻和位置在这里定好，粒子在退出阶段结束前全部熄灭
    const count = Math.max(0, Math.round(num(params.embers, 70)));
    const erng = ctx.random('embers');
    const aA = new Float32Array(Math.max(1, count) * 4);
    const aB = new Float32Array(Math.max(1, count) * 4);
    const lastDeath = win.out.end - 1e-3;
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;
    const easeAt = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : ease(x));
    // 缓动后的进度第一次到 target 的那个阶段进度（缓动不一定单调：先粗扫再二分）
    const invert = (target: number) => {
      let lo = 0;
      for (let k = 1; k <= 64; k++) {
        if (easeAt(k / 64) >= target) {
          let a = lo;
          let b = k / 64;
          for (let n = 0; n < 24; n++) {
            const m = (a + b) / 2;
            if (easeAt(m) >= target) b = m;
            else a = m;
          }
          return b;
        }
        lo = k / 64;
      }
      return 1;
    };
    for (let i = 0; i < count; i++) {
      // 进入阶段的火星寿命很短：火线往上推得比火星飘得快，活久了会落到焦黑的幕前面
      const life = i < count * 0.4 ? 0.16 + erng.next() * 0.18 : 0.45 + erng.next() * 0.7;
      let x: number;
      let y: number;
      let birth: number;
      if (i < count * 0.4) {
        // 进入阶段：火线上随机一处
        const p = 0.1 + erng.next() * 0.85;
        birth = win.in.start + p * inLen;
        x = (erng.next() - 0.5) * W;
        y = frontAt(x, easeAt(p), range, waveAmp, terms) + tile * (0.2 + 0.6 * erng.next());
      } else {
        // 退出阶段：随机一格，在它开始发光和烧穿之间冒出来
        const ci = Math.floor(erng.next() * cols);
        const cj = Math.floor(erng.next() * rows);
        const bp = burnProgress(burn[cj * cols + ci]!, RIM);
        birth = win.out.start + invert(bp.glowAt + (bp.burnAt - bp.glowAt) * erng.next()) * outLen;
        x = originX + (ci + 0.5) * texel;
        y = originY + (cj + 0.5) * texel;
      }
      const f = fitLife(birth, life, win.in.start, lastDeath);
      aA.set([x, y, f.birth, f.life], i * 4);
      aB.set([(erng.next() - 0.5) * 60, 140 + erng.next() * 260, texel * (0.6 + erng.next() * 0.9), erng.next()], i * 4);
    }
    const emberUniforms = { uTime: { value: 0 }, uTexel: { value: texel }, uHot: { value: hot }, uWarm: { value: warm }, uDeep: { value: deep } };
    const embers =
      count > 0
        ? particleBatch(ctx, { count, attributes: { aA: { size: 4, data: aA }, aB: { size: 4, data: aB } }, vertex: EMBER_VERTEX, fragment: EMBER_FRAGMENT, uniforms: emberUniforms, renderOrder: 1 })
        : null;

    if (typeof params.igniteSound === 'string') ctx.audio.cue(params.igniteSound, win.in.start, { gain: volume });
    if (typeof params.burnSound === 'string') ctx.audio.cue(params.burnSound, win.out.start, { gain: volume });

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const leaving = t > win.cutTime;
        const a = eased(t, win.in, ease);
        const b = eased(t, win.out, ease);
        u.uIn.value = a;
        u.uLeaving.value = leaving ? 1 : 0;
        u.uFrontBase.value = range.from + (range.to - range.from) * a;
        u.uP.value = burnThreshold(b, RIM);
        u.uTime.value = t;
        emberUniforms.uTime.value = t;
      },
      dispose() {
        quad.dispose();
        burnTex.dispose();
        embers?.dispose();
      },
    };
  },
};

export default template;
