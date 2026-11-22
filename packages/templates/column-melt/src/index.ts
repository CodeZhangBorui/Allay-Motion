// 093 逐列融化 allay.builtin.column-melt（docs/templates/column-melt.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 画面按竖条分开，每条以不同的先后从起始边流下来盖满；退出时一条条继续往下流走（或缩回去）。不用任何贴图：
// 填充是纯色、跟着列一起移动的渐变，或两色相间的条。每列前沿、后沿的位置在 update(t) 里按 t 算好写进一张小贴图
// （只改数据，不新建贴图），着色器只读它和 uniform。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num, str } from '../../_lib/src/gui-kit';
import { GLSL_COMMON, linearColor, outputPixel, shaderQuad } from '../../_lib/src/shader-kit';
import { progress, transitionWindows } from '../../_lib/src/timing';
import { columnDelays, columnProgress, DIRECTIONS, SHEEN_REACH, travel, travelRange } from './layout';

const SHAPES = ['flat', 'round', 'point', 'drop'] as const;
const FILLS = ['solid', 'gradient', 'stripes'] as const;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
uniform sampler2D uEdges;
uniform float uCols;
uniform float uDir;
uniform float uLen;
uniform float uCross;
uniform float uDrip;
uniform float uShape;
uniform float uTailShape;
uniform float uFill;
uniform float uSheen;
uniform float uMargin;
uniform float uTail;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vPos;

/** 末端形状：列内横向位置 u（−1–1）处的边比列中心靠后多少（0–1，乘 uDrip） */
float shapeBack(float u, float shape) {
  float a = abs(u);
  if (shape < 0.5) return 0.0;
  if (shape < 1.5) return 1.0 - sqrt(max(0.0, 1.0 - a * a));
  if (shape < 2.5) return a;
  float k = a / 0.42;
  return k < 1.0 ? 1.0 - sqrt(1.0 - k * k) * 0.999 : 1.0;
}

void main() {
  vec2 S = uStage * 0.5;
  // s：离起始边的距离；c：沿起始边的坐标
  float s;
  float c;
  if (uDir < 0.5) { s = S.y - vPos.y; c = vPos.x + S.x; }
  else if (uDir < 1.5) { s = vPos.y + S.y; c = vPos.x + S.x; }
  else if (uDir < 2.5) { s = S.x - vPos.x; c = S.y - vPos.y; }
  else { s = vPos.x + S.x; c = S.y - vPos.y; }
  float w = uCross / uCols;
  float fi = clamp(floor(c / w), 0.0, uCols - 1.0);
  vec4 e = texelFetch(uEdges, ivec2(int(fi), 0), 0);
  float u = clamp((c - fi * w) / w * 2.0 - 1.0, -1.0, 1.0);
  float lead = e.r - shapeBack(u, uShape) * uDrip;
  float tail = e.g + shapeBack(u, uTailShape) * uDrip * uTail;
  float aa = max(fwidth(s), 1e-3) * 0.75;
  float cov = smoothstep(lead + aa, lead - aa, s) * smoothstep(tail - aa, tail + aa, s);
  if (cov <= 0.0) discard;
  vec3 col = uColorA;
  if (uFill > 1.5) {
    col = mod(fi, 2.0) < 0.5 ? uColorA : uColorB;
  } else if (uFill > 0.5) {
    // 渐变跟着列一起走：e.b 是这一列内容的位移（停留时所有列对齐，上面是 A、下面是 B）
    float g = clamp((e.b - uDrip - uMargin - s) / uLen, 0.0, 1.0);
    col = mix(uColorB, uColorA, g);
  }
  // 前沿后面一点的亮线和前沿上一点暗边：像有厚度的液体
  float dist = lead - s;
  float band = smoothstep(0.10 * w, 0.18 * w, dist) * (1.0 - smoothstep(0.24 * w, ${SHEEN_REACH.toFixed(2)} * w, dist));
  col = mix(col, vec3(1.0), uSheen * 0.45 * band);
  col *= 1.0 - uSheen * 0.35 * (1.0 - smoothstep(0.0, 0.08 * w, dist));
  gl_FragColor = vec4(col, cov);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.7);
    const hold = num(params.hold, 0.15);
    const outDuration = num(params.outDuration, 0.7);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const direction = DIRECTIONS.find((d) => d === params.direction) ?? 'down';
    const dirIndex = DIRECTIONS.indexOf(direction);
    const shape = SHAPES.find((s) => s === params.drip) ?? 'round';
    const fill = FILLS.find((f) => f === params.fill) ?? 'gradient';
    const retract = str(params.outMode, 'continue') === 'retract';
    const volume = num(params.volume, 0.7);

    const vertical = direction === 'down' || direction === 'up';
    const length = vertical ? stage.height : stage.width;
    const cross = vertical ? stage.width : stage.height;
    const cols = Math.max(2, Math.round(num(params.columns, 32)));
    const w = cross / cols;
    // 末端形状的长度：圆头是半个列宽，尖头、水滴更长
    const drip = shape === 'flat' ? 0 : shape === 'round' ? w / 2 : shape === 'point' ? w * 0.8 : w * 1.1;
    // 两端的余量：几个输出像素（低分辨率下抗锯齿的软边更宽）
    const pad = 4 * outputPixel(stage) + 4;
    // 前沿走到头时，后面的光泽也要出画面（末端两侧比列中心靠后 drip，光泽又在前沿后面最多 SHEEN_REACH 个列宽）
    const range = travelRange(length, drip, pad, SHEEN_REACH * w);
    const variance = num(params.variance, 0.45);
    const dIn = columnDelays(cols, variance, ctx.random('in'));
    const dOut = columnDelays(cols, variance, ctx.random('out'));

    // 每列一格：R 前沿、G 后沿、B 内容的位移（离起始边的距离）
    const data = new Float32Array(cols * 4);
    const edges = new THREE.DataTexture(data, cols, 1, THREE.RGBAFormat, THREE.FloatType);
    edges.magFilter = THREE.NearestFilter;
    edges.minFilter = THREE.NearestFilter;
    edges.generateMipmaps = false;
    edges.needsUpdate = true;

    const u = {
      uEdges: { value: edges },
      uCols: { value: cols },
      uDir: { value: dirIndex },
      uLen: { value: length },
      uCross: { value: cross },
      uDrip: { value: drip },
      uShape: { value: SHAPES.indexOf(shape) },
      // 后沿（尾巴）：水滴的尾巴用圆头，其余和前端一样
      uTailShape: { value: SHAPES.indexOf(shape === 'drop' ? 'round' : shape) },
      uFill: { value: FILLS.indexOf(fill) },
      uSheen: { value: num(params.sheen, 0.35) },
      uMargin: { value: pad },
      // 后沿的形状：继续流走时后沿也带同样的圆头（尾巴），缩回去时没有后沿
      uTail: { value: retract ? 0 : 1 },
      uColorA: { value: linearColor(ctx, params.colorA, '#3B1D5E') },
      uColorB: { value: linearColor(ctx, params.colorB, '#E0457B') },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    if (typeof params.inSound === 'string') ctx.audio.cue(params.inSound, win.in.start, { gain: volume });
    if (typeof params.outSound === 'string') ctx.audio.cue(params.outSound, win.out.start, { gain: volume });

    const eased = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : ease(x));
    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        const p = entering ? progress(t, win.in) : progress(t, win.out);
        for (let i = 0; i < cols; i++) {
          let lead: number;
          let tail: number;
          let offset: number;
          if (entering) {
            lead = travel(eased(columnProgress(p, dIn[i]!)), range.leadFrom, range.to);
            tail = -1e6;
            offset = lead;
          } else if (retract) {
            lead = travel(1 - eased(columnProgress(p, dOut[i]!)), range.leadFrom, range.to);
            tail = -1e6;
            offset = lead;
          } else {
            // 继续流走：后沿追上去，列里的内容跟着后沿一起往前走
            lead = 1e6;
            tail = travel(eased(columnProgress(p, dOut[i]!)), range.tailFrom, range.to);
            offset = range.to + (tail - range.tailFrom);
          }
          data[i * 4] = lead;
          data[i * 4 + 1] = tail;
          data[i * 4 + 2] = offset;
        }
        edges.needsUpdate = true;
      },
      dispose() {
        quad.dispose();
        edges.dispose();
      },
    };
  },
};

export default template;
