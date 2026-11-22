// 022 掉落物涌入 allay.builtin.item-swarm（docs/templates/item-swarm.md）。
// 进入：上百个掉落的方块像掉落物那样绕竖轴自转、上下浮动，从画面外沿曲线飞向各自的格子，从中间往外堆满；
// 退出：从中间开始向外散开、缩回掉落物的大小飞出画面。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { arrangeCells, toArrangement } from '../../_lib/src/block-arrangement';
import { blockList, clamp01, cuePosition, groupByKind, jittered, kindInstances, orderValues, sampleCueIndices, toOrderPattern, wallGrid, type BlockEntry } from '../../_lib/src/block-kit';
import { num } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { bezier, bobHeight, controlPoint, exitDistance, FLIGHT_SCALE, FLIGHT_SHARE, flightProgress, landScale, ORIGINS, SCATTER_SHARE, scatterProgress, spinAngle, startPoint, type Origin, type Vec2 } from './layout';

const DEFAULT_BLOCKS: readonly BlockEntry[] = [
  { id: 'minecraft:grass_block', weight: 2 },
  { id: 'minecraft:dirt', weight: 2 },
  { id: 'minecraft:cobblestone', weight: 2 },
  { id: 'minecraft:stone', weight: 2 },
  { id: 'minecraft:oak_log', weight: 2 },
  { id: 'minecraft:oak_planks', weight: 1 },
  { id: 'minecraft:sand', weight: 1 },
  { id: 'minecraft:gravel', weight: 1 },
];

const toOrigin = (v: ParamValue | undefined): Origin => (typeof v === 'string' && (ORIGINS as readonly string[]).includes(v) ? (v as Origin) : 'around');

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const cols = Math.round(num(params.cols, 14));
    const origin = toOrigin(params.origin);
    const fillOrder = toOrderPattern(params.fillOrder, 'centerOut');
    const spinTurns = num(params.spinSpeed, 1);
    const volume = num(params.volume, 0.6);
    const ease = ctx.ease.from(params.easing ?? 'quadIn');
    const win = transitionWindows(stage.fps, num(params.inDuration, 0.8), num(params.hold, 0.1), num(params.outDuration, 0.6));
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;

    // 透视相机（fov 30）和面明暗：掉落物飞近时变大，自转时看得到侧面
    ctx.setCamera(ctx.createStageCamera({ fov: 30 }));

    const grid = wallGrid(W, H, cols);
    const { size: s, count, px, py } = grid;
    const noise = (x: number, y: number) => ctx.noise2D(x, y, 'order');

    // 落位的先后（0 最先，默认从中间往外堆）
    const ro = ctx.random('fill');
    const base = orderValues(fillOrder, px, py, W, H, () => ro.next(), noise);
    const uLand = fillOrder === 'random' ? base : jittered(base, 0.18, () => ro.next());

    // 每个掉落物：出发点、曲线、飞行时长、初始角、浮动的相位（都在 setup 里定好）
    const rf = ctx.random('flight');
    const starts: Vec2[] = [];
    const controls: Vec2[] = [];
    const flight = new Float64Array(count);
    const phase = new Float64Array(count);
    const bobPhase = new Float64Array(count);
    let maxFlight = 0;
    for (let i = 0; i < count; i++) {
      const slot = { x: px[i]!, y: py[i]! };
      const a = startPoint(origin, slot, W, H, s, [rf.next(), rf.next(), rf.next()]);
      starts.push(a);
      controls.push(controlPoint(a, slot, (rf.next() - 0.5) * 0.6));
      flight[i] = FLIGHT_SHARE * inLen * (0.85 + 0.3 * rf.next());
      maxFlight = Math.max(maxFlight, flight[i]!);
      phase[i] = rf.next() * Math.PI * 2;
      bobPhase[i] = rf.next() * Math.PI * 2;
    }
    // 落位时刻：最早的出发不早于进入阶段的开始，最晚的落位恰好在阶段末
    const landAt = Float64Array.from(uLand, (u) => win.in.start + maxFlight + u * (inLen - maxFlight));
    const spin = spinTurns * Math.PI * 2;

    // 散开：方向从画面中心指向格子（偏 ±20°），飞到画外再多一格半；从中间开始
    const rs = ctx.random('scatter');
    const scatterOrder = jittered(orderValues('centerOut', px, py, W, H, () => 0, noise), 0.25, () => rs.next());
    const scatterLen = SCATTER_SHARE * outLen;
    const scatterAt = Float64Array.from(scatterOrder, (v) => win.out.start + v * (outLen - scatterLen));
    const dirX = new Float64Array(count);
    const dirY = new Float64Array(count);
    const reach = new Float64Array(count);
    const hop = new Float64Array(count);
    const spinOut = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const d = Math.hypot(px[i]!, py[i]!);
      const a = (d > s * 0.25 ? Math.atan2(py[i]!, px[i]!) : rs.next() * Math.PI * 2) + (rs.next() - 0.5) * (Math.PI / 4.5);
      dirX[i] = Math.cos(a);
      dirY[i] = Math.sin(a);
      reach[i] = exitDistance({ x: px[i]!, y: py[i]! }, dirX[i]!, dirY[i]!, W, H, 1.5 * s);
      hop[i] = s * (0.4 + 0.8 * rs.next());
      spinOut[i] = spin * (0.8 + 0.8 * rs.next());
    }

    // 方块：每个格子放哪种由“方块排列”决定（block-arrangement）；每种一组实例
    const entries = blockList(params.blocks, DEFAULT_BLOCKS);
    const arranged = arrangeCells(toArrangement(params.arrangement), entries, grid.cols, grid.rows, ctx.random('blocks'));
    const groups = groupByKind(entries, arranged);
    const instances = await kindInstances(ctx, groups, true);

    // 音效：落位时放拾取声（最多 12 个，按时刻均匀抽样），音高照游戏随机；开始散开时放一次散开声
    if (typeof params.pickupSound === 'string') {
      const rp = ctx.random('pickup-pitch');
      for (const i of sampleCueIndices(landAt)) {
        // 游戏里拾取声的音高是 ((r1 − r2) × 0.7 + 1) × 2（凭记忆），这里收窄到 1.2–2.8
        const rate = Math.min(2.8, Math.max(1.2, ((rp.next() - rp.next()) * 0.7 + 1) * 2));
        ctx.audio.cue(params.pickupSound, landAt[i]!, { gain: volume, rate, position: cuePosition(px[i]!, py[i]!, W) });
      }
    }
    if (typeof params.scatterSound === 'string') ctx.audio.cue(params.scatterSound, win.out.start, { gain: volume });

    // update 里复用的对象（update 内不分配内存）
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const at: Vec2 = { x: 0, y: 0 };
    const backOut = ctx.ease.backOut;

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        for (let i = 0; i < count; i++) {
          let k = 0;
          let angle = 0;
          if (entering) {
            const startT = landAt[i]! - flight[i]!;
            if (t > startT) {
              const p = clamp01((t - startT) / flight[i]!);
              const q = flightProgress(p, ease);
              bezier(starts[i]!, controls[i]!, { x: px[i]!, y: py[i]! }, q, at);
              k = landScale(q, backOut);
              angle = spinAngle(phase[i]!, spin, t - startT, flight[i]!, q);
              // 飞行中上下浮动（落位前淡掉），并朝相机抬起，落位时回到墙面
              const bob = q < 1 ? bobHeight(t - startT, bobPhase[i]!) * s * FLIGHT_SCALE * (1 - q) : 0;
              pos.set(at.x, at.y + bob, s * 0.9 * (1 - q));
            }
          } else {
            const p = clamp01((t - scatterAt[i]!) / scatterLen);
            const landed = spinAngle(phase[i]!, spin, flight[i]!, flight[i]!, 1);
            if (p < 1) {
              const e = scatterProgress(p);
              k = 1 - (1 - FLIGHT_SCALE) * Math.min(1, p / 0.25);
              angle = landed + spinOut[i]! * Math.max(0, t - scatterAt[i]!);
              pos.set(px[i]! + dirX[i]! * reach[i]! * e, py[i]! + dirY[i]! * reach[i]! * e + hop[i]! * 4 * p * (1 - p), s * (1.6 * e + 0.3 * Math.min(1, p / 0.1)));
            }
          }
          if (k > 0) {
            quat.setFromAxisAngle(up, angle);
            scl.setScalar(k * s);
          } else {
            quat.identity();
            scl.setScalar(0);
            pos.set(px[i]!, py[i]!, 0);
          }
          m.compose(pos, quat, scl);
          instances[groups.cellKind[i]!]!.setMatrix(groups.cellIndex[i]!, m);
        }
        for (const g of instances) g?.commit();
      },
    };
  },
};

export default template;
