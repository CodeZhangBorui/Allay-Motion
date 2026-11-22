// 061 穿云 allay.builtin.cloud-pass（docs/templates/cloud-pass.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 镜头往上（或往下）穿过一层游戏里那种方块云：远处的云块在雾里淡淡的，越近越大，进到云里整个画面白掉（剪辑点），
// 穿出去以后云在身后、视野清空。云的形状取自 environment/clouds（256 × 256，每个像素一块 12 × 12 格、4 格厚的云），
// 着色器按视线在云块的格子里一格格走（DDA），碰到云块按碰到的面上明暗（顶 1.0、底 0.7、侧面 0.9 / 0.8）。
// “平面”样式是游戏里的“快速”云：一层没有厚度的平面。贴图缺失时云的形状由噪声生成（程序的形状，不是贴图）。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num, str } from '../../_lib/src/gui-kit';
import { GLSL_COMMON, linearColor, optionalTexture, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { approach, CLOUD_CELL, CLOUD_HEIGHT, DIRECTIONS, FOG_END, FOV, leave, PITCH, startDistance, whiteout } from './layout';

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
#define CELL ${CLOUD_CELL.toFixed(1)}
#define SLAB ${CLOUD_HEIGHT.toFixed(1)}
#define FOG_END ${FOG_END.toFixed(1)}
uniform vec3 uCam;
uniform vec3 uFwd;
uniform vec3 uUp;
uniform float uTanHalf;
uniform sampler2D uMap;
uniform float uFancy;
uniform float uDensity;
uniform vec3 uColor;
uniform float uWhite;
uniform float uPresence;
uniform float uScroll;
uniform float uSeed;
uniform float uTime;
varying vec2 vUv;

uniform vec2 uCore;
bool cloudy(ivec2 c) {
  // 镜头穿过的地方一定有一大团云（原版的云图上那里可能正好是空的）：半径三格多、边缘按噪声参差的一团
  vec2 dc = vec2(c) + 0.5 - uCore;
  if (length(dc) < 3.4 * (0.7 + 0.6 * vnoise(vec2(c) * 0.45, uint(uSeed) ^ 0x5cu))) return true;
  vec2 size = vec2(textureSize(uMap, 0));
  ivec2 m = ivec2(mod(vec2(c), size));
  return texelFetch(uMap, m, 0).a > 0.5 && rand2(c, uint(uSeed)) < uDensity;
}

/** 视线碰到的第一块云：rgb 是颜色（已经乘了面的明暗），a 是不透明度（随距离淡进雾里） */
vec4 march(vec3 o, vec3 d) {
  float tmin = 0.0;
  float tmax = FOG_END;
  if (uFancy > 0.5) {
    if (abs(d.y) < 1e-6) {
      if (o.y < 0.0 || o.y > SLAB) return vec4(0.0);
    } else {
      float t0 = (0.0 - o.y) / d.y;
      float t1 = (SLAB - o.y) / d.y;
      tmin = max(min(t0, t1), 0.0);
      tmax = min(tmax, max(t0, t1));
    }
  } else {
    // 平面：云层中间的一层
    if (abs(d.y) < 1e-6) return vec4(0.0);
    float t = (SLAB * 0.5 - o.y) / d.y;
    if (t <= 0.0 || t > FOG_END) return vec4(0.0);
    tmin = t;
    tmax = t;
  }
  if (tmax < tmin) return vec4(0.0);
  vec3 p = o + d * tmin;
  vec2 q = vec2(p.x + uScroll, p.z) / CELL;
  ivec2 c = ivec2(floor(q));
  float fog = 1.0 - smoothstep(FOG_END * 0.3, FOG_END, tmin);
  if (uFancy < 0.5) {
    return cloudy(c) ? vec4(uColor * 0.95, 0.8 * fog) : vec4(0.0);
  }
  vec2 dq = d.xz / CELL;
  ivec2 st = ivec2(dq.x >= 0.0 ? 1 : -1, dq.y >= 0.0 ? 1 : -1);
  vec2 inv = vec2(abs(dq.x) > 1e-9 ? 1.0 / abs(dq.x) : 1e9, abs(dq.y) > 1e-9 ? 1.0 / abs(dq.y) : 1e9);
  vec2 next = vec2(
    abs(dq.x) > 1e-9 ? ((dq.x > 0.0 ? floor(q.x) + 1.0 - q.x : q.x - floor(q.x)) * inv.x) : 1e9,
    abs(dq.y) > 1e-9 ? ((dq.y > 0.0 ? floor(q.y) + 1.0 - q.y : q.y - floor(q.y)) * inv.y) : 1e9);
  float t = tmin;
  // 第一格是从云层的底（或顶）进来的；镜头本身在云块里时 t = 0
  float shade = d.y > 0.0 ? 0.7 : 1.0;
  if (tmin <= 0.0) shade = 1.0;
  for (int i = 0; i < 48; i++) {
    if (t > tmax) break;
    if (cloudy(c)) {
      float f = 1.0 - smoothstep(FOG_END * 0.3, FOG_END, t);
      return vec4(uColor * shade, 0.8 * f);
    }
    if (next.x < next.y) {
      t = tmin + next.x;
      next.x += inv.x;
      c.x += st.x;
      shade = 0.9;
    } else {
      t = tmin + next.y;
      next.y += inv.y;
      c.y += st.y;
      shade = 0.8;
    }
  }
  return vec4(0.0);
}

void main() {
  vec4 col = vec4(0.0);
  if (uWhite < 0.999) {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 right = normalize(cross(uFwd, uUp));
    vec3 d = normalize(uFwd + right * ndc.x * uTanHalf * (uStage.x / uStage.y) + uUp * ndc.y * uTanHalf);
    vec4 hit = march(uCam, d);
    col = pm(hit.rgb, hit.a * uPresence);
  }
  // 在云里：整个画面白掉，带一点缓缓飘过的明暗
  if (uWhite > 0.0) {
    float mist = vnoise(vec2(vUv.x * 3.0, vUv.y * 2.0 - uTime * 0.8), uint(uSeed) ^ 0x3du);
    col = over(pm(uColor * (0.93 + 0.07 * mist), uWhite), col);
  }
  if (col.a <= 0.0) discard;
  gl_FragColor = straight(col);
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.9);
    const hold = num(params.hold, 0.15);
    const outDuration = num(params.outDuration, 0.8);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const direction = DIRECTIONS.find((d) => d === params.direction) ?? 'up';
    const fancy = str(params.style, 'fancy') !== 'flat';
    const volume = num(params.volume, 0.7);

    // 云的形状：原版的 environment/clouds；没有时按噪声生成一张 64 × 64（约三成是云，和原版差不多）
    let map = await optionalTexture(ctx, ['minecraft:environment/clouds']);
    let own: InstanceType<typeof THREE.DataTexture> | null = null;
    if (!map) {
      const n = 64;
      const data = new Uint8Array(n * n * 4);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const v = ctx.noise2D(i / 7, j / 7, 'clouds') + 0.35 * ctx.noise2D(i / 2.6, j / 2.6, 'clouds2');
          data.set([255, 255, 255, v > 0.28 ? 255 : 0], (j * n + i) * 4);
        }
      }
      own = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
      own.magFilter = THREE.NearestFilter;
      own.minFilter = THREE.NearestFilter;
      own.generateMipmaps = false;
      own.needsUpdate = true;
      map = own;
    }

    const pitch = ((direction === 'down' ? -PITCH : PITCH) * Math.PI) / 180;
    const distance = startDistance();
    const middle = CLOUD_HEIGHT / 2;
    const drift = num(params.speed, 1) * 12;
    // 穿过的那一点（云图坐标，格子为单位）：剪辑点时镜头所在的位置
    const core = [0.6 * win.cutTime, drift * win.cutTime];
    const u = {
      uCore: { value: new THREE.Vector2(core[0]! / CLOUD_CELL, core[1]! / CLOUD_CELL) },
      uCam: { value: new THREE.Vector3() },
      uFwd: { value: new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)) },
      uUp: { value: new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch)) },
      uTanHalf: { value: Math.tan(((FOV / 2) * Math.PI) / 180) },
      uMap: { value: map },
      uFancy: { value: fancy ? 1 : 0 },
      uDensity: { value: num(params.density, 1) },
      uColor: { value: linearColor(ctx, params.color, '#FFFFFF') },
      uWhite: { value: 0 },
      uPresence: { value: 1 },
      uScroll: { value: 0 },
      uSeed: { value: shaderSeed(params.seed) },
      uTime: { value: 0 },
    };
    const quad = shaderQuad(ctx, { fragment: FRAGMENT, uniforms: u });

    if (typeof params.inSound === 'string') ctx.audio.cue(params.inSound, win.in.start, { gain: volume });
    if (typeof params.outSound === 'string') ctx.audio.cue(params.outSound, win.out.start, { gain: volume });

    // 往上穿：进云时抬头看着云底；出云以后低下头来往下看 16°，看见脚下的云海铺开、退远（往下穿反过来）。
    // 只放平到 6° 时云海挤在地平线上的一窄条，大半在雾里
    const pitchIn = pitch;
    const pitchOut = ((direction === 'up' ? -16 : 16) * Math.PI) / 180;
    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        const a = eased(t, win.in, ease);
        const b = eased(t, win.out, ease);
        // 高度：往上穿从下面上来，往下穿倒过来
        const s = entering ? approach(a, distance, middle) : leave(b, distance, middle);
        const y = direction === 'down' ? 2 * middle - s : s;
        u.uCam.value.set(0, y, drift * t);
        u.uWhite.value = whiteout(y - middle, CLOUD_HEIGHT / 2);
        const pt = entering ? pitchIn : pitchIn + (pitchOut - pitchIn) * Math.min(1, b * 1.6);
        u.uFwd.value.set(0, Math.sin(pt), Math.cos(pt));
        u.uUp.value.set(0, Math.cos(pt), -Math.sin(pt));
        u.uScroll.value = t * 0.6;
        u.uTime.value = t;
        // 首末帧：连远处雾里的云也不画
        u.uPresence.value = (entering && a <= 0) || (!entering && b >= 1) ? 0 : 1;
      },
      dispose() {
        quad.dispose();
        own?.dispose();
      },
    };
  },
};

export default template;
