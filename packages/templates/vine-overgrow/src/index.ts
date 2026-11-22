// 016 藤蔓蔓生 allay.builtin.vine-overgrow（docs/templates/vine-overgrow.md）。
// 进入：藤蔓一列列从画面上沿垂下来，树叶从藤蔓周围一层层长出来，直到完全盖住；
// 退出：树叶随机枯掉（外层先掉），掉的时候飘下树叶（或花瓣、苹果），藤蔓最后缩回上沿。
// 树叶贴图是镂空的：最里层铺满网格，每格后面垫一块深色的底（和那一格的树叶一起长出来、一起掉），
// 像游戏里“快速”画质下树叶的深色空隙，剪辑点因此不透明，又不会出现一整块突兀的色板。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { createDebris, type DebrisParticle } from '../../_lib/src/block-debris';
import { clamp01, cuePosition, depthScale, sampleCueIndices, wallGrid } from '../../_lib/src/block-kit';
import { firstTexture, num, rgbOf } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { averageOpaque, BACKING_SHADE, decayOrder, FALL_ITEMS, growOrder, leafLayers, leafTint, LEAVES, vineLength, vineTint, type FallItem, type Leaves } from './layout';

const pick = <T extends string>(v: ParamValue | undefined, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);

/** 实例数的上限（02-engine.md 2.11） */
const INSTANCE_BUDGET = 5000;
/** 一块树叶从出现到长满的时间（秒），最多占进入阶段的 15% */
const POP_TIME = 0.16;
/** 藤蔓先长：树叶从进入阶段的这个位置开始长 */
const LEAF_START = 0.18;

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const leaves = pick<Leaves>(params.leaves, LEAVES, 'oak');
    const fallItem = pick<FallItem>(params.fallItem, FALL_ITEMS, 'leaves');
    const tintHex = rgbOf(params.tint, '#77AB2F');
    const cols = Math.round(num(params.cols, 11));
    const vineCount = Math.round(num(params.vines, 7));
    const layers = leafLayers(num(params.layers, 3));
    const volume = num(params.volume, 0.6);
    const win = transitionWindows(stage.fps, num(params.inDuration, 1.1), num(params.hold, 0.15), num(params.outDuration, 1));
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;
    const pop = Math.min(POP_TIME, inLen * 0.15);

    const camera = ctx.createStageCamera({ fov: 30 });
    ctx.setCamera(camera);
    const camZ = camera.position.z;

    const grid = wallGrid(W, H, cols);
    const s = grid.size;
    const leafTex = await ctx.resources.texture(`minecraft:block/${leaves}_leaves`);
    const vineTex = await ctx.resources.texture('minecraft:block/vine');
    const leafColor = new THREE.Color(leafTint(leaves, tintHex));
    const vineColor = new THREE.Color(vineTint(leaves, tintHex));
    // 深色的底：树叶贴图不透明像素的平均颜色 × 着色，再压暗（sRGB 乘 BACKING_SHADE），像树叶深处的阴影。
    // 读的是引擎给的贴图的像素（只读，不改它）；读不到时退回着色 × 0.25
    const img = leafTex.image;
    const data = img && typeof img === 'object' && 'data' in img && img.data instanceof Uint8Array ? img.data : null;
    const avg = (data && averageOpaque(data)) ?? [0.6, 0.6, 0.6];
    const tintColor = new THREE.Color(leafTint(leaves, tintHex));
    const backColor = new THREE.Color().setRGB(avg[0] * BACKING_SHADE, avg[1] * BACKING_SHADE, avg[2] * BACKING_SHADE, THREE.SRGBColorSpace);
    backColor.r *= tintColor.r;
    backColor.g *= tintColor.g;
    backColor.b *= tintColor.b;

    // 藤蔓：在不同的列上，从上沿外面垂下来，长度随机
    const rv = ctx.random('vines');
    const vineCols = Array.from({ length: grid.cols }, (_, c) => c);
    rv.shuffle(vineCols);
    const vines = vineCols.slice(0, Math.min(vineCount, grid.cols)).map((c) => {
      const x = -W / 2 + (c + 0.5) * s + (rv.next() - 0.5) * s * 0.3;
      const length = vineLength(rv.next()) * H;
      return { x, length, segments: Math.ceil(length / s), phase: rv.next() * Math.PI * 2, start: rv.next() };
    });
    const top = H / 2 + s * 0.5;
    const vineSegments = vines.reduce((a, v) => a + v.segments, 0);

    // 树叶：每层一个实例化网格（贴图镂空，alphaTest），逐实例的明暗略有起伏；外层随机转 90° 的倍数，不那么整齐
    const rl = ctx.random('leaves');
    type Leaf = { x: number; y: number; z: number; layer: number; grow: number; decay: number; rot: number; size: number };
    const leafList: Leaf[][] = layers.map(() => []);
    const tipNear = (x: number, y: number) => {
      // 到最近的藤蔓的距离（0–1）：水平距离，加上在藤蔓尖下面多远
      if (vines.length === 0) return clamp01((H / 2 - y) / H);
      let best = Infinity;
      for (const v of vines) best = Math.min(best, Math.abs(x - v.x) + Math.max(0, top - v.length - y) * 0.6);
      return clamp01(best / (W * 0.5));
    };
    layers.forEach((layer, l) => {
      const extra = l === 0 ? 0 : 1;
      for (let r = -extra; r < grid.rows + extra; r++) {
        for (let c = -extra; c < grid.cols + extra; c++) {
          if (l > 0 && rl.next() > layer.fill) continue;
          const x = -W / 2 + (c + 0.5 + layer.dx) * s;
          const y = ((grid.rows - 1) / 2 - r + layer.dy) * s;
          const n = ctx.noise2D(x / 500, y / 500, `grow:${l}`);
          leafList[l]!.push({ x, y, z: layer.depth * s, layer: l, grow: growOrder(l, layers.length, tipNear(x, y), n), decay: decayOrder(l, layers.length, rl.next()), rot: l === 0 ? 0 : Math.floor(rl.next() * 4), size: l === 0 ? 1.01 : 1 + 0.12 * rl.next() });
        }
      }
    });
    // 生长的先后按名次摊到 0–1（先后不变，出现的时刻均匀分布）：盖住的面积随时间匀速增长，最后一块恰好在进入阶段末长满。
    // 直接按值归一化的话，离藤蔓近的树叶扎堆，进入阶段的前三成就铺满了
    const growAll = leafList.flat();
    const ranked = growAll.map((f, i) => ({ f, i })).sort((a, b) => a.f.grow - b.f.grow || a.i - b.i);
    ranked.forEach(({ f }, k) => (f.grow = ranked.length > 1 ? k / (ranked.length - 1) : 0));
    const leafStart = win.in.start + LEAF_START * inLen;
    const leafSpan = Math.max(1e-4, win.in.end - pop - leafStart);
    const decaySpan = 0.62 * outLen;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const leafMaterials = layers.map(() => new THREE.MeshBasicMaterial({ map: leafTex, color: leafColor, alphaTest: 0.5 }));
    const leafMeshes = leafList.map((list, l) => {
      const mesh = new THREE.InstancedMesh(geometry, leafMaterials[l]!, Math.max(1, list.length));
      mesh.frustumCulled = false;
      mesh.renderOrder = 2 + l;
      const c = new THREE.Color();
      list.forEach((_, i) => {
        const k = layers[l]!.shade * (0.92 + 0.16 * rl.next());
        mesh.setColorAt(i, c.setRGB(k, k, k));
      });
      scene.add(mesh);
      return mesh;
    });
    // 深色的底：最里层每格一块，和那一格的树叶一起长、一起掉
    const backingMaterial = new THREE.MeshBasicMaterial({ color: backColor });
    const backing = new THREE.InstancedMesh(geometry, backingMaterial, Math.max(1, leafList[0]!.length));
    backing.frustumCulled = false;
    backing.renderOrder = 1;
    scene.add(backing);
    // 藤蔓：每节一块方片
    const vineMaterial = new THREE.MeshBasicMaterial({ map: vineTex, color: vineColor, alphaTest: 0.5 });
    const vineMesh = new THREE.InstancedMesh(geometry, vineMaterial, Math.max(1, vineSegments));
    vineMesh.frustumCulled = false;
    vineMesh.renderOrder = 6;
    scene.add(vineMesh);

    // 飘落物：树叶粒子（1.21.5 起才有，没有时退回树叶贴图的碎片）、樱花花瓣（1.20 起）、苹果
    const fallTextures: InstanceType<typeof THREE.Texture>[] = [];
    let fragment = false;
    let tinted = true;
    if (fallItem === 'apples') {
      fallTextures.push(await ctx.resources.texture('minecraft:item/apple'));
      tinted = false;
    } else if (fallItem !== 'none') {
      const petals = fallItem === 'petals' || leaves === 'cherry';
      const prefix = petals ? 'cherry' : leaves === 'pale_oak' ? 'pale_oak' : 'leaf';
      for (const k of [0, 3, 6, 9]) {
        const tex = await firstTexture(ctx, [`minecraft:particle/${prefix}_${k}`]);
        if (tex) fallTextures.push(tex.texture);
      }
      tinted = prefix === 'leaf';
      if (fallTextures.length === 0) {
        fallTextures.push(leafTex);
        fragment = true;
        tinted = true;
      }
    }
    const particles: DebrisParticle[] = [];
    const rp = ctx.random('fall');
    // 实例预算（02-engine.md 2.11：一个模板最多 5000）：树叶、垫底、藤蔓之外剩下的给飘落物；飘落的比例最多七成，
    // 竖屏、列数多、三层都开时按剩下的名额减少（默认参数下仍是七成）
    const leafCount = leafList.reduce((n, list) => n + list.length, 0);
    const spare = INSTANCE_BUDGET - leafCount - leafList[0]!.length - vineSegments;
    const fallShare = Math.max(0, Math.min(0.7, spare / Math.max(1, leafCount)));
    const tintRgb: [number, number, number] = tinted ? [leafColor.r, leafColor.g, leafColor.b] : [1, 1, 1];
    if (fallTextures.length > 0) {
      leafList.forEach((list, l) => {
        for (const leaf of list) {
          if (rp.next() > fallShare) continue;
          const birth = win.out.start + leaf.decay * decaySpan;
          const apple = fallItem === 'apples';
          particles.push({
            x: leaf.x + (rp.next() - 0.5) * s * 0.6,
            y: leaf.y + (rp.next() - 0.5) * s * 0.6,
            z: (layers[l]!.depth + 0.05) * s,
            vx: (rp.next() - 0.5) * s * 0.8,
            vy: apple ? s * 0.5 : -s * (0.2 + 0.4 * rp.next()),
            vz: rp.next() * s * 0.5,
            birth,
            life: win.out.end - 1e-3 - birth,
            size: s * (apple ? 0.42 : fragment ? 0.22 : 0.3) * (0.8 + 0.4 * rp.next()),
            u0: fragment ? rp.next() * 0.75 : 0,
            v0: fragment ? rp.next() * 0.75 : 0,
            uvSize: fragment ? 0.25 : 1,
            texture: Math.floor(rp.next() * fallTextures.length),
            tint: tintRgb,
            angle: rp.next() * Math.PI * 2,
            spin: (rp.next() - 0.5) * (apple ? 6 : 4),
          });
        }
      });
    }
    const apples = fallItem === 'apples';
    const fall = createDebris(ctx, fallTextures, particles, {
      gravity: s * (apples ? 9 : 1.4),
      drag: apples ? 0.3 : 1.2,
      shrink: 0.3,
      ...(apples ? {} : { sway: { amplitude: s * 0.25, frequency: 1.1 } }),
      renderOrder: 7,
    });
    scene.add(fall.object);

    // 音效：藤蔓开始垂下、树叶长出、树叶枯掉，各自最多 12 个 cue（按时刻均匀抽样）
    const all = leafList.flat();
    const vineStart = (v: (typeof vines)[number]) => win.in.start + v.start * 0.35 * inLen;
    const cueList = (sound: ParamValue | undefined, times: number[], xs: number[], ys: number[]) => {
      if (typeof sound !== 'string') return;
      for (const k of sampleCueIndices(times)) ctx.audio.cue(sound, times[k]!, { gain: volume, rate: 0.8, position: cuePosition(xs[k]!, ys[k]!, W) });
    };
    cueList(params.vineSound, vines.map(vineStart), vines.map((v) => v.x), vines.map(() => H / 2));
    cueList(params.growSound, all.map((f) => leafStart + f.grow * leafSpan), all.map((f) => f.x), all.map((f) => f.y));
    cueList(params.decaySound, all.map((f) => win.out.start + f.decay * decaySpan), all.map((f) => f.x), all.map((f) => f.y));

    // update 里复用的对象
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const backOut = ctx.ease.backOut;
    const cubicOut = ctx.ease.cubicOut;
    const vineGrow = 0.55 * inLen;

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        // 树叶：长出时从 0 弹到略大于 1 再落定；枯掉时 2 帧左右缩没（游戏里树叶枯掉是直接消失的）
        leafList.forEach((list, l) => {
          const mesh = leafMeshes[l]!;
          list.forEach((leaf, i) => {
            let k: number;
            if (entering) {
              const p = clamp01((t - (leafStart + leaf.grow * leafSpan)) / pop);
              k = p <= 0 ? 0 : p >= 1 ? 1 : backOut(p);
            } else {
              const d = win.out.start + leaf.decay * decaySpan;
              k = 1 - clamp01((t - d) / 0.05);
            }
            k *= leaf.size;
            pos.set(leaf.x, leaf.y, leaf.z);
            quat.setFromAxisAngle(zAxis, (leaf.rot * Math.PI) / 2);
            scl.set(k * s, k * s, 1);
            m.compose(pos, quat, scl);
            mesh.setMatrixAt(i, m);
            if (l === 0) {
              // 垫底在树叶后面一点，按透视放大到和树叶一样大：画面边上一列不会从树叶的镂空处露出垫底外面
              const zb = -s * 0.02;
              const f = depthScale(camZ, leaf.z, zb);
              pos.set(leaf.x * f, leaf.y * f, zb);
              quat.identity();
              scl.set(k * s * f, k * s * f, 1);
              m.compose(pos, quat, scl);
              backing.setMatrixAt(i, m);
            }
          });
          mesh.instanceMatrix.needsUpdate = true;
        });
        backing.instanceMatrix.needsUpdate = true;
        // 藤蔓：从上沿往下长（缓出），节点轻轻左右摆；退出阶段后段缩回上沿
        let seg = 0;
        for (const v of vines) {
          const startT = vineStart(v);
          let length: number;
          if (entering) length = v.length * cubicOut(clamp01((t - startT) / vineGrow));
          else length = v.length * (1 - cubicOut(clamp01((t - win.out.start - 0.38 * outLen) / (0.62 * outLen))));
          for (let k = 0; k < v.segments; k++) {
            const h = Math.min(s, Math.max(0, length - k * s));
            const sway = s * 0.05 * Math.sin(t * 2.4 + v.phase + k * 0.7) * (k / Math.max(1, v.segments));
            pos.set(v.x + sway, top - k * s - h / 2, s * 0.4);
            quat.identity();
            scl.set(h > 0 ? s : 0, h, 1);
            m.compose(pos, quat, scl);
            vineMesh.setMatrixAt(seg++, m);
          }
        }
        vineMesh.instanceMatrix.needsUpdate = true;
        fall.setTime(t);
      },
      dispose() {
        geometry.dispose();
        for (const mm of leafMaterials) mm.dispose();
        backingMaterial.dispose();
        vineMaterial.dispose();
        fall.dispose();
      },
    };
  },
};

export default template;
