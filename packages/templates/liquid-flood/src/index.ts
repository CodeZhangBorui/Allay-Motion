// 010 液体淹没 allay.builtin.liquid-flood（docs/templates/liquid-flood.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 水（或岩浆）带着起伏的水面从一边涨满画面，水下越深越暗，气泡往上冒；退出时水位退回去（或继续流走）。
// 水的贴图是灰度的 block/water_still（或 water_flow，带动画），乘上生物群系的水色；水本来是半透明的（alpha 180），
// 下面垫一层随深度变暗的底色，剪辑点时整个画面不透明而不像一块色板。水面、水位都按贴图的像素格走（方的台阶）。
// 气泡（particle/bubble）是 GPU 上按闭式算位置的粒子，只在水面以下显示。贴图缺失时：水用底色加程序画的光纹，气泡画成圆圈。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num, str } from '../../_lib/src/gui-kit';
import { frameUniforms, GLSL_COMMON, linearColor, optionalTexture, outputPixel, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { fitLife, particleBatch } from '../../_lib/src/shader-particles';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { levelAt, levelRange, soundFor, SOURCES, surfaceWave, type WaveTerm } from './layout';

/** 水面、水位的公用 GLSL：舞台坐标 → 离来水一边的距离和沿边坐标，水面的起伏，某点在水面以下多深 */
const GLSL_WATER = /* glsl */ `
uniform float uSource;
uniform float uLevel;
uniform float uTail;
uniform float uAmp;
uniform vec4 uWk;
uniform vec4 uWw;
uniform vec4 uWp;
uniform vec4 uWa;
uniform float uTime;
uniform float uTexel;
vec2 fillSpace(vec2 p) {
  vec2 S = uStage * 0.5;
  if (uSource < 0.5) return vec2(p.y + S.y, p.x);
  if (uSource < 1.5) return vec2(S.y - p.y, p.x);
  if (uSource < 2.5) return vec2(p.x + S.x, p.y);
  return vec2(S.x - p.x, p.y);
}
float waveAt(float c, float t) {
  vec4 s = uWa * sin(uWk * c + uWw * t + uWp);
  return (s.x + s.y + s.z + s.w) / max(1e-4, dot(abs(uWa), vec4(1.0)));
}
/** 水面以下多深（设计单位，水面以上为负）；按贴图像素吸附，水面是方的台阶 */
float depthAt(vec2 p) {
  vec2 q = fillSpace(p);
  float c = snapTo(q.y, uTexel);
  float level = floor((uLevel + uAmp * waveAt(c, uTime)) / uTexel) * uTexel;
  float d = level - floor(q.x / uTexel) * uTexel;
  // 继续流走：后面也有一个水面（来水那一边），它之后才是水
  float tail = floor((uTail + uAmp * waveAt(c * 1.3 + 400.0, uTime * 1.2)) / uTexel) * uTexel;
  return min(d, floor(q.x / uTexel) * uTexel - tail);
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_WATER}
uniform float uTile;
uniform float uLava;
uniform sampler2D uTex;
uniform vec2 uTexOff;
uniform vec2 uTexRep;
uniform float uHasTex;
uniform sampler2D uOverlay;
uniform float uHasOverlay;
uniform float uSubmerged;
uniform vec3 uWater;
uniform vec3 uDeep;
uniform vec3 uCrest;
uniform float uSeed;
varying vec2 vPos;
void main() {
  float d = depthAt(vPos);
  if (d < 0.0) discard;
  // 越深越暗：贴着水面是水色，往下落到深处的颜色
  float k = 1.0 - exp(-d / (min(uStage.x, uStage.y) * 0.42));
  vec3 col = mix(uWater * 1.05, uDeep, k);
  if (uHasTex > 0.5) {
    vec2 p = vPos / uTile;
    vec4 tx = tileFrame(uTex, uTexOff, uTexRep, p);
    if (uLava > 0.5) col = mix(tx.rgb, tx.rgb * uDeep * 2.2, k * 0.65);
    else col = mix(col, tx.rgb * uWater * 1.5, tx.a * (1.0 - 0.9 * k));
  } else {
    // 没有贴图：几道慢慢移动的浅色横纹
    float n = vnoise(vec2(vPos.x / (uTile * 1.7), vPos.y / (uTile * 0.35) + uTime * 0.3), uint(uSeed));
    col *= 0.9 + 0.22 * smoothstep(0.55, 0.9, n) * (1.0 - k);
    if (uLava > 0.5) col = mix(uWater, uDeep, k * 0.7) * (0.85 + 0.3 * n);
  }
  // 水面：最上两行像素亮，第三行暗一点，水线清楚
  float row = d / uTexel;
  if (row < 2.0) col = mix(col, uCrest, row < 1.0 ? 0.7 : 0.45);
  else if (row < 3.0) col *= 0.82;
  // 水面下几格里斜着的几道光（游戏里没有，水下的感觉；越深越淡）
  if (uLava < 0.5) {
    float x = (vPos.x + vPos.y * 0.35) / (uTile * 0.9);
    float ray = vnoise(vec2(x + uTime * 0.25, uTime * 0.08), uint(uSeed) ^ 0x5au) * vnoise(vec2(x * 2.3 - uTime * 0.18, 3.0), uint(uSeed) ^ 0xa5u);
    col += uCrest * smoothstep(0.35, 0.7, ray) * 0.07 * exp(-d / (uTile * 2.5));
  }
  // 整个画面没在水下时，叠一层游戏里水下的视野贴图（misc/underwater，很淡）
  if (uHasOverlay > 0.5 && uLava < 0.5 && uSubmerged > 0.0) {
    vec2 o = vPos / (min(uStage.x, uStage.y) / 4.0) + vec2(uTime * 0.05, -uTime * 0.03);
    vec4 ov = bilerpRepeat(uOverlay, o);
    col = mix(col, ov.rgb, ov.a * 0.15 * uSubmerged);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const BUBBLE_VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aA;
attribute vec4 aB;
uniform float uTime;
uniform float uTexel;
varying vec2 vCorner;
varying vec2 vWorld;
varying float vAge;
void main() {
  float age = uTime - aA.z;
  vAge = age / aA.w;
  vCorner = aCorner;
  if (age < 0.0 || age > aA.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // 往上浮，越浮越快一点，左右轻轻摆
  vec2 pos = aA.xy + vec2(sin(age * aB.x + aB.w * 6.2832) * uTexel * 1.5, aB.y * age + 60.0 * age * age);
  pos = (floor(pos / uTexel) + 0.5) * uTexel;
  vWorld = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + aCorner * aB.z, 0.0, 1.0);
}
`;

const BUBBLE_FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_WATER}
uniform sampler2D uBubble;
uniform float uHasBubble;
uniform vec3 uCrest;
varying vec2 vCorner;
varying vec2 vWorld;
varying float vAge;
void main() {
  // 气泡只在水下：中心浮出水面就没了
  if (depthAt(vWorld) < uTexel) discard;
  vec4 c;
  if (uHasBubble > 0.5) {
    c = texture2D(uBubble, vCorner + 0.5);
  } else {
    float r = length(vCorner) * 2.0;
    float ring = smoothstep(0.62, 0.75, r) * (1.0 - smoothstep(0.88, 1.0, r));
    c = vec4(uCrest, ring * 0.9);
  }
  float a = c.a * (1.0 - smoothstep(0.85, 1.0, vAge));
  if (a <= 0.0) discard;
  gl_FragColor = vec4(c.rgb, a);
}
`;

const POP_VERTEX = /* glsl */ `
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
  // 抛物线：蹦起来再落回去
  vec2 pos = aA.xy + vec2(aB.x * age, aB.y * age - 0.5 * 2200.0 * age * age);
  pos = (floor(pos / uTexel) + 0.5) * uTexel;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + aCorner * aB.z * (1.0 - 0.4 * vAge), 0.0, 1.0);
}
`;

const POP_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec3 uHot;
uniform vec3 uWarm;
varying vec2 vCorner;
varying float vAge;
void main() {
  vec4 c = uHasTex > 0.5 ? texture2D(uTex, vCorner + 0.5) : vec4(mix(uHot, uWarm, vAge), 1.0);
  float a = c.a * (1.0 - smoothstep(0.7, 1.0, vAge));
  if (a <= 0.0) discard;
  gl_FragColor = vec4(c.rgb, a);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const inDuration = num(params.inDuration, 0.9);
    const hold = num(params.hold, 0.2);
    const outDuration = num(params.outDuration, 0.8);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const lava = str(params.liquid, 'water') === 'lava';
    const source = SOURCES.find((s) => s === params.source) ?? 'bottom';
    const through = str(params.outMode, 'drain') === 'through';
    const volume = num(params.volume, 0.7);
    const tile = Math.max(24, num(params.blockSize, 120));
    const texel = tile / 16;
    const px = outputPixel(stage);
    const vertical = source === 'bottom' || source === 'top';
    const length = vertical ? H : W;
    const amp = num(params.waveHeight, 0.45) * tile * 0.9;
    const pad = 4 * px + 2 * texel;
    const range = levelRange(length, amp, pad);

    // 水面的起伏：四个往两边走的正弦（系数随机）
    const rng = ctx.random('waves');
    const cross = vertical ? W : H;
    const terms: WaveTerm[] = [0.9, 1.7, 3.1, 5.2].map((f, i) => ({
      k: (f * Math.PI * 2) / cross,
      w: (i % 2 === 0 ? 1 : -1) * (1.6 + rng.next() * 1.4),
      phase: rng.next() * Math.PI * 2,
      amp: 1 / (i + 1),
    }));
    const vec4 = (key: keyof WaveTerm) => new THREE.Vector4(terms[0]![key], terms[1]![key], terms[2]![key], terms[3]![key]);
    const surfaceWaveAt = (c: number, t: number) => surfaceWave(snap(c), t, terms);
    const snap = (c: number) => (Math.floor(c / texel) + 0.5) * texel;

    // 贴图：静水从下面涨上来时用 water_still，从上面、侧面灌进来时用流动的 water_flow（都是带动画的灰度图）
    const texId = lava ? (source === 'bottom' ? 'lava_still' : 'lava_flow') : source === 'bottom' ? 'water_still' : 'water_flow';
    const tex = await optionalTexture(ctx, [`minecraft:block/${texId}`]);
    const overlay = lava ? null : await optionalTexture(ctx, ['minecraft:misc/underwater']);
    const frame = frameUniforms(ctx, tex);

    const shared = {
      uSource: { value: SOURCES.indexOf(source) },
      uLevel: { value: range.from },
      uTail: { value: -1e6 },
      uAmp: { value: amp },
      uWk: { value: vec4('k') },
      uWw: { value: vec4('w') },
      uWp: { value: vec4('phase') },
      uWa: { value: vec4('amp') },
      uTime: { value: 0 },
      uTexel: { value: texel },
    };
    const water = lava ? linearColor(ctx, '#E8640C', '#E8640C') : linearColor(ctx, params.waterColor, '#3F76E4');
    const deep = lava ? linearColor(ctx, '#5C1404', '#5C1404') : linearColor(ctx, params.depthColor, '#0B1F57');
    const crest = lava ? linearColor(ctx, '#FFD25A', '#FFD25A') : linearColor(ctx, '#D8F0FF', '#D8F0FF');
    const quad = shaderQuad(ctx, {
      fragment: FRAGMENT,
      uniforms: {
        ...shared,
        uTile: { value: tile },
        uLava: { value: lava ? 1 : 0 },
        uTex: { value: tex },
        uTexOff: frame.off,
        uTexRep: frame.rep,
        uHasTex: { value: tex ? 1 : 0 },
        uOverlay: { value: overlay },
        uHasOverlay: { value: overlay ? 1 : 0 },
        uSubmerged: { value: 0 },
        uWater: { value: water },
        uDeep: { value: deep },
        uCrest: { value: crest },
        uSeed: { value: shaderSeed(params.seed) },
      },
    });
    const quadUniforms = quad.uniforms;

    // 气泡：在进入、退出阶段里随机出生，从画面下半部分往上浮；只在水下显示，退出阶段结束前全部消失
    const count = lava ? 0 : Math.max(0, Math.round(num(params.bubbles, 45)));
    const brng = ctx.random('bubbles');
    const aA = new Float32Array(Math.max(1, count) * 4);
    const aB = new Float32Array(Math.max(1, count) * 4);
    const first = win.in.start;
    const last = win.out.end - 1e-3;
    for (let i = 0; i < count; i++) {
      const { birth, life } = fitLife(first + brng.next() * (last - first) * 0.85, 0.8 + brng.next() * 1.2, first, last);
      aA.set([(brng.next() - 0.5) * W, -H / 2 + brng.next() * H * 0.7, birth, life], i * 4);
      aB.set([3 + brng.next() * 4, 140 + brng.next() * 260, tile * (0.18 + brng.next() * 0.22), brng.next()], i * 4);
    }
    const bubble = count > 0 ? await optionalTexture(ctx, ['minecraft:particle/bubble']) : null;
    const bubbleUniforms = { ...shared, uStage: quadUniforms.uStage!, uBubble: { value: bubble }, uHasBubble: { value: bubble ? 1 : 0 }, uCrest: { value: crest } };
    const bubbles = count > 0 ? particleBatch(ctx, { count, attributes: { aA: { size: 4, data: aA }, aB: { size: 4, data: aB } }, vertex: BUBBLE_VERTEX, fragment: BUBBLE_FRAGMENT, uniforms: bubbleUniforms, renderOrder: 1 }) : null;

    // 岩浆：从液面蹦出来的小火点（particle/lava），只在从下面涨上来时有；出生时刻、位置按液面的式子在这里算好
    const popCount = lava && source === 'bottom' ? Math.max(0, Math.round(num(params.bubbles, 45) * 0.6)) : 0;
    const prng = ctx.random('pops');
    const pA = new Float32Array(Math.max(1, popCount) * 4);
    const pB = new Float32Array(Math.max(1, popCount) * 4);
    const easeAt = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : ease(x));
    for (let i = 0; i < popCount; i++) {
      // 进入阶段的后一半（液面在画面里时）或退出阶段的前一半
      const entering = i % 2 === 0;
      const w = entering ? win.in : win.out;
      const f = entering ? 0.25 + prng.next() * 0.7 : 0.05 + prng.next() * 0.6;
      const birth = w.start + f * (w.end - w.start);
      const lv = levelAt(entering ? easeAt(f) : 1 - easeAt(f), range);
      const x = (prng.next() - 0.5) * W;
      const surface = lv + amp * surfaceWaveAt(x, birth) - H / 2;
      const fit = fitLife(birth, 0.5 + prng.next() * 0.5, win.in.start, last);
      pA.set([x, surface, fit.birth, fit.life], i * 4);
      pB.set([(prng.next() - 0.5) * 220, 380 + prng.next() * 520, tile * (0.12 + prng.next() * 0.12), prng.next()], i * 4);
    }
    const popTex = popCount > 0 ? await optionalTexture(ctx, ['minecraft:particle/lava']) : null;
    const popUniforms = { uTime: { value: 0 }, uTexel: { value: texel }, uTex: { value: popTex }, uHasTex: { value: popTex ? 1 : 0 }, uHot: { value: crest }, uWarm: { value: water } };
    const pops = popCount > 0 ? particleBatch(ctx, { count: popCount, attributes: { aA: { size: 4, data: pA }, aB: { size: 4, data: pB } }, vertex: POP_VERTEX, fragment: POP_FRAGMENT, uniforms: popUniforms, renderOrder: 2 }) : null;

    const fill = soundFor(typeof params.fillSound === 'string' ? params.fillSound : null, 'fill', lava ? 'lava' : 'water');
    const drain = soundFor(typeof params.drainSound === 'string' ? params.drainSound : null, 'drain', lava ? 'lava' : 'water');
    if (fill) ctx.audio.cue(fill, win.in.start, { gain: volume });
    if (drain) ctx.audio.cue(drain, win.out.start, { gain: volume });

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const a = eased(t, win.in, ease);
        const b = eased(t, win.out, ease);
        let level: number;
        let tail = -1e6;
        if (t <= win.cutTime) level = levelAt(a, range);
        else if (through) {
          // 继续流走：水面已经出了画面，后面的水面从来水那一边追上来
          level = range.to + 1e6;
          tail = levelAt(b, range);
        } else level = levelAt(1 - b, range);
        shared.uLevel.value = level;
        shared.uTail.value = tail;
        shared.uTime.value = t;
        popUniforms.uTime.value = t;
        // 水下的视野贴图：水面快到对边时淡入；继续流走时后面的水面一进画面就淡出
        const ramp = (x: number) => Math.min(1, Math.max(0, x));
        quadUniforms.uSubmerged!.value = tail > -1e5 ? 1 - ramp((tail + amp + pad) / (2 * tile)) : ramp((level - length + 2 * tile) / (2 * tile + amp));
      },
      dispose() {
        quad.dispose();
        bubbles?.dispose();
        pops?.dispose();
      },
    };
  },
};

export default template;
