// 014 冰封碎裂 allay.builtin.ice-shatter（docs/templates/ice-shatter.md）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（docs/04-templates.md 4.9）。
// 进入：霜从四边往中间爬（前沿是方的像素台阶，前面一层白霜），霜后面结成冰（方块贴图，默认浮冰），
// 刚结的冰先是白的再透出冰的颜色；四边叠游戏里细雪结霜的视野贴图（misc/powder_snow_outline）。
// 退出：撞击点先闪一下，裂纹从那里沿着碎片的边往外裂开，接着碎片（泰森多边形）由近到远一块块翻着飞走、落下，带一点冰屑。
// 冰面在进入阶段由全屏着色器画；退出阶段换成碎片网（共用顶点合并过，静止时和整块冰面一模一样，不漏缝），
// 碎片的运动在顶点着色器里按闭式算。贴图缺失时：冰是程序的渐变加几道斜的高光，霜是边上的白雾和闪点。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { num, str } from '../../_lib/src/gui-kit';
import { GLSL_COMMON, linearColor, optionalTexture, outputPixel, shaderQuad, shaderSeed } from '../../_lib/src/shader-kit';
import { fitLife, particleBatch } from '../../_lib/src/shader-particles';
import { eased, transitionWindows } from '../../_lib/src/timing';
import { BURST_START, crackRadius, freezeThreshold, shardDelay, shardMesh, shardSites } from './layout';

/** 冰面的颜色：冰面和碎片共用（碎片按静止时的位置取，飞起来贴图跟着走） */
const GLSL_ICE = /* glsl */ `
uniform sampler2D uIce;
uniform float uHasIce;
uniform sampler2D uFrost;
uniform float uHasFrost;
uniform float uFrostA;
uniform float uTile;
uniform vec3 uBacking;
uniform vec3 uFrostColor;
uniform float uSeed;
vec3 iceAt(vec2 p) {
  vec3 c;
  if (uHasIce > 0.5) {
    vec2 g = p / uTile;
    vec4 t = textureGrad(uIce, fract(g), dFdx(g), dFdy(g));
    // 半透明的冰（普通的冰、玻璃）垫在底色上
    c = mix(uBacking, t.rgb, t.a);
  } else {
    // 没有贴图：上亮下暗的渐变，几道斜的高光
    float h = p.y / uStage.y + 0.5;
    c = mix(uBacking * 0.82, uBacking * 1.08, h);
    float streak = smoothstep(0.85, 1.0, sin((p.x + p.y * 0.6) / uTile * 1.3) * 0.5 + 0.5);
    c = mix(c, vec3(1.0), streak * 0.22);
  }
  // 四边的霜（游戏里细雪结霜的视野贴图，铺满画面）
  vec2 uv = p / uStage + 0.5;
  if (uHasFrost > 0.5) {
    vec4 s = texture2D(uFrost, uv);
    c = mix(c, s.rgb, s.a * uFrostA);
  } else {
    vec2 e = min(uv, 1.0 - uv);
    float f = 1.0 - smoothstep(0.0, 0.12, min(e.x, e.y * uStage.y / uStage.x));
    c = mix(c, uFrostColor, f * 0.75 * uFrostA);
  }
  return c;
}
`;

const SHEET = /* glsl */ `
${GLSL_COMMON}
${GLSL_ICE}
uniform float uA;
uniform float uTexel;
varying vec2 vPos;
void main() {
  // 结冰场：离画面边越近越早，加一层噪声，按冰的像素吸附（前沿是方的台阶）
  vec2 q = snapTo(vPos, uTexel);
  vec2 S = uStage * 0.5;
  float edge = min(S.x - abs(q.x), S.y - abs(q.y)) / min(S.x, S.y);
  float f = clamp(0.82 * edge + 0.18 * fbm(q / 260.0, uint(uSeed)), 0.0, 1.0);
  float d = uA - f;
  vec4 col = vec4(0.0);
  if (d > 0.0) {
    // 刚结的冰是白的霜，冻实了才透出冰的颜色
    vec3 c = iceAt(vPos);
    c = mix(c, uFrostColor, (1.0 - smoothstep(0.0, 0.14, d)) * 0.85);
    col = pm(c, 1.0);
  } else if (d > -0.07) {
    // 前沿外面一层白霜，越往外越淡，带一点闪点
    float k = 1.0 + d / 0.07;
    float spark = step(0.985, rand2(ivec2(floor(vPos / uTexel)), uint(uSeed) ^ 0x77u));
    col = pm(uFrostColor, k * k * 0.75 + spark * k * 0.25);
  }
  if (col.a <= 0.0) discard;
  gl_FragColor = straight(col);
}
`;

const SHARD_VERTEX = /* glsl */ `
attribute vec2 aCenter;
attribute float aEdge;
attribute vec4 aMove;
attribute vec4 aSpin;
uniform float uB;
uniform vec2 uShake;
varying vec2 vRest;
varying float vEdge;
varying float vShade;
varying float vAlpha;
varying float vDist;
uniform vec2 uImpact;
uniform float uReach;
void main() {
  float delay = aMove.w;
  float u = uB >= 1.0 ? 1.0 : clamp((uB - delay) / max(1e-4, 1.0 - delay), 0.0, 1.0);
  vec3 local = vec3(position.xy - aCenter, 0.0);
  // 绕随机的轴翻转（罗德里格斯公式），往外飞、朝镜头来一点，再被重力拉下去
  vec3 k = normalize(aSpin.xyz);
  float ang = aSpin.w * u;
  float c = cos(ang);
  float s = sin(ang);
  vec3 r = local * c + cross(k, local) * s + k * dot(k, local) * (1.0 - c);
  vec3 n = vec3(0.0, 0.0, 1.0) * c + cross(k, vec3(0.0, 0.0, 1.0)) * s + k * k.z * (1.0 - c);
  vec3 off = vec3(aMove.xy * u, aMove.z * u) + vec3(0.0, -2400.0 * u * u, 0.0);
  vec3 pos = vec3(aCenter + uShake * (1.0 - step(0.001, u)), 0.0) + r + off;
  vRest = position.xy;
  vEdge = aEdge;
  // 翻过去的那一面暗一点，正对着光的那一下亮一点
  vShade = 0.72 + 0.28 * abs(n.z) + 0.35 * pow(max(0.0, dot(normalize(n), normalize(vec3(-0.4, 0.5, 0.75)))), 12.0);
  vAlpha = 1.0 - smoothstep(0.7, 1.0, u);
  vDist = length(position.xy - uImpact) / uReach;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const SHARD_FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_ICE}
uniform float uCrack;
uniform float uFlash;
uniform vec2 uImpact;
uniform float uReach;
varying vec2 vRest;
varying float vEdge;
varying float vShade;
varying float vAlpha;
varying float vDist;
void main() {
  vec3 c = iceAt(vRest) * vShade;
  // 裂纹：碎片的边，从撞击点往外扩散到 uCrack；前沿带一点噪声，不是一个正圆
  float front = uCrack - vDist + 0.06 * (vnoise(vRest / 120.0, uint(uSeed) ^ 0x31u) - 0.5);
  float w = fwidth(vEdge) * 1.6;
  float rim = (1.0 - smoothstep(w * 0.5, w * 1.5, vEdge)) * step(0.0, front);
  c = mix(c, vec3(0.97, 1.0, 1.0), rim * 0.9);
  // 撞击的一下闪光
  float d = length(vRest - uImpact) / uReach;
  c = mix(c, vec3(1.0), uFlash * exp(-d * d * 30.0));
  if (vAlpha <= 0.0) discard;
  gl_FragColor = vec4(c, vAlpha);
}
`;

const DUST_VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aA;
attribute vec4 aB;
uniform float uTime;
varying float vAge;
void main() {
  float age = uTime - aA.z;
  vAge = age / aA.w;
  if (age < 0.0 || age > aA.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 pos = vec3(aA.xy + aB.xy * age + vec2(0.0, -900.0 * age * age), 40.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + vec3(aCorner * aB.z, 0.0), 1.0);
}
`;

const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uFrostColor;
varying float vAge;
void main() {
  gl_FragColor = vec4(uFrostColor, 1.0 - smoothstep(0.5, 1.0, vAge));
}
`;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const inDuration = num(params.inDuration, 0.8);
    const hold = num(params.hold, 0.25);
    const outDuration = num(params.outDuration, 0.9);
    const win = transitionWindows(stage.fps, inDuration, hold, outDuration);
    const ease = ctx.ease.from(params.easing);
    const volume = num(params.volume, 0.7);
    const tile = Math.max(30, num(params.blockSize, 135));
    // 透视相机：碎片在三维里翻转
    ctx.setCamera(ctx.createStageCamera({ fov: 30 }));

    // 冰的贴图：有原版素材时取方块朝向镜头那一面；没有原版素材（探一张浮冰的贴图）时不去取方块，免得是占位图加警告
    const probe = await optionalTexture(ctx, ['minecraft:block/packed_ice']);
    const ice = probe ? (await ctx.resources.block(str(params.block, 'minecraft:packed_ice'), { shading: false })).faceTexture('south') : null;
    const frost = await optionalTexture(ctx, ['minecraft:misc/powder_snow_outline']);
    const frostEdge = num(params.frostEdge, 0.7);
    const shared = {
      uIce: { value: ice },
      uHasIce: { value: ice ? 1 : 0 },
      uFrost: { value: frost },
      uHasFrost: { value: frost ? 1 : 0 },
      uFrostA: { value: 0 },
      uTile: { value: tile },
      uBacking: { value: linearColor(ctx, params.backing, '#9DC3F0') },
      uFrostColor: { value: linearColor(ctx, params.frostColor, '#EEF8FF') },
      uSeed: { value: shaderSeed(params.seed) },
    };
    const sheet = shaderQuad(ctx, { fragment: SHEET, uniforms: { ...shared, uA: { value: -1 }, uTexel: { value: tile / 16 } } });
    const sheetU = sheet.uniforms;

    // 碎片：撞击点附近更碎；网格比画面大一圈
    const impact: [number, number] = [num(params.impactX, 0.12) * W, num(params.impactY, 0.06) * H];
    const px = outputPixel(stage);
    const bx = W / 2 + 8 * px + 8;
    const by = H / 2 + 8 * px + 8;
    const rng = ctx.random('shards');
    const sites = shardSites(Math.round(num(params.shards, 40)), impact, -bx, -by, bx, by, rng);
    const mesh = shardMesh(sites, -bx, -by, bx, by);
    const reach = Math.max(...[[-bx, -by], [bx, -by], [-bx, by], [bx, by]].map(([x, y]) => Math.hypot(x! - impact[0], y! - impact[1])));
    const position: number[] = [];
    const center: number[] = [];
    const edge: number[] = [];
    const move: number[] = [];
    const spin: number[] = [];
    const index: number[] = [];
    const short = Math.min(W, H);
    for (const shard of mesh.shards) {
      const [cx, cy] = shard.center;
      const dx = cx - impact[0];
      const dy = cy - impact[1];
      const dist = Math.hypot(dx, dy);
      const len = Math.max(1e-6, dist);
      const speed = short * (0.5 + rng.next() * 0.9);
      const vx = (dx / len) * speed + (rng.next() - 0.5) * short * 0.3;
      const vy = (dy / len) * speed * 0.6 + short * (0.25 + rng.next() * 0.35);
      const vz = short * (0.4 + rng.next() * 0.8);
      const delay = shardDelay(dist / reach, rng.next());
      const ax = rng.next() - 0.5;
      const ay = rng.next() - 0.5;
      const az = (rng.next() - 0.5) * 0.6;
      const turn = (2 + rng.next() * 5) * (rng.next() < 0.5 ? -1 : 1);
      const base = position.length / 3;
      const push = (x: number, y: number, e: number) => {
        position.push(x, y, 0);
        center.push(cx, cy);
        edge.push(e);
        move.push(vx, vy, vz, delay);
        spin.push(ax, ay, az, turn);
      };
      push(cx, cy, 1);
      for (const v of shard.ring) push(mesh.vertices[v]![0], mesh.vertices[v]![1], 0);
      const m = shard.ring.length;
      for (let k = 0; k < m; k++) index.push(base, base + 1 + k, base + 1 + ((k + 1) % m));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aCenter', new THREE.BufferAttribute(new Float32Array(center), 2));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(edge), 1));
    geometry.setAttribute('aMove', new THREE.BufferAttribute(new Float32Array(move), 4));
    geometry.setAttribute('aSpin', new THREE.BufferAttribute(new Float32Array(spin), 4));
    geometry.setIndex(index);
    const shardUniforms = {
      ...shared,
      uStage: sheetU.uStage!,
      uB: { value: 0 },
      uShake: { value: new THREE.Vector2() },
      uCrack: { value: 0 },
      uFlash: { value: 0 },
      uImpact: { value: new THREE.Vector2(impact[0], impact[1]) },
      uReach: { value: reach },
    };
    const material = new THREE.ShaderMaterial({ uniforms: shardUniforms, vertexShader: SHARD_VERTEX, fragmentShader: SHARD_FRAGMENT, transparent: true, side: THREE.DoubleSide, depthTest: true, depthWrite: true });
    const shards = new THREE.Mesh(geometry, material);
    shards.frustumCulled = false;
    shards.visible = false;
    ctx.scene.add(shards);

    // 冰屑：碎开时从撞击点附近喷出来的一些小白点
    const dustCount = 36;
    const drng = ctx.random('dust');
    const aA = new Float32Array(dustCount * 4);
    const aB = new Float32Array(dustCount * 4);
    const outLen = win.out.end - win.out.start;
    const burstAt = win.out.start + BURST_START * outLen;
    for (let i = 0; i < dustCount; i++) {
      const birth = burstAt + drng.next() * outLen * 0.2;
      const { life } = fitLife(birth, 0.35 + drng.next() * 0.4, win.out.start, win.out.end - 1e-3);
      const ang = drng.next() * Math.PI * 2;
      const sp = short * (0.3 + drng.next() * 0.9);
      aA.set([impact[0] + (drng.next() - 0.5) * short * 0.1, impact[1] + (drng.next() - 0.5) * short * 0.1, birth, life], i * 4);
      aB.set([Math.cos(ang) * sp, Math.sin(ang) * sp + short * 0.3, short * (0.006 + drng.next() * 0.01), drng.next()], i * 4);
    }
    const dustUniforms = { uTime: { value: 0 }, uFrostColor: shared.uFrostColor };
    const dust = particleBatch(ctx, { count: dustCount, attributes: { aA: { size: 4, data: aA }, aB: { size: 4, data: aB } }, vertex: DUST_VERTEX, fragment: DUST_FRAGMENT, uniforms: dustUniforms, renderOrder: 2 });

    if (typeof params.freezeSound === 'string') ctx.audio.cue(params.freezeSound, win.in.start, { gain: volume });
    if (typeof params.crackSound === 'string') ctx.audio.cue(params.crackSound, win.out.start, { gain: volume });
    if (typeof params.shatterSound === 'string') ctx.audio.cue(params.shatterSound, burstAt, { gain: volume });

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const leaving = t > win.cutTime;
        const a = eased(t, win.in, ease);
        const b = eased(t, win.out, ease);
        sheet.mesh.visible = !leaving;
        shards.visible = leaving && b < 1;
        sheetU.uA!.value = freezeThreshold(a);
        // 视野上的霜随着冻结出来
        shared.uFrostA.value = frostEdge * Math.min(1, a * 1.6) * (t <= win.in.start ? 0 : 1);
        shardUniforms.uB.value = b;
        shardUniforms.uCrack.value = crackRadius(b);
        // 撞上的那一下：闪一下、整块冰抖一下（都只在碎片飞起来之前）
        const k = b > 0 ? Math.exp(-b / 0.035) : 0;
        shardUniforms.uFlash.value = 0.7 * k;
        shardUniforms.uShake.value.set(Math.sin(b * 160) * short * 0.012 * k, Math.cos(b * 130) * short * 0.008 * k);
        dustUniforms.uTime.value = t;
      },
      dispose() {
        sheet.dispose();
        geometry.dispose();
        material.dispose();
        dust.dispose();
      },
    };
  },
};

export default template;
