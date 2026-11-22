// 017 传送门穿越 allay.builtin.portal-gate（docs/templates/portal-gate.md）。
// 进入：黑曜石一块块垒成 4 × 5 的门框，打火石一点，传送门从下往上亮起，镜头被吸着推进去，传送门铺满画面；
// 退出：像穿过去一样，传送门碎成小块、从中间往四周朝镜头散开，带着紫色的粒子。
// 传送门的贴图是半透明的，每块碎片后面垫一块不透明的深紫色（backing），剪辑点因此不透明。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { createDebris, type DebrisParticle } from '../../_lib/src/block-debris';
import { clamp01, cuePosition, sampleCueIndices } from '../../_lib/src/block-kit';
import { createTiles } from '../../_lib/src/block-tiles';
import { firstTexture, num, rgbOf, str } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { BUILD_ORDERS, coverDistance, frameCells, frameSize, inSchedule, scatter, TILE_DIV, type BuildOrder } from './layout';

/** 透视的垂直视角（度） */
const FOV = 40;
/** 一块门框方块落位的时长（秒） */
const POP_TIME = 0.1;

const pick = <T extends string>(v: ParamValue | undefined, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const order = pick<BuildOrder>(params.buildOrder, BUILD_ORDERS, 'bottomUp');
    const sched = inSchedule(num(params.igniteAt, 0.55));
    const volume = num(params.volume, 0.7);
    const win = transitionWindows(stage.fps, num(params.inDuration, 1.6), num(params.hold, 0.15), num(params.outDuration, 0.6));
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;
    const at = (u: number) => win.in.start + u * inLen;

    // 相机：从门框整个看得见的距离推到传送门铺满画面的距离
    const camera = ctx.createStageCamera({ fov: FOV });
    ctx.setCamera(camera);
    const b = frameSize(W, H);
    const farZ = camera.position.z;
    const nearZ = coverDistance(b, FOV, stage.aspect);

    // 门框：14 块，按搭建顺序一块块弹出来
    const rb = ctx.random('build');
    const cells = frameCells(order, Array.from({ length: 14 }, () => rb.next()));
    const frameHandle = await ctx.resources.block(str(params.frame, 'minecraft:obsidian'), { shading: true });
    const frame = frameHandle.instanced(cells.length);
    scene.add(frame.object);
    // 放置时刻在搭框阶段里均匀铺开，最后一块也在搭框阶段结束前落定
    const pop = Math.min(POP_TIME, (sched.buildEnd * inLen) / 4);
    const buildSpan = Math.max(1e-4, sched.buildEnd * inLen - pop);
    const placeAt = cells.map((_, i) => win.in.start + (i / Math.max(1, cells.length - 1)) * buildSpan);

    // 传送门：里面 2 × 3 格，每格切成 4 × 4 块碎片（穿过时散开用）；每块后面一块深紫色的底
    const portalTex = await ctx.resources.texture('minecraft:block/nether_portal');
    const cols = 2 * TILE_DIV;
    const rows = 3 * TILE_DIV;
    const tileSize = b / TILE_DIV;
    const count = cols * rows;
    const tint = new THREE.Color(rgbOf(params.portalTint, '#FFFFFF'));
    const tiles = createTiles(ctx, [portalTex], count, { transparent: true, renderOrder: 3 });
    const backingMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgbOf(params.backing, '#22083D')) });
    const quad = new THREE.PlaneGeometry(1, 1);
    const backing = new THREE.InstancedMesh(quad, backingMaterial, count);
    backing.frustumCulled = false;
    backing.renderOrder = 2;
    scene.add(backing, tiles.mesh);
    const tx = new Float64Array(count);
    const ty = new Float64Array(count);
    const lightAt = new Float64Array(count);
    const scatterAt = new Float64Array(count);
    const dirX = new Float64Array(count);
    const dirY = new Float64Array(count);
    const spinAxis: InstanceType<typeof THREE.Vector3>[] = [];
    const rs = ctx.random('scatter');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        tx[i] = -b + (c + 0.5) * tileSize;
        ty[i] = 1.5 * b - (r + 0.5) * tileSize;
        // 每格的贴图是完整的一张：碎片取所在那一格里对应的 1/4 × 1/4
        tiles.setTile(i, { texture: 0, u0: (c % TILE_DIV) / TILE_DIV, v0: (r % TILE_DIV) / TILE_DIV, du: 1 / TILE_DIV, dv: 1 / TILE_DIV, tint: [tint.r, tint.g, tint.b] });
        // 点火后从下往上亮起
        lightAt[i] = at(sched.ignite + sched.light * ((rows - 1 - r) / rows));
        // 穿过时：从中间往外散开，离中心越远越晚
        const d = Math.hypot(tx[i]!, ty[i]!);
        const maxD = Math.hypot(b, 1.5 * b);
        scatterAt[i] = win.out.start + 0.35 * outLen * (d / maxD) + 0.05 * outLen * rs.next();
        const a = d > 1e-6 ? Math.atan2(ty[i]!, tx[i]!) : rs.next() * Math.PI * 2;
        dirX[i] = Math.cos(a);
        dirY[i] = Math.sin(a);
        spinAxis.push(new THREE.Vector3(rs.next() - 0.5, rs.next() - 0.5, 0).normalize());
      }
    }
    tiles.commitTiles();
    const scatterLen = 0.6 * outLen;

    // 点火：门框底边中间冒一下火（block/fire_0，带动画）
    const fireTex = await ctx.resources.texture('minecraft:block/fire_0');
    const fire = ctx.sprite.create(fireTex);
    fire.object.position.set(0, -1.5 * b + b * 0.5, b * 0.02);
    scene.add(fire.object);
    fire.object.renderOrder = 4;

    // 穿过时的紫色粒子（particle/generic_*，染成传送门的紫色）
    const particleTextures = [];
    for (const k of [3, 5, 7]) {
      const tex = await firstTexture(ctx, [`minecraft:particle/generic_${k}`]);
      if (tex) particleTextures.push(tex.texture);
    }
    const purple = new THREE.Color('#B05CFF');
    purple.setRGB(purple.r * tint.r, purple.g * tint.g, purple.b * tint.b);
    const rp = ctx.random('particles');
    const particles: DebrisParticle[] = [];
    if (particleTextures.length > 0) {
      for (let k = 0; k < 140; k++) {
        const x = (rp.next() - 0.5) * 2 * b;
        const y = (rp.next() - 0.5) * 3 * b;
        const birth = win.out.start + rp.next() * 0.3 * outLen;
        particles.push({
          x,
          y,
          z: 0,
          vx: x * (1 + rp.next()) * 1.2,
          vy: y * (1 + rp.next()) * 1.2,
          vz: nearZ * (0.6 + 0.8 * rp.next()),
          birth,
          life: Math.max(0.05, win.out.end - 1e-3 - birth) * (0.6 + 0.4 * rp.next()),
          size: tileSize * (0.22 + 0.3 * rp.next()),
          u0: 0,
          v0: 0,
          uvSize: 1,
          texture: Math.floor(rp.next() * particleTextures.length),
          tint: [purple.r, purple.g, purple.b],
        });
      }
    }
    const sparks = createDebris(ctx, particleTextures, particles, { gravity: 0, drag: 0.8, renderOrder: 5 });
    scene.add(sparks.object);

    // 音效：放门框（最多 12 个，按时刻均匀抽样）、打火石、开始被吸进去时传送门的声音、穿过时（默认无）
    if (typeof params.placeSound === 'string') {
      for (const i of sampleCueIndices(placeAt)) ctx.audio.cue(params.placeSound, placeAt[i]!, { gain: volume, rate: 0.8, position: cuePosition(cells[i]!.x * b, cells[i]!.y * b, W) });
    }
    if (typeof params.igniteSound === 'string') ctx.audio.cue(params.igniteSound, at(sched.ignite) - 0.03, { gain: volume, position: cuePosition(0, -1.5 * b, W) });
    if (typeof params.portalSound === 'string') ctx.audio.cue(params.portalSound, at(sched.zoomStart), { gain: volume * 0.8 });
    if (typeof params.travelSound === 'string') ctx.audio.cue(params.travelSound, win.out.start, { gain: volume });

    // update 里复用的对象
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const ident = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const backOut = ctx.ease.backOut;
    const cubicIn = ctx.ease.cubicIn;
    const zoomFrom = at(sched.zoomStart);
    const zoomLen = Math.max(1e-4, win.in.end - zoomFrom);

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        // 镜头：点火之后越推越快（三次缓入），在进入阶段末停在传送门铺满画面的距离；之后不动
        const zq = entering ? cubicIn(clamp01((t - zoomFrom) / zoomLen)) : 1;
        camera.position.z = farZ + (nearZ - farZ) * zq;

        // 门框：弹出来落位（同 mining-crack 的放置），落位时朝相机抬起一点。
        // 退出阶段藏起来：镜头停在传送门跟前，门框本来在画外，可碎片散开后会从洞里看到门框朝里的那几面
        for (let i = 0; i < cells.length; i++) {
          const p = clamp01((t - placeAt[i]!) / pop);
          const k = t < placeAt[i]! || !entering ? 0 : p >= 1 ? 1 : 0.6 + 0.4 * backOut(p);
          pos.set(cells[i]!.x * b, cells[i]!.y * b, p > 0 && p < 1 ? (1 - p) * b * 0.35 : 0);
          scl.setScalar(k * b);
          m.compose(pos, ident, scl);
          frame.setMatrix(i, m);
        }
        frame.commit();

        // 火：点火前后 0.15 秒，长出来再缩回去
        const fireP = (t - (at(sched.ignite) - 0.06)) / 0.2;
        const fk = fireP <= 0 || fireP >= 1 ? 0 : Math.sin(Math.PI * fireP);
        fire.setSize(b * fk, b * fk);
        fire.object.position.y = -1.5 * b + (b * fk) / 2;

        // 传送门的碎片
        for (let i = 0; i < count; i++) {
          let k: number;
          let x = tx[i]!;
          let y = ty[i]!;
          let z = 0;
          quat.identity();
          if (entering) {
            k = clamp01((t - lightAt[i]!) / 0.06);
          } else {
            const p = clamp01((t - scatterAt[i]!) / scatterLen);
            k = p >= 1 ? 0 : 1;
            if (p > 0 && p < 1) {
              // 越飞越快，往外的同时朝镜头冲过去（透视下很快出画），自己转一点
              const e = p * p;
              [x, y, z] = scatter(x, y, dirX[i]!, dirY[i]!, 1.5 * b, nearZ * 0.92, e);
              quat.setFromAxisAngle(spinAxis[i]!, e * 1.6);
            }
          }
          pos.set(x, y, z);
          scl.set(k * tileSize * 1.002, k * tileSize * 1.002, 1);
          m.compose(pos, quat, scl);
          tiles.setMatrix(i, m);
          pos.z = z - 0.5;
          m.compose(pos, quat, scl);
          backing.setMatrixAt(i, m);
        }
        tiles.commit();
        backing.instanceMatrix.needsUpdate = true;
        sparks.setTime(t);
      },
      dispose() {
        tiles.dispose();
        quad.dispose();
        backingMaterial.dispose();
        sparks.dispose();
      },
    };
  },
};

export default template;
