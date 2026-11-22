// 094 故障色块 allay.builtin.glitch-blocks（docs/templates/glitch-blocks.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 一块全屏着色器，不用任何贴图，只画色块，不扭曲底下的视频（那做不到，docs/template-catalog.md 3.3）。
// 画面按色块的高度分成横条，每一条每一步随机错开、随机合并成长条；每一块按散列和覆盖率比较决定显不显示。
// 步按帧对齐（_lib 的 frameStep：换步的时刻在两帧正中间），同一帧的运动模糊子帧看到同一步，色块是清楚的一块，不叠成重影；
// 覆盖率也按步取（这一步开始时的值），只有雪花块里的雪花每帧换一次。覆盖率在 layout.ts 里算（一阵阵闪出来），
// 着色器只读 uniform，仍是 t 的纯函数。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num } from '../../_lib/src/gui-kit';
import { framesPerStep, frameStep, GLSL_COMMON, linearColor, shaderQuad, shaderSeed, stepStart } from '../../_lib/src/shader-kit';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { burstAt, coverIn, coverOut, jittered, stepJitter } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform float uStep;
uniform float uFrame;
uniform float uCover;
uniform float uBlock;
uniform float uSplit;
uniform float uShift;
uniform float uNoise;
uniform float uTear;
uniform float uSeed;
uniform vec3 uBase;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec2 vPos;

/** 位置 p 处的色块：返回颜色，a 为 1 表示这里有色块 */
vec4 block(vec2 p, uint seed) {
  float row = floor(p.y / uBlock);
  uint hr = hashU(uvec3(uint(row + 4096.0), seed, 17u));
  // 这一条横条：一部分横向错开，块合并成 1–6 格长的条
  float shift = hashF(hr) < 0.45 ? (hashF(hashU(hr ^ 0x51u)) - 0.5) * uShift * uStage.x : 0.0;
  float run = 1.0 + floor(hashF(hashU(hr ^ 0xa3u)) * 6.0);
  float x = p.x + shift;
  float cell = floor(x / (uBlock * run));
  uint hc = hashU(uvec3(uint(cell + 65536.0), uint(row + 4096.0), seed));
  if (!(hashF(hc) < uCover)) return vec4(0.0);
  float h = hashF(hashU(hc ^ 0x2c1bu));
  // 覆盖率低的时候看得见的块多是亮色；盖满时多是底色
  float baseShare = mix(0.1, 0.78, uCover * uCover);
  vec3 col;
  if (h < baseShare) col = uBase;
  else {
    float k = (h - baseShare) / (1.0 - baseShare);
    col = k < 0.4 ? uA : k < 0.75 ? uB : uC;
  }
  // 一部分块是雪花：块里再分小格，每格一个灰度
  if (hashF(hashU(hc ^ 0x7f4au)) < uNoise) {
    // 雪花每帧都换（色块的排布按步换）
    float g = rand2(ivec2(floor(vec2(x, p.y) / max(2.0, uBlock / 6.0))), hc ^ hashU(uint(uFrame) + 7u));
    col = mix(uBase, uA, g * g);
  } else if (hashF(hashU(hc ^ 0x33u)) < 0.18) {
    // 少数块是横线纹
    float l = step(0.5, fract(p.y / max(2.0, uBlock / 5.0)));
    col = mix(col, uBase, l * 0.7);
  }
  return vec4(col, 1.0);
}

void main() {
  uint seed = hashU(uvec2(uint(uStep) + 1u, uint(uSeed)));
  // 色块自己的色散：红、绿、蓝三个通道各取左右错开的位置
  vec4 r = block(vPos - vec2(uSplit, 0.0), seed);
  vec4 g = block(vPos, seed);
  vec4 b = block(vPos + vec2(uSplit, 0.0), seed);
  float a = max(r.a, max(g.a, b.a));
  vec3 c = vec3(r.r * r.a, g.g * g.a, b.b * b.a);
  // 横贯全屏的细亮线（撕裂）
  float fine = floor(vPos.y / 3.0);
  if (rand2(ivec2(int(fine), 7), seed) < uTear * uCover * 0.03) {
    c = uA;
    a = 1.0;
  }
  if (a <= 0.0) discard;
  gl_FragColor = vec4(c / a, a);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.55);
    const hold = num(params.hold, 0.2);
    const outDuration = num(params.outDuration, 0.55);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const bursts = Math.max(1, Math.round(num(params.bursts, 4)));
    // 一步几帧：步频按帧率取整（60 fps、15 次每秒就是 4 帧一步）
    const stepFrames = framesPerStep(1 / Math.max(1, num(params.stepRate, 15)), stage.fps);
    const seed = shaderSeed(params.seed);
    const volume = num(params.volume, 0.55);

    const u = {
      uStep: { value: 0 },
      uFrame: { value: 0 },
      uCover: { value: 0 },
      uBlock: { value: Math.max(4, num(params.blockSize, 48)) },
      uSplit: { value: num(params.rgbSplit, 10) },
      uShift: { value: num(params.bandShift, 0.5) },
      uNoise: { value: num(params.noiseBlocks, 0.25) },
      uTear: { value: num(params.tears, 0.5) },
      uSeed: { value: seed },
      uBase: { value: linearColor(ctx, params.baseColor, '#101014') },
      uA: { value: linearColor(ctx, params.colorA, '#E8E8E8') },
      uB: { value: linearColor(ctx, params.colorB, '#00D9FF') },
      uC: { value: linearColor(ctx, params.colorC, '#FF3D5A') },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    // 音效：每一阵一个，音高随机（同一种声音最多 12 个，阵数最多 6，进出加起来正好 12）
    if (typeof params.sound === 'string') {
      const rng = ctx.random('sound');
      const at = (w: { start: number; end: number }, x: number) => w.start + x * (w.end - w.start);
      for (let k = 0; k < bursts; k++) {
        ctx.audio.cue(params.sound, at(win.in, burstAt(k, bursts)), { gain: volume, rate: 0.7 + rng.next() * 0.9 });
        ctx.audio.cue(params.sound, at(win.out, 1 - burstAt(k, bursts)), { gain: volume * 0.8, rate: 0.7 + rng.next() * 0.9 });
      }
    }

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const step = frameStep(t, stage.fps, stepFrames);
        // 覆盖率取这一步开始时的值；两端照旧精确：进入结束后为 1，退出结束后为 0
        const ts = Math.max(stepStart(step, stage.fps, stepFrames), 0);
        let raw: number;
        if (t <= win.cutTime) raw = t >= win.in.end ? 1 : coverIn(eased(Math.max(ts, win.in.start), win.in, ease), bursts);
        else raw = t >= win.out.end ? 0 : t <= win.out.start ? 1 : coverOut(eased(Math.max(ts, win.out.start), win.out, ease), bursts);
        u.uStep.value = step;
        u.uFrame.value = Math.round(t * stage.fps);
        u.uCover.value = jittered(raw, stepJitter(step, seed));
      },
      dispose() {
        quad.dispose();
      },
    };
  },
};

export default template;
