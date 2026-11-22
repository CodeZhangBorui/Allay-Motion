// 060 昼夜流转 allay.builtin.sky-timelapse（docs/templates/sky-timelapse.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 镜头像抬头看天那样，天空从上面滑下来铺满画面；天上的时间飞快地过：太阳（environment/celestial/sun）沿着弧线落下去，
// 霞光起来又褪掉，星星出来、跟着天一起转，月亮（celestial/moon/<月相>）升起；可以叠一行“第 N 天”。退出时镜头低回去，天空滑出画面。
// 天空的颜色、星星的亮度、霞光照游戏的式子（layout.ts）。太阳月亮在游戏里是加法混合的，这里把亮度当覆盖率普通混合，画在天上一样。
// 贴图缺失时太阳、月亮画成程序的方块和光晕；天空、星星本来就是程序画的。
import type { SetupContext, TemplateInstance, TemplateModule, TextObject } from '@allay/template-sdk';
import { fontOf, num, str } from '../../_lib/src/gui-kit';
import { GLSL_COMMON, optionalTexture, outputPixel, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { eased, progress, transitionWindows } from '../../_lib/src/timing';
import { celestialAngle, MOON_PHASES, moonPhaseRect, orbit, skyBrightness, starBrightness, sunriseGlow, timeSpan } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform float uHorizon;
uniform float uFade;
uniform vec3 uSky;
uniform vec3 uFog;
uniform vec3 uGlowCol;
uniform float uGlowA;
uniform float uGlowX;
uniform vec2 uSunPos;
uniform vec2 uMoonPos;
uniform float uSunSize;
uniform float uMoonSize;
uniform sampler2D uSun;
uniform float uHasSun;
uniform sampler2D uMoon;
uniform vec4 uMoonRect;
uniform float uHasMoon;
uniform float uMoonLit;
uniform float uStarA;
uniform float uStarTurn;
uniform vec2 uOrbit;
uniform float uStarSize;
uniform float uSeed;
varying vec2 vPos;

/** 太阳、月亮：贴图在游戏里是加法混合的，这里亮度当覆盖率；没有贴图时画一个亮方块加一圈光晕 */
vec4 bodyAt(vec2 p, vec2 c, float size, sampler2D tex, vec4 rect, float hasTex, vec3 tint, float lit) {
  vec2 f = (p - c) / size + 0.5;
  vec4 r = vec4(0.0);
  if (f.x >= 0.0 && f.y >= 0.0 && f.x < 1.0 && f.y < 1.0) {
    if (hasTex > 0.5) {
      vec3 s = texture2D(tex, vec2(mix(rect.x, rect.z, f.x), mix(rect.y, rect.w, f.y))).rgb;
      float a = max(s.r, max(s.g, s.b));
      r = vec4(a > 0.0 ? s / a : s, a);
    } else {
      vec2 q = abs(f - 0.5);
      float core = step(max(q.x, q.y), 0.125);
      float halo = exp(-dot(q, q) * 40.0) * 0.35;
      r = vec4(tint, max(core * lit, halo * lit));
    }
  }
  return r;
}

void main() {
  vec2 p = vPos;
  float h = p.y - uHorizon;
  if (h < -uFade) discard;
  // 地平线下面一窄条渐隐（天空滑进来、滑出去时的边），剪辑点时这一条在画面外
  float alpha = smoothstep(-uFade, 0.0, h);
  float hn = clamp(h / uStage.y, 0.0, 1.0);
  vec3 col = mix(uFog, uSky, smoothstep(0.0, 0.6, hn));
  // 霞光：太阳那一侧的地平线上
  if (uGlowA > 0.0) {
    vec2 q = vec2((p.x - uGlowX) / (uStage.x * 0.7), h / (uStage.y * 0.42));
    col = mix(col, uGlowCol, uGlowA * exp(-dot(q, q) * 2.2));
  }
  // 星星：跟着天一起绕地平线中点转。在轨道椭圆归一化的坐标里转回星空自己的方向，按方格散列（每格最多一颗，密度均匀），
  // 再换回画面坐标画成方的一两个像素
  if (uStarA > 0.0) {
    vec2 e = vec2(p.x / uOrbit.x, h / uOrbit.y);
    vec2 er = rot2(-uStarTurn) * e * 50.0;
    vec2 base = floor(er);
    float star = 0.0;
    uint s = uint(uSeed);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = base + vec2(float(i), float(j));
        ivec2 ci = ivec2(cell);
        if (rand2(ci, s) > 0.08) continue;
        vec2 jit = vec2(rand2(ci, s ^ 0x1u), rand2(ci, s ^ 0x2u));
        vec2 c = rot2(uStarTurn) * ((cell + jit) / 50.0);
        vec2 cp = vec2(c.x * uOrbit.x, c.y * uOrbit.y + uHorizon);
        vec2 d = abs(p - cp);
        float sz = uStarSize * (0.6 + 0.8 * rand2(ci, s ^ 0x3u));
        if (max(d.x, d.y) < sz) star = max(star, 0.45 + 0.55 * rand2(ci, s ^ 0x4u));
      }
    }
    col = mix(col, vec3(1.0), star * uStarA * smoothstep(0.0, uStage.y * 0.12, h));
  }
  vec4 sun = bodyAt(p, uSunPos, uSunSize, uSun, vec4(0.0, 0.0, 1.0, 1.0), uHasSun, vec3(1.0, 0.95, 0.62), 1.0);
  col = mix(col, sun.rgb, sun.a);
  vec4 moon = bodyAt(p, uMoonPos, uMoonSize, uMoon, uMoonRect, uHasMoon, vec3(0.85, 0.9, 0.97), uMoonLit);
  col = mix(col, moon.rgb, moon.a);
  gl_FragColor = vec4(col, alpha);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const inDuration = num(params.inDuration, 0.6);
    const hold = num(params.hold, 1.6);
    const outDuration = num(params.outDuration, 0.6);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const volume = num(params.volume, 0.7);
    const span = timeSpan(num(params.from, 11000), num(params.to, 1000));
    const short = Math.min(W, H);
    const fade = H * 0.14 + 4 * outputPixel(stage);
    // 地平线：进入时从画面上边以外降到下边以外（天空从上面滑下来），退出时再升回去
    const top = H / 2 + fade;
    const bottom = -H / 2 - fade;
    // 轨道：横半轴让日出日落落在画面里，竖半轴让正午的太阳在画面上部
    const ax = W * 0.4;
    const ay = H * 0.86 + fade;
    const sunSize = num(params.sunSize, 1) * short * 0.3;

    const sun = await optionalTexture(ctx, ['minecraft:environment/celestial/sun', 'minecraft:environment/sun']);
    const phaseName = MOON_PHASES.find((m) => m === params.moonPhase) ?? 'full_moon';
    const phase = MOON_PHASES.indexOf(phaseName);
    // 月亮：1.21.11 起每相一张，更早是 4 × 2 的一张（对照过游戏文件）
    const moonNew = await optionalTexture(ctx, [`minecraft:environment/celestial/moon/${phaseName}`]);
    const moonOld = moonNew ? null : await optionalTexture(ctx, ['minecraft:environment/moon_phases']);
    const rect = moonNew ? { u0: 0, v0: 0, u1: 1, v1: 1 } : moonPhaseRect(phase);

    // 天空、雾色按亮度乘：游戏里是在 sRGB 的数值上乘（没有线性的工作流程），这里也先在 sRGB 上乘再换成线性
    const srgb = (v: unknown, fallback: string) => {
      const n = parseInt((typeof v === 'string' && /^#[0-9a-fA-F]{6}/.test(v) ? v : fallback).slice(1, 7), 16);
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    };
    const skyColor = srgb(params.skyColor, '#78A7FF');
    const fogColor = srgb(params.fogColor, '#C0D8FF');
    const u = {
      uHorizon: { value: top },
      uFade: { value: fade },
      uSky: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uGlowCol: { value: new THREE.Color() },
      uGlowA: { value: 0 },
      uGlowX: { value: 0 },
      uSunPos: { value: new THREE.Vector2() },
      uMoonPos: { value: new THREE.Vector2() },
      uSunSize: { value: sunSize },
      uMoonSize: { value: sunSize * (20 / 30) },
      uSun: { value: sun },
      uHasSun: { value: sun ? 1 : 0 },
      uMoon: { value: moonNew ?? moonOld },
      uMoonRect: { value: new THREE.Vector4(rect.u0, rect.v0, rect.u1, rect.v1) },
      uHasMoon: { value: moonNew || moonOld ? 1 : 0 },
      uMoonLit: { value: 0.25 + 0.75 * (1 - Math.abs(phase - 4) / 4) },
      uStarA: { value: 0 },
      uStarTurn: { value: 0 },
      uOrbit: { value: new THREE.Vector2(ax, ay) },
      uStarSize: { value: Math.max(1, short * 0.0014) },
      uSeed: { value: shaderSeed(params.seed) },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    // 一行字：跟着天空一起滑进滑出，停留阶段的后一半淡入
    const label = str(params.label, '').trim();
    let text: TextObject | null = null;
    if (label !== '') {
      text = ctx.text.create({ text: label, size: num(params.labelSize, 10), color: str(params.labelColor, '#FFFFFF').slice(0, 7), align: 'center', maxWidth: W * 0.9, font: fontOf(params.labelFont) });
      text.object.position.z = 1;
      text.object.renderOrder = 10;
      ctx.scene.add(text.object);
    }
    const labelIn = { start: win.in.end + (win.out.start - win.in.end) * 0.15, end: win.in.end + (win.out.start - win.in.end) * 0.55 };
    if (typeof params.sound === 'string') ctx.audio.cue(params.sound, text ? labelIn.start : win.in.start, { gain: volume });

    const whole = { start: win.in.start, end: win.out.end };
    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const a = eased(t, win.in, ease);
        const b = eased(t, win.out, ease);
        const horizon = t <= win.cutTime ? top + (bottom - top) * a : bottom + (top - bottom) * b;
        u.uHorizon.value = horizon;
        // 天上的时间：整段时长里从 from 走到 to，两头慢中间快
        const q = progress(t, whole);
        const dayTime = span.from + (span.to - span.from) * (0.5 - 0.5 * Math.cos(Math.PI * q));
        const angle = celestialAngle(dayTime);
        const k = skyBrightness(angle);
        u.uSky.value.setRGB(skyColor.r * k, skyColor.g * k, skyColor.b * k, THREE.SRGBColorSpace);
        // 雾色（地平线）：夜里留一点深蓝（游戏里雾色按亮度乘 0.94 再加 0.06，蓝色乘 0.91 再加 0.09）
        const fk = k * 0.94 + 0.06;
        u.uFog.value.setRGB(fogColor.r * fk, fogColor.g * fk, fogColor.b * (k * 0.91 + 0.09), THREE.SRGBColorSpace);
        const sunPos = orbit(angle, ax, ay);
        u.uSunPos.value.set(sunPos.x, horizon + sunPos.y);
        u.uMoonPos.value.set(-sunPos.x, horizon - sunPos.y);
        const glow = sunriseGlow(angle);
        u.uGlowA.value = glow ? glow.a * 0.85 : 0;
        if (glow) u.uGlowCol.value.setRGB(glow.r, glow.g, glow.b, THREE.SRGBColorSpace);
        u.uGlowX.value = Math.max(-W / 2, Math.min(W / 2, sunPos.x));
        u.uStarA.value = starBrightness(angle) * 2 * num(params.stars, 1);
        // 星空转得比天体慢（真实的转速下一帧里拖出一道道短线，像下雨）
        u.uStarTurn.value = angle * Math.PI * 2 * 0.3;
        if (text) {
          text.object.position.set(0, horizon - bottom + H * 0.08, 1);
          text.setOpacity(t <= win.cutTime ? progress(t, labelIn) : 1 - progress(t, { start: win.out.end - (win.out.end - win.out.start) * 0.4, end: win.out.end }));
        }
      },
      dispose() {
        quad.dispose();
      },
    };
  },
};

export default template;
