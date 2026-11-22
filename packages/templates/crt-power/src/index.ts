// 091 显像管 allay.builtin.crt-power（docs/templates/crt-power.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 整个画面是一块全屏着色器，不用任何贴图。每个时刻的状态（开口大小、亮度、雪花、扫描线）由 layout.ts 的纯函数给出，
// 着色器只读 uniform；雪花按 floor(t / 步长) 换种子，仍然是 t 的纯函数。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num } from '../../_lib/src/gui-kit';
import { framesPerStep, frameStep, GLSL_COMMON, linearColor, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { edgeWidth, powerOff, powerOn, type CrtOptions } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform vec2 uHalf;
uniform float uRadius;
uniform float uEdge;
uniform float uCover;
uniform float uBright;
uniform float uStatic;
uniform float uScan;
uniform float uGlow;
uniform float uBlack;
uniform vec3 uLine;
uniform vec3 uScreen;
uniform float uGap;
uniform float uGrain;
uniform float uFrame;
uniform float uSeed;
uniform float uTime;
uniform float uLineW;
varying vec2 vPos;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vPos;
  float inside = 0.0;
  float d = 1e6;
  if (uHalf.x > 0.0 && uHalf.y > 0.0) {
    d = sdRound(p, uHalf, uRadius);
    inside = 1.0 - smoothstep(-uEdge, uEdge, d);
  }
  // 开口里：雪花（按步长换一次种子），亮线的颜色，扫描线
  vec4 inner = vec4(0.0);
  if (uStatic > 0.0) {
    uint s = uint(uSeed) ^ hashU(uint(uFrame) + 1u);
    float n = rand2(ivec2(floor(p / uGrain)), s);
    float row = rand1(int(floor(p.y / (uGrain * 2.0))), s ^ 0x9e3779b9u);
    // 一条慢慢往下滚的亮带：同步还没稳住的样子
    float y = fract(0.5 - p.y / uStage.y * 0.8 - uTime * 0.7);
    float band = exp(-pow((y - 0.5) * 5.0, 2.0));
    vec3 snow = uLine * clamp((0.08 + 0.92 * n * n) * (0.75 + 0.25 * row) * (0.85 + 0.45 * band), 0.0, 1.0);
    inner = pm(snow, uStatic);
  }
  inner = over(pm(mix(uScreen, uLine, uBright), uCover), inner);
  if (uScan > 0.0) {
    float c = 0.5 + 0.5 * cos(6.2831853 * p.y / uGap);
    inner = over(pm(vec3(0.0), uScan * c * c), inner);
  }
  // 开口外面：关掉的屏幕，上面是亮线、亮点的光晕（普通混合的近似：画在黑底上和加亮一样）
  vec4 outer = pm(uScreen, uBlack);
  if (uGlow > 0.0 && uBlack > 0.5) {
    float halo = uGlow * exp(-max(d, 0.0) / max(uLineW * 7.0, 18.0));
    outer = over(pm(uLine, halo * 0.6), outer);
  }
  // 软边处按覆盖率在里外两种内容之间插值（不是叠放），亮线的边才不会透出底下的画面
  gl_FragColor = straight(mix(outer, inner, inside));
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.55);
    const hold = num(params.hold, 0.2);
    const outDuration = num(params.outDuration, 0.75);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    // 雪花每步几帧：换步的时刻对齐到两帧之间，同一帧的子帧看到同一张雪花（不叠成重影）
    const staticFrames = framesPerStep(num(params.staticStep, 0.05), stage.fps);
    const volume = num(params.volume, 0.7);

    const o: CrtOptions = {
      halfW: stage.width / 2,
      halfH: stage.height / 2,
      line: Math.max(0.5, num(params.lineWidth, 3)),
      curvature: num(params.curvature, 0.45),
      staticAmount: num(params.staticAmount, 0.75),
      scanlines: num(params.scanlines, 0.35),
      glow: num(params.glow, 0.6),
    };

    const u = {
      uHalf: { value: new THREE.Vector2(o.halfW, o.halfH) },
      uRadius: { value: 0 },
      uEdge: { value: 1 },
      uCover: { value: 0 },
      uBright: { value: 1 },
      uStatic: { value: 0 },
      uScan: { value: 0 },
      uGlow: { value: 0 },
      uBlack: { value: 0 },
      uLine: { value: linearColor(ctx, params.lineColor, '#E6F1FF') },
      uScreen: { value: linearColor(ctx, params.screenColor, '#000000') },
      uGap: { value: Math.max(2, num(params.scanlineGap, 6)) },
      uGrain: { value: Math.max(1, num(params.grain, 3)) },
      uFrame: { value: 0 },
      uSeed: { value: shaderSeed(params.seed) },
      uTime: { value: 0 },
      uLineW: { value: o.line },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    // 关机的声音在压扁开始时，开机的声音在亮点出现时
    if (typeof params.offSound === 'string') ctx.audio.cue(params.offSound, win.in.start, { gain: volume });
    if (typeof params.onSound === 'string') ctx.audio.cue(params.onSound, win.out.start, { gain: volume });

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const s = t <= win.cutTime ? powerOff(eased(t, win.in, ease), o) : powerOn(eased(t, win.out, ease), o);
        u.uHalf.value.set(s.hx, s.hy);
        u.uRadius.value = s.radius;
        u.uEdge.value = edgeWidth(s.hx, s.hy);
        u.uCover.value = s.cover;
        u.uBright.value = s.bright;
        u.uStatic.value = s.staticA;
        u.uScan.value = s.scanA;
        u.uGlow.value = s.glowA;
        u.uBlack.value = s.black ? 1 : 0;
        u.uFrame.value = frameStep(t, stage.fps, staticFrames);
        u.uTime.value = t;
      },
      dispose() {
        quad.dispose();
      },
    };
  },
};

export default template;
