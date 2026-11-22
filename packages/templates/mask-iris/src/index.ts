// 092 图形光圈 allay.builtin.mask-iris（docs/templates/mask-iris.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 一个图形的轮廓从大缩到小把画面收黑，停在剪辑点，再放大打开。图形可以是程序画的圆、望远镜的视野框
// （misc/spyglass_scope）、旗帜图案（entity/banner/*，灰度遮罩）或自己的图片。旗帜图案和视野框缺失时退回程序画的形状。
// 一块全屏着色器，光圈大小、角度、填充的不透明度由 layout.ts 按 t 算好当 uniform。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { bool, num, str } from '../../_lib/src/gui-kit';
import { GLSL_COMMON, linearColor, outputPixel, shaderQuad } from '../../_lib/src/shader-kit';
import { eased, progress, transitionWindows } from '../../_lib/src/timing';
import { fillAlpha, GEOMETRY, irisScale, MASKS, startScale, type MaskKind } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform float uScale;
uniform vec2 uCenter;
uniform float uAngle;
uniform float uShader;
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec2 uAnchor;
uniform float uPix;
uniform float uSmooth;
uniform vec3 uFill;
uniform float uFillA;
uniform float uChannel;
varying vec2 vPos;

/** 贴图在形状坐标 q（贴图像素，左上角原点、y 向下）处，size 是贴图宽高（像素） */
vec4 texAt(vec2 q, vec2 size) {
  vec4 c;
  if (uSmooth > 0.5) c = textureLod(uTex, vec2(q.x / size.x, 1.0 - q.y / size.y), 0.0);
  else c = texelFetch(uTex, ivec2(clamp(floor(vec2(q.x, size.y - q.y)), vec2(0.0), size - 1.0)), 0);
  return c;
}

void main() {
  vec2 p = vPos;
  // 像素化：先把画面坐标吸附到格子上（只对程序画的圆有意义；贴图本身就是像素画）
  if (uPix > 0.0 && uShader < 0.5) p = snapTo(p, uPix);
  p = rot2(-uAngle) * (p - uCenter);
  vec4 col = pm(uFill, uFillA);
  if (uScale > 0.0) {
    if (uShader < 0.5 || uHasTex < 0.5 && uShader < 2.5) {
      // 圆（也是旗帜图案缺失时的退回画法）；望远镜缺失时画方框
      float aa = max(fwidth(p.x), 1e-3) / uScale;
      if (uShader > 0.5 && uShader < 1.5) {
        vec2 q = abs(p / uScale);
        float d = max(q.x, q.y);
        float hole = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
        // 框：外圈 1/8 宽，颜色比填充亮一点
        float frame = smoothstep(0.875 - aa, 0.875 + aa, d) * hole;
        col = mix(col, pm(uFill + vec3(0.06), uFillA), frame);
        col *= 1.0 - (hole - frame);
      } else {
        float d = length(p / uScale);
        float hole = uPix > 0.0 ? step(d, 1.0) : 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
        col *= 1.0 - hole;
      }
    } else if (uShader < 1.5) {
      // 望远镜：方框，贴图里的边框和镜片原样画（镜片几乎透明，带一点蓝），框外是填充
      vec2 size = vec2(textureSize(uTex, 0));
      vec2 q = vec2(p.x, -p.y) / uScale * (size.x / 256.0) + size * 0.5;
      if (q.x >= 0.0 && q.y >= 0.0 && q.x < size.x && q.y < size.y) {
        vec4 s = texAt(q, size);
        col = pm(s.rgb, s.a * uFillA);
      }
    } else {
      vec2 size = vec2(textureSize(uTex, 0));
      vec2 q;
      bool inside;
      if (uShader < 2.5) {
        // 旗帜图案：形状坐标是 64 × 64 贴图的像素（高清资源包按比例换算），只看正面 (1, 1)–(21, 41) 那一块
        vec2 k = size / 64.0;
        q = (vec2(p.x, -p.y) / uScale + uAnchor) * k;
        inside = q.x >= k.x && q.y >= k.y && q.x < 21.0 * k.x && q.y < 41.0 * k.y;
      } else {
        // 自己的图片：形状坐标以图片的短边为 1，中心在图片中心
        q = vec2(p.x, -p.y) / uScale * min(size.x, size.y) + size * 0.5;
        inside = q.x >= 0.0 && q.y >= 0.0 && q.x < size.x && q.y < size.y;
      }
      if (inside) {
        vec4 s = texAt(q, size);
        float m = uChannel > 0.5 ? luma(s.rgb) * s.a : s.a;
        col *= 1.0 - m;
      }
    }
  }
  if (col.a <= 0.0) discard;
  gl_FragColor = straight(col);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.8);
    const hold = num(params.hold, 0.15);
    const outDuration = num(params.outDuration, 0.7);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const volume = num(params.volume, 0.7);
    let kind: MaskKind = MASKS.find((m) => m === params.mask) ?? 'circle';

    // 贴图：望远镜和旗帜图案用可选贴图（缺失时退回程序画的形状，不记警告）；自己的图片按参数原样取
    let texture = null;
    if (kind === 'spyglass') texture = await ctx.resources.texture('minecraft:misc/spyglass_scope', { optional: true });
    else if (kind === 'image') {
      const image = str(params.image, '');
      if (image === '') kind = 'circle';
      else texture = await ctx.resources.texture(image);
    } else if (kind !== 'circle') {
      texture = await ctx.resources.texture(`minecraft:entity/banner/${kind}`, { optional: true });
      if (!texture) kind = 'circle';
    }
    const geom = GEOMETRY[kind];

    const cx = num(params.centerX, 0) * stage.width;
    const cy = num(params.centerY, 0) * stage.height;
    const px = outputPixel(stage);
    const short = Math.min(stage.width, stage.height);
    const s0 = startScale(kind, stage.width / 2, stage.height / 2, cx, cy, 4 * px);
    // 停顿的大小：图形的名义大小占画面短边的 linger；不停时按 0.9 算（整个图形刚好进到画面里），再一路收完
    const linger = num(params.linger, 0.3);
    const curve = { s0, sl: ((linger > 0 ? linger : 0.9) * short) / geom.extent, lingerTime: linger > 0 ? num(params.lingerTime, 0.25) : 0 };
    // 填充只对自己的图片淡入（形状不知道，开头不一定整个画面都在透空的地方）；其余图形开头本来就把画面整个装着
    const ramp = kind === 'image';
    const turn = (num(params.rotate, 0) * Math.PI) / 180;

    const u = {
      uScale: { value: s0 },
      uCenter: { value: new THREE.Vector2(cx, cy) },
      uAngle: { value: 0 },
      uShader: { value: geom.shader },
      uTex: { value: texture },
      uHasTex: { value: texture ? 1 : 0 },
      uAnchor: { value: new THREE.Vector2(geom.anchor[0], geom.anchor[1]) },
      uPix: { value: bool(params.pixelate, true) ? Math.max(1, num(params.pixelSize, 10)) : 0 },
      uSmooth: { value: bool(params.pixelate, true) ? 0 : 1 },
      uFill: { value: linearColor(ctx, params.fillColor, '#000000') },
      uFillA: { value: 0 },
      uChannel: { value: str(params.imageChannel, 'alpha') === 'luminance' ? 1 : 0 },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    if (typeof params.closeSound === 'string') ctx.audio.cue(params.closeSound, win.in.start, { gain: volume });
    if (typeof params.openSound === 'string') ctx.audio.cue(params.openSound, win.out.start, { gain: volume });

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const closing = t <= win.cutTime;
        // 关上：p 从 0 到 1；打开：倒过来
        const p = closing ? eased(t, win.in, ease) : 1 - eased(t, win.out, ease);
        u.uScale.value = irisScale(p, curve);
        u.uAngle.value = turn * p;
        u.uFillA.value = !ramp ? (closing ? (t <= win.in.start ? 0 : 1) : t >= win.out.end ? 0 : 1) : closing ? fillAlpha(progress(t, win.in)) : fillAlpha(1 - progress(t, win.out));
      },
      dispose() {
        quad.dispose();
      },
    };
  },
};

export default template;
