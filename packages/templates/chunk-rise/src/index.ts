// 012 区块升起 allay.builtin.chunk-rise（docs/templates/chunk-rise.md）。
// 进入：俯视的一片地形按区块（默认 8 × 8 柱，游戏的区块是 16 × 16）从一个看不见的水平面下面升上来，带一点过冲落定，拼满画面；
// 退出：一块块沉下去。地形按噪声分布（草地、沙滩、水、露出来的石头……按生物群系换一组方块）。
// 每一柱是一个从剪切面伸到顶面的长方体，一次绘制画完；着色器按世界坐标平铺贴图：
// 顶面用顶面贴图，侧面按离顶面的深度换贴图（最上一格、往下三格、再往下），升起时低于剪切面的部分不画。
// 为了在核显上不超预算（02-engine.md 2.11，引擎按 2 × 2 超采样画）：剪切在顶点着色器里做（片元着色器不 discard，
// 深度测试能提前剔除），柱子按离相机由近到远排（先画的挡住后画的）。侧面不按邻居截短：截短后地面下是空心的，
// 面和面接缝处差一个采样点的缝就会透过去（T-TPL-4 的随机参数里剪辑点出现过 alpha 191 的像素），整柱伸到剪切面就没有这个问题。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { clamp01, cuePosition, sampleCueIndices } from '../../_lib/src/block-kit';
import { num } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { BIOMES, cameraDistance, cameraRig, CHUNK_ORDERS, chunkOrder, columnSurface, convexHull, footprint, hullInset, palette, projectToScreen, terrainHeight, type Biome, type ChunkOrder } from './layout';

/** 透视的垂直视角（度） */
const FOV = 35;
/** 画面短边方向在地形中心大约看到多少格（柱子超过实例预算时自动拉近） */
const VIEW = 34;
/** 柱子数的上限（02-engine.md 2.11 的实例预算 5000，留一点余量） */
const COLUMN_BUDGET = 4800;
/** 剪切面在最低的顶面下面几格：区块升起时露出这么厚的“土层” */
const SLAB = 4;
/** 单个区块升起占阶段的比例（其余是先后的错落） */
const RISE_SHARE = 0.3;

const pick = <T extends string>(v: ParamValue | undefined, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);

const VERTEX = /* glsl */ `
attribute vec3 aCol;
attribute vec4 aMat;
attribute float aRise;
uniform float uBottom;
uniform float uClip;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vTop;
varying float vRise;
flat varying vec4 vMat;
void main() {
  // 单位长方体：x、z ∈ [-0.5, 0.5]，y ∈ [0, 1]；拉到从 uBottom 到这一柱的顶面，再整体抬起 aRise
  float top = aCol.z;
  float y = (position.y > 0.5 ? top : uBottom) + aRise;
  // 剪切面：整柱都在下面时整柱不画（移到裁剪空间外面），否则低于剪切面的部分压到剪切面上
  if (top + aRise <= uClip) {
    vWorld = vec3(0.0);
    vNormal = normal;
    vTop = 0.0;
    vRise = 0.0;
    vMat = aMat;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 p = vec3(aCol.x + position.x, max(y, uClip), aCol.y + position.z);
  vWorld = p;
  vNormal = normal;
  vTop = top + aRise;
  vRise = aRise;
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

function fragment(n: number): string {
  const decl: string[] = [];
  const pick2: string[] = [];
  for (let i = 0; i < n; i++) {
    decl.push(`uniform sampler2D uTex${i};\nuniform vec2 uOff${i};\nuniform vec2 uRep${i};\nuniform vec3 uTint${i};`);
    const sample = `c = textureGrad(uTex${i}, uOff${i} + fract(uv) * uRep${i}, dx * uRep${i}, dy * uRep${i}) * vec4(uTint${i}, 1.0);`;
    pick2.push(i === n - 1 ? `{ ${sample} }` : `if (idx < ${i}.5) { ${sample} } else `);
  }
  return /* glsl */ `
${decl.join('\n')}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vTop;
varying float vRise;
flat varying vec4 vMat;
void main() {
  vec3 nrm = normalize(vNormal);
  float idx;
  vec2 uv;
  float shade;
  // 贴图坐标跟着区块走（减去升起的量），格子边界落在整数上
  float wy = vWorld.y - vRise;
  if (nrm.y > 0.5) {
    idx = vMat.x;
    uv = vec2(vWorld.x + 0.5, 0.5 - vWorld.z);
    shade = 1.0;
  } else {
    float depth = vTop - vWorld.y;
    idx = depth < 1.0 ? vMat.y : depth < 4.0 ? vMat.z : vMat.w;
    float u = abs(nrm.x) > 0.5 ? (nrm.x > 0.0 ? -vWorld.z : vWorld.z) : (nrm.z > 0.0 ? vWorld.x : -vWorld.x);
    uv = vec2(u + 0.5, wy - floor(vTop - vRise));
    shade = abs(nrm.x) > 0.5 ? 0.6 : 0.8;
  }
  // 导数用连续的坐标（fract 之前）在分支外面取，接缝处不跳 mipmap 级
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec4 c = vec4(1.0);
  ${pick2.join('')}
  // 面明暗（sRGB 系数换成线性）
  gl_FragColor = vec4(c.rgb * pow(shade, 2.2), 1.0);
}
`;
}

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const biome = pick<Biome>(params.palette, BIOMES, 'plains');
    const order = pick<ChunkOrder>(params.order, CHUNK_ORDERS, 'nearFirst');
    const chunkSize = Math.round(num(params.chunkSize, 8));
    const relief = num(params.relief, 0.6);
    const tilt = num(params.tilt, 55);
    const volume = num(params.volume, 0.5);
    const win = transitionWindows(stage.fps, num(params.inDuration, 1.2), num(params.hold, 0.12), num(params.outDuration, 0.9));
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;
    const pal = palette(biome);

    // 镜头：俯角 tilt，看向原点。地形只建视野里看得到的柱子：视野落在剪切面和最高顶面这两个平面上的范围的凸包，再多一格半。
    // 柱子数超过预算时把镜头拉近（看到的范围变小），不减少每一柱的画法
    const maxDrop = Math.round(relief * 5.5) + 1;
    const clipY = (pal.liquid ? Math.min(-maxDrop, pal.liquidLevel) : -maxDrop) - SLAB;
    const topY = Math.round(relief * 8.5) + 2;
    // 区块从多深的地方升上来：最高的顶面也在剪切面下面一格，整块都看不见；再深就浪费了升起的时间
    const DEPTH = topY - clipY + 1;
    let view = VIEW;
    let rig = cameraRig(tilt, cameraDistance(view, FOV, stage.aspect), FOV, stage.aspect);
    let hull: [number, number][] = [];
    const visibleColumns = () => {
      const low = footprint(rig, clipY);
      const high = footprint(rig, topY);
      hull = convexHull([...(low ?? []), ...(high ?? [])]);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [x, z] of hull) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      const out: [number, number][] = [];
      for (let x = Math.floor(minX) - 2; x <= Math.ceil(maxX) + 2; x++) {
        for (let z = Math.floor(minZ) - 2; z <= Math.ceil(maxZ) + 2; z++) {
          if (hullInset(hull, x + 0.5, z + 0.5) >= -1.5) out.push([x, z]);
        }
      }
      return out;
    };
    let cells = visibleColumns();
    for (let k = 0; k < 6 && cells.length > COLUMN_BUDGET; k++) {
      view *= Math.sqrt(COLUMN_BUDGET / cells.length) * 0.97;
      rig = cameraRig(tilt, cameraDistance(view, FOV, stage.aspect), FOV, stage.aspect);
      cells = visibleColumns();
    }
    // 由近到远排：一次绘制里先画的柱子先写深度，后面被挡住的片元在着色之前就被剔除
    // 参数写成数组而不是元组：打包后的 JS 没有类型标注，checkJs 下元组参数对不上 cells 的元素类型
    const near2 = (c: readonly number[]) => (c[0]! + 0.5 - rig.x) ** 2 + (c[1]! + 0.5 - rig.z) ** 2;
    cells.sort((a, b) => near2(a) - near2(b) || a[0] - b[0] || a[1] - b[1]);
    const dist = cameraDistance(view, FOV, stage.aspect);
    const camera = new THREE.PerspectiveCamera(FOV, stage.aspect, 0.5, dist * 6);
    camera.position.set(rig.x, rig.y, rig.z);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    ctx.setCamera(camera);

    // 每一柱的高度和地表；柱子按所在的区块分组（区块号 = 区块坐标在用到的范围里的序号）
    const columns = cells.length;
    const col = new Float32Array(columns * 3);
    const mat = new Float32Array(columns * 4);
    const chunkOf = new Uint16Array(columns);
    const chunkKeys = new Map<string, number>();
    const chunkCenters: { x: number; z: number }[] = [];
    cells.forEach(([cxi, czi], i) => {
      const x = cxi + 0.5;
      const z = czi + 0.5;
      const h = terrainHeight(ctx.noise2D(x / 26, z / 26, 'terrain'), ctx.noise2D(x / 9, z / 9, 'detail'), relief);
      const { surface, top } = columnSurface(pal, h, ctx.noise2D(x / 7, z / 7, 'patch'));
      col.set([x, z, top], i * 3);
      mat.set([surface.top, surface.side, surface.fill, surface.deep], i * 4);
      const kx = Math.floor(cxi / chunkSize);
      const kz = Math.floor(czi / chunkSize);
      const key = `${kx},${kz}`;
      let c = chunkKeys.get(key);
      if (c === undefined) {
        c = chunkCenters.length;
        chunkKeys.set(key, c);
        chunkCenters.push({ x: (kx + 0.5) * chunkSize, z: (kz + 0.5) * chunkSize });
      }
      chunkOf[i] = c;
    });
    const chunkCount = chunkCenters.length;

    // 区块升起的先后：按区块中心（顶面的平均高度上）在画面上的投影位置
    const rc = ctx.random('chunks');
    const uChunk = Float64Array.from(chunkCenters, (c) => {
      const s = projectToScreen(rig, tilt, FOV, stage.aspect, c.x, 0, c.z) ?? { sx: 0, sy: -1.5 };
      return chunkOrder(order, Math.max(-1.5, Math.min(1.5, s.sx)), Math.max(-1.5, Math.min(1.5, s.sy)), rc.next());
    });
    // 归一化到 0–1（最晚的那块恰好在阶段末落定）
    const uMin = Math.min(...uChunk);
    const uMax = Math.max(...uChunk);
    for (let k = 0; k < chunkCount; k++) uChunk[k] = uMax > uMin ? (uChunk[k]! - uMin) / (uMax - uMin) : 0;
    const riseIn = RISE_SHARE * inLen;
    const riseOut = RISE_SHARE * outLen;
    const startIn = Float64Array.from(uChunk, (u) => win.in.start + u * (inLen - riseIn));
    // 退出：同样的先后（先升起的先沉下去）
    const startOut = Float64Array.from(uChunk, (u) => win.out.start + u * (outLen - riseOut));

    // 几何和材质
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
    geometry.setAttribute('aMat', new THREE.InstancedBufferAttribute(mat, 4));
    const riseAttr = new THREE.InstancedBufferAttribute(new Float32Array(columns).fill(-DEPTH), 1);
    geometry.setAttribute('aRise', riseAttr);
    const uniforms: Record<string, { value: unknown }> = { uClip: { value: clipY }, uBottom: { value: clipY - 1 } };
    for (let k = 0; k < pal.textures.length; k++) {
      const tex = await ctx.resources.texture(`minecraft:${pal.textures[k]!}`);
      uniforms[`uTex${k}`] = { value: tex };
      // 引擎贴图自己的 offset / repeat（水、岩浆是动画贴图），只读
      uniforms[`uOff${k}`] = { value: tex.offset };
      uniforms[`uRep${k}`] = { value: tex.repeat };
      uniforms[`uTint${k}`] = { value: new THREE.Color(pal.tints[k]!) };
    }
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: fragment(pal.textures.length) });
    const mesh = new THREE.InstancedMesh(geometry, material, columns);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);

    // 音效：区块落定时一声（最多 12 个，按时刻均匀抽样），沉下去时一声
    const landT = Array.from(startIn, (s) => s + riseIn * 0.7);
    const sinkT = Array.from(startOut);
    const chunkPos = chunkCenters.map((c) => ({ x: (c.x / view) * W * 0.5, y: 0 }));
    if (typeof params.riseSound === 'string') for (const k of sampleCueIndices(landT)) ctx.audio.cue(params.riseSound, landT[k]!, { gain: volume, rate: 0.7, position: cuePosition(chunkPos[k]!.x, 0, W) });
    if (typeof params.sinkSound === 'string') for (const k of sampleCueIndices(sinkT)) ctx.audio.cue(params.sinkSound, sinkT[k]!, { gain: volume * 0.8, rate: 0.6, position: cuePosition(chunkPos[k]!.x, 0, W) });

    const backOut = ctx.ease.backOut;
    const cubicIn = ctx.ease.cubicIn;
    const chunkRise = new Float64Array(chunkCount);
    const rise = riseAttr.array;

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        for (let k = 0; k < chunkCount; k++) {
          if (entering) {
            // 升起：从 DEPTH 格深处升上来，带一点过冲（backOut）
            const p = clamp01((t - startIn[k]!) / riseIn);
            chunkRise[k] = p >= 1 ? 0 : -DEPTH * (1 - backOut(p));
          } else {
            // 沉下去：越沉越快（三次缓入）
            const p = clamp01((t - startOut[k]!) / riseOut);
            chunkRise[k] = p <= 0 ? 0 : -DEPTH * cubicIn(p);
          }
        }
        for (let c = 0; c < columns; c++) rise[c] = chunkRise[chunkOf[c]!]!;
        riseAttr.needsUpdate = true;
      },
      dispose() {
        geometry.dispose();
        material.dispose();
      },
    };
  },
};

export default template;
