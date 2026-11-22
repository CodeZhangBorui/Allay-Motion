// 095 附魔光扫 allay.builtin.glint-sweep（docs/templates/glint-sweep.md）。叠加层。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 附魔光效的贴图（misc/enchanted_glint_*）按两层、两个角度滚动，只在一条斜着扫过的光带里显示；可以只扫过一张图片的范围。
// 游戏里光效是加法混合的，导出是直通 alpha，表达不了“只加亮”（docs/template-catalog.md 3.3）：这里把贴图的亮度当覆盖率，
// 用光效的颜色普通混合。暗的画面上看起来和发光差不多，亮的画面上是一层紫色。贴图缺失时用程序画的斜纹代替。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num, str } from '../../_lib/src/gui-kit';
import { GLSL_COMMON, linearColor, optionalTexture, shaderQuad } from '../../_lib/src/shader-kit';
import { fadeInOut } from '../../_lib/src/fade';
import { overlayWindows, progress } from '../../_lib/src/timing';
import { bandCenter, extentAlong } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform sampler2D uGlint;
uniform float uHasGlint;
uniform sampler2D uImage;
uniform float uHasImage;
uniform float uImageSize;
uniform vec3 uTint;
uniform float uStrength;
uniform float uBase;
uniform float uEnvelope;
uniform vec2 uDir;
uniform float uBand;
uniform float uHalfWidth;
uniform float uTime;
uniform float uSpeed;
uniform float uTile;
varying vec2 vPos;

/** 两层光效叠起来的亮度（线性），角度不同、滚动的方向和快慢不同（游戏里也是两层叠起来） */
float glintAt(vec2 p) {
  vec2 a = rot2(-0.87) * p / uTile + vec2(uTime * uSpeed * 0.11, 0.0);
  vec2 b = rot2(0.17) * p / (uTile * 1.37) + vec2(-uTime * uSpeed * 0.07, uTime * uSpeed * 0.02);
  float g;
  if (uHasGlint > 0.5) {
    g = luma(bilerpRepeat(uGlint, a).rgb) + luma(bilerpRepeat(uGlint, b).rgb);
  } else {
    // 没有贴图时：两组细斜纹，按噪声起伏
    float sa = pow(0.5 + 0.5 * sin(a.x * 37.0 + vnoise(a * 3.0, 11u) * 4.0), 10.0);
    float sb = pow(0.5 + 0.5 * sin(b.x * 29.0 + vnoise(b * 3.0, 23u) * 4.0), 10.0);
    g = (sa + sb) * 0.12;
  }
  return g;
}

void main() {
  vec2 p = vPos;
  float s = dot(p, uDir);
  float x = abs(s - uBand) / uHalfWidth;
  float d = min(1.0, x);
  float band = 1.0 - d * d * (3.0 - 2.0 * d);
  vec4 col = vec4(0.0);
  float region = 1.0;
  if (uHasImage > 0.5) {
    // 图片：放在中间，长边 uImageSize；光效只在图片不透明的地方
    vec2 size = vec2(textureSize(uImage, 0));
    vec2 hs = size / max(size.x, size.y) * uImageSize * 0.5;
    vec2 f = p / hs * 0.5 + 0.5;
    if (f.x < 0.0 || f.y < 0.0 || f.x > 1.0 || f.y > 1.0) discard;
    vec4 c = texture2D(uImage, f);
    col = pm(c.rgb, c.a * uEnvelope);
    region = c.a;
  }
  // 贴图很暗（亮的条纹线性亮度也只有 0.2 左右），放大到条纹接近不透明、暗处留一层薄的
  float g = glintAt(p) * 4.0;
  float a = clamp(g, 0.0, 1.0) * uStrength * clamp(band + uBase, 0.0, 1.0) * region * uEnvelope;
  // 最亮的条纹偏白一点，像光效的高光
  vec3 light = mix(uTint, vec3(1.0), clamp((g - 0.9) * 0.5, 0.0, 0.45));
  col = over(pm(light, a), col);
  if (col.a <= 0.0) discard;
  gl_FragColor = straight(col);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.3);
    const hold = num(params.hold, 1.4);
    const outDuration = num(params.outDuration, 0.3);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const volume = num(params.volume, 0.6);
    const sweeps = Math.max(1, Math.round(num(params.sweeps, 1)));
    const angle = (num(params.angle, 25) * Math.PI) / 180;
    const short = Math.min(stage.width, stage.height);

    // 光效贴图：26.2 起盔甲的光效叫 enchanted_glint_armor，更早叫 enchanted_glint_entity（对照过游戏文件）
    const glint = str(params.glint, 'item') === 'armor' ? await optionalTexture(ctx, ['minecraft:misc/enchanted_glint_armor', 'minecraft:misc/enchanted_glint_entity']) : await optionalTexture(ctx, ['minecraft:misc/enchanted_glint_item']);
    const imageId = str(params.image, '');
    const image = imageId === '' ? null : await ctx.resources.texture(imageId);
    const imageSize = num(params.imageScale, 0.6) * short;
    const halfWidth = Math.max(1, num(params.width, 0.35) * short * 0.5);
    // 有图片时只扫过图片：沿扫过方向的范围按图片的外接圆算
    const extent = image ? imageSize * 0.75 : extentAlong(stage.width / 2, stage.height / 2, angle);

    const u = {
      uGlint: { value: glint },
      uHasGlint: { value: glint ? 1 : 0 },
      uImage: { value: image },
      uHasImage: { value: image ? 1 : 0 },
      uImageSize: { value: imageSize },
      uTint: { value: linearColor(ctx, params.tint, '#9B5CFF') },
      uStrength: { value: num(params.strength, 0.85) },
      uBase: { value: num(params.base, 0.15) },
      uEnvelope: { value: 0 },
      uDir: { value: new THREE.Vector2(Math.cos(angle), Math.sin(angle)) },
      uBand: { value: 0 },
      uHalfWidth: { value: halfWidth },
      uTime: { value: 0 },
      uSpeed: { value: num(params.speed, 1) },
      uTile: { value: short * 0.55 },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    if (typeof params.sound === 'string') ctx.audio.cue(params.sound, win.in.start, { gain: volume });

    const span = { start: win.in.start, end: win.out.end };
    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        const e = fadeInOut(t, win);
        const q = progress(t, span);
        u.uEnvelope.value = e;
        u.uBand.value = bandCenter(q >= 1 ? sweeps : (q <= 0 ? 0 : ease(q)) * sweeps, extent, halfWidth);
        u.uTime.value = t;
      },
      dispose() {
        quad.dispose();
      },
    };
  },
};

export default template;
