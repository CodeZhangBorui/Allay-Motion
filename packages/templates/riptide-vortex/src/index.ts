// 026 激流 allay.builtin.riptide-vortex（docs/templates/riptide-vortex.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 激流附魔的旋转贴图（entity/trident_riptide）按螺线绕着画面中心转，水从四周卷进来，中间的洞带着几瓣起伏一边转一边收紧，
// 洞口一圈白浪，水花（particle/splash_0–3）从洞口甩出去；剪辑点时整个画面是水；退出时洞再转着张开。
// 着色器在“角度 + 扭转 × log(半径)”的螺线坐标里贴图，导数按解析式算（atan 的接缝处不会跳 mipmap）。
// 贴图缺失时：螺线条纹和水花都用程序画的形状。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num } from '../../_lib/src/gui-kit';
import { GLSL_COMMON, linearColor, optionalTexture, outputPixel, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { fitLife, particleBatch } from '../../_lib/src/shader-particles';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { holeRadius, LOBE, openRadius, riptideSound, spinRate } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform float uHole;
uniform float uSpin;
uniform float uTwist;
uniform float uArms;
uniform float uLobe;
uniform float uTime;
uniform float uFlow;
uniform sampler2D uRip;
uniform float uHasRip;
uniform vec3 uWater;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uSeed;
varying vec2 vPos;

void main() {
  vec2 p = vPos;
  float r = max(length(p), 1e-3);
  float th = atan(p.y, p.x);
  float lr = log(r);
  // 螺线坐标：沿着它走就是一条旋臂
  float sp = th + uTwist * lr - uSpin;
  float edge = uHole * (1.0 + uLobe * sin(uArms * sp));
  if (r < edge) discard;
  float sh = min(uStage.x, uStage.y);
  float away = (r - max(edge, 0.0)) / sh;
  // 底：靠近洞口深（往里看是漩涡的深处），外圈浅
  vec3 col = mix(uDeep, uWater, smoothstep(0.0, 0.75, away));
  // 旋转的白色条纹：贴图在螺线坐标里平铺，u 绕一圈 3 格，v 沿 log 半径；导数按解析式（避开 atan 的接缝）
  vec2 uv = vec2(sp / 6.2832 * 3.0, lr * 1.25 - uTime * uFlow);
  vec2 dx = dFdx(p);
  vec2 dy = dFdy(p);
  float r2 = r * r;
  vec2 dsp = vec2((-p.y * dx.x + p.x * dx.y) + uTwist * dot(p, dx), (-p.y * dy.x + p.x * dy.y) + uTwist * dot(p, dy)) / r2;
  vec2 dlr = vec2(dot(p, dx), dot(p, dy)) / r2;
  vec2 gx = vec2(dsp.x / 6.2832 * 3.0, dlr.x * 1.25);
  vec2 gy = vec2(dsp.y / 6.2832 * 3.0, dlr.y * 1.25);
  float streak;
  if (uHasRip > 0.5) {
    streak = textureGrad(uRip, fract(uv), gx, gy).a;
  } else {
    // 没有贴图：螺线条纹。沿角度方向只用周期函数（uv.x 在 atan 的接缝处跳整数，不能用非周期的噪声）
    float s = fract(uv.x * 2.0 + uv.y * 0.6 + 0.35 * sin(uv.y * 9.0 + uTime * 1.7));
    float breakup = step(0.3, 0.5 + 0.5 * sin(uv.x * 31.4159 + uv.y * 7.0 + float(uint(uSeed) % 97u)));
    streak = (1.0 - smoothstep(0.0, 0.05, abs(s - 0.5))) * breakup;
  }
  col = mix(col, uFoam, streak * (0.55 + 0.4 * smoothstep(0.0, 0.5, away)));
  // 洞口一圈白浪，外面一圈暗边；洞关上了就没有
  float open = smoothstep(0.0, sh * 0.05, uHole);
  float foam = (1.0 - smoothstep(0.0, sh * 0.025, r - edge)) * open;
  col = mix(col, uFoam, foam * 0.9);
  col *= 1.0 - 0.25 * (1.0 - smoothstep(sh * 0.02, sh * 0.09, r - edge)) * (1.0 - foam) * open;
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPLASH_VERTEX = /* glsl */ `
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
  vec2 pos = aA.xy + aB.xy * age * (1.0 - 0.35 * vAge);
  pos = (floor(pos / uTexel) + 0.5) * uTexel;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + aCorner * aB.z * (1.0 - 0.3 * vAge), 0.0, 1.0);
}
`;

const SPLASH_FRAGMENT = /* glsl */ `
uniform sampler2D uS0;
uniform sampler2D uS1;
uniform sampler2D uS2;
uniform sampler2D uS3;
uniform float uHasSplash;
uniform vec3 uFoam;
varying vec2 vCorner;
varying float vAge;
void main() {
  vec2 uv = vCorner + 0.5;
  vec4 c;
  if (uHasSplash > 0.5) {
    // 4 帧，寿命里走完
    int k = int(clamp(floor(vAge * 4.0), 0.0, 3.0));
    if (k == 0) c = texture2D(uS0, uv);
    else if (k == 1) c = texture2D(uS1, uv);
    else if (k == 2) c = texture2D(uS2, uv);
    else c = texture2D(uS3, uv);
  } else {
    float r = length(vCorner) * 2.0;
    c = vec4(uFoam, 1.0 - step(0.55 - vAge * 0.25, r));
  }
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0 - smoothstep(0.75, 1.0, vAge));
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { stage, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const inDuration = num(params.inDuration, 0.8);
    const hold = num(params.hold, 0.15);
    const outDuration = num(params.outDuration, 0.7);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const level = Math.round(num(params.level, 3));
    const volume = num(params.volume, 0.7);
    const short = Math.min(W, H);
    const open = openRadius(W / 2, H / 2, 6 * outputPixel(stage) + short * 0.03);
    const spin = spinRate(level) * Math.PI * 2;
    const twist = num(params.twist, 1.2);

    // 激流贴图：26.2 起在 entity/trident/ 下，更早在 entity/ 下（对照过游戏文件）
    const rip = await optionalTexture(ctx, ['minecraft:entity/trident/trident_riptide', 'minecraft:entity/trident_riptide']);
    const u = {
      uHole: { value: open },
      uSpin: { value: 0 },
      uTwist: { value: twist },
      uArms: { value: Math.max(1, Math.round(num(params.arms, 3))) },
      uLobe: { value: LOBE },
      uTime: { value: 0 },
      uFlow: { value: 0.5 + 0.2 * level },
      uRip: { value: rip },
      uHasRip: { value: rip ? 1 : 0 },
      uWater: { value: linearColor(ctx, params.waterColor, '#2F64D6') },
      uDeep: { value: linearColor(ctx, params.deepColor, '#08174A') },
      uFoam: { value: linearColor(ctx, params.foamColor, '#E4FBFF') },
      uSeed: { value: shaderSeed(params.seed) },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    // 水花：进入、退出阶段里从洞口甩出去（顺着转的方向、往外），出生时洞口有多大按同一个式子算
    const easeAt = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : ease(x));
    const count = Math.max(0, Math.round(num(params.splashes, 50)));
    const rng = ctx.random('splashes');
    const aA = new Float32Array(Math.max(1, count) * 4);
    const aB = new Float32Array(Math.max(1, count) * 4);
    const last = win.out.end - 1e-3;
    for (let i = 0; i < count; i++) {
      const entering = i % 3 !== 2;
      const w = entering ? win.in : win.out;
      const f = entering ? 0.15 + rng.next() * 0.75 : 0.05 + rng.next() * 0.7;
      const birth = w.start + f * (w.end - w.start);
      const radius = Math.max(short * 0.04, holeRadius(entering ? easeAt(f) : 1 - easeAt(f), open));
      const ang = rng.next() * Math.PI * 2;
      const x = Math.cos(ang) * radius;
      const y = Math.sin(ang) * radius;
      // 切向（逆时针转）加往外
      const speed = short * (0.35 + rng.next() * 0.55);
      const tx = -Math.sin(ang);
      const ty = Math.cos(ang);
      const fit = fitLife(birth, 0.3 + rng.next() * 0.35, win.in.start, last);
      aA.set([x, y, fit.birth, fit.life], i * 4);
      aB.set([(tx * 0.8 + Math.cos(ang) * 0.6) * speed, (ty * 0.8 + Math.sin(ang) * 0.6) * speed, short * (0.035 + rng.next() * 0.035), rng.next()], i * 4);
    }
    const splashTex = count > 0 ? await Promise.all([0, 1, 2, 3].map((k) => optionalTexture(ctx, [`minecraft:particle/splash_${k}`]))) : [];
    const hasSplash = splashTex.length === 4 && splashTex.every((x) => x !== null);
    const splashUniforms = { uTime: { value: 0 }, uTexel: { value: short / 270 }, uS0: { value: splashTex[0] ?? null }, uS1: { value: splashTex[1] ?? null }, uS2: { value: splashTex[2] ?? null }, uS3: { value: splashTex[3] ?? null }, uHasSplash: { value: hasSplash ? 1 : 0 }, uFoam: { value: u.uFoam.value } };
    const splashes = count > 0 ? particleBatch(ctx, { count, attributes: { aA: { size: 4, data: aA }, aB: { size: 4, data: aB } }, vertex: SPLASH_VERTEX, fragment: SPLASH_FRAGMENT, uniforms: splashUniforms, renderOrder: 1 }) : null;

    const sound = riptideSound(typeof params.sound === 'string' ? params.sound : null, level);
    if (sound) ctx.audio.cue(sound, win.in.start, { gain: volume });
    if (typeof params.outSound === 'string') ctx.audio.cue(params.outSound, win.out.start, { gain: volume });

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const closing = t <= win.cutTime;
        const p = closing ? eased(t, win.in, ease) : 1 - eased(t, win.out, ease);
        u.uHole.value = holeRadius(p, open);
        // 一直在转；收紧时扭得更厉害
        u.uSpin.value = spin * t;
        u.uTwist.value = twist * (0.6 + 0.4 * p);
        u.uTime.value = t;
        splashUniforms.uTime.value = t;
      },
      dispose() {
        quad.dispose();
        splashes?.dispose();
      },
    };
  },
};

export default template;
