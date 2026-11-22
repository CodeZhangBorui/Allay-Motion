// 008 活塞合拢 allay.builtin.piston-push（docs/templates/piston-push.md）。
// 进入：两边各一列活塞（每排一个）滑到画面边上，每排“放一块方块、活塞伸出两刻把整排往里推一格、收回两刻”，
// 一格格把两扇方块墙推到中线合拢；退出时倒着放：粘性活塞伸出够到方块、收回把整排拉出去一格……
// 时间表见 layout.ts。活塞用 block/piston_* 的贴图按游戏的尺寸拼（底座 12 像素、活塞头 4 像素、推杆 4 × 4 像素）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { arrangeCells, toArrangement } from '../../_lib/src/block-arrangement';
import { boxGeometry } from '../../_lib/src/block-box';
import { blockList, cuePosition, groupByKind, kindInstances, sampleCueIndices, type BlockEntry } from '../../_lib/src/block-kit';
import { bool, num } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { AXES, emptyRowState, pistonGrid, pushTicks, rowSchedule, rowState, rowTicks, type Axis } from './layout';

const DEFAULT_BLOCKS: readonly BlockEntry[] = [
  { id: 'minecraft:stone_bricks', weight: 3 },
  { id: 'minecraft:mossy_stone_bricks', weight: 1 },
  { id: 'minecraft:cracked_stone_bricks', weight: 1 },
];

const toAxis = (v: ParamValue | undefined): Axis => (typeof v === 'string' && (AXES as readonly string[]).includes(v) ? (v as Axis) : 'auto');

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const sticky = bool(params.sticky, true);
    const stagger = num(params.stagger, 0.35);
    const volume = num(params.volume, 0.6);
    const win = transitionWindows(stage.fps, num(params.inDuration, 0.9), num(params.hold, 0.12), num(params.outDuration, 0.9));
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;

    // 透视相机（fov 30）和面明暗，同 block-wipe 的 3d 样式：看得到活塞头、推杆的侧面
    ctx.setCamera(ctx.createStageCamera({ fov: 30 }));

    const grid = pistonGrid(W, H, toAxis(params.axis), num(params.rows, 4));
    const { size: s, rows, cells: m } = grid;
    const ticks = rowTicks(m);
    const blocksPerRow = m - 1;
    const sched = rowSchedule(rows, stagger);

    // 每个格子的世界坐标：沿推送方向 along = σ × (c + 0.5) × s（σ = −1 左边或下边，+1 右边或上边），横向按排居中
    const place = (sigma: number, r: number, c: number, out: { x: number; y: number }) => {
      const along = sigma * (c + 0.5) * s;
      const across = ((rows - 1) / 2 - r) * s;
      out.x = grid.horizontal ? along : across;
      out.y = grid.horizontal ? across : along;
      return out;
    };

    // 方块墙：两边 × 每排 (m − 1) 块。每块的种类由“方块排列”决定（按合拢后的整面墙排，block-arrangement）
    const wallCols = 2 * blocksPerRow;
    const entries = blockList(params.blocks, DEFAULT_BLOCKS);
    const arranged = arrangeCells(toArrangement(params.arrangement), entries, grid.horizontal ? wallCols : rows, grid.horizontal ? rows : wallCols, ctx.random('blocks'));
    // 方块 (side, r, j) 停在第 j − 1 格：在合拢后的墙上的行列
    const wallIndex = (side: number, r: number, j: number) => {
      const c = j - 1;
      const k = side < 0 ? blocksPerRow - 1 - c : blocksPerRow + c;
      // 竖着推时排是列（r = 0 在最右边），沿推送方向的格是行
      return grid.horizontal ? r * wallCols + k : (wallCols - 1 - k) * rows + (rows - 1 - r);
    };
    const order: number[] = [];
    for (const side of [-1, 1]) for (let r = 0; r < rows; r++) for (let j = 1; j <= blocksPerRow; j++) order.push(arranged[wallIndex(side, r, j)]!);
    const groups = groupByKind(entries, order);
    const instances = await kindInstances(ctx, groups, true);

    // 活塞的三个部件（单位立方体里的尺寸，朝 +x 推）：底座 x ∈ [−0.5, 0.25]，活塞头 [0.25, 0.5]（伸出时整体往 +x 移），
    // 推杆 4 × 4 像素、x ∈ [0, 1]（伸出 e 格时按 e 缩放、从 0.25 开始）。侧面贴图的上沿（木头那一条）朝 +x
    const tex = async (name: string) => ctx.resources.texture(`minecraft:block/${name}`);
    const sideTex = await tex('piston_side');
    const mat = (map: InstanceType<typeof THREE.Texture>) => new THREE.MeshBasicMaterial({ map, vertexColors: true });
    const sideMat = mat(sideTex);
    const bottomMat = mat(await tex('piston_bottom'));
    const innerMat = mat(await tex('piston_inner'));
    const topMat = mat(await tex(sticky ? 'piston_top_sticky' : 'piston_top'));
    const sideFaces = (v0: number, v1: number) => ({
      south: { material: 0, uv: [0, v0, 16, v1], rotate: 1 },
      north: { material: 0, uv: [0, v0, 16, v1], rotate: 3 },
      up: { material: 0, uv: [0, v0, 16, v1], rotate: 1 },
      down: { material: 0, uv: [0, v0, 16, v1], rotate: 1 },
    });
    const baseGeometry = boxGeometry(THREE, [0.75, 1, 1], { ...sideFaces(4, 16), west: { material: 1, uv: [0, 0, 16, 16] }, east: { material: 2, uv: [0, 0, 16, 16] } }, { center: [-0.125, 0, 0] });
    const headGeometry = boxGeometry(THREE, [0.25, 1, 1], { ...sideFaces(0, 4), east: { material: 1, uv: [0, 0, 16, 16] }, west: { material: 1, uv: [0, 0, 16, 16] } }, { center: [0.375, 0, 0] });
    const armGeometry = boxGeometry(THREE, [1, 0.25, 0.25], sideFaces(0, 4), { center: [0.5, 0, 0] });
    const pistons = 2 * rows;
    const bases = new THREE.InstancedMesh(baseGeometry, [sideMat, bottomMat, innerMat], pistons);
    const heads = new THREE.InstancedMesh(headGeometry, [sideMat, topMat], pistons);
    const arms = new THREE.InstancedMesh(armGeometry, [sideMat], pistons);
    [bases, heads, arms].forEach((mesh, k) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = 1 + k;
      scene.add(mesh);
    });

    // 活塞的朝向：左边（下边）的朝 +x（+y），右边（上边）的绕 y（z）轴转 180°（−90°）
    const facing = (sigma: number) => {
      const q = new THREE.Quaternion();
      if (grid.horizontal) {
        if (sigma > 0) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      } else q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), sigma > 0 ? -Math.PI / 2 : Math.PI / 2);
      return q;
    };
    const faceQuat = [facing(-1), facing(1)];
    const pushDir = [new THREE.Vector3(1, 0, 0).applyQuaternion(faceQuat[0]!), new THREE.Vector3(1, 0, 0).applyQuaternion(faceQuat[1]!)];

    // 每排的时间：开始时刻和每刻的秒数（进入、退出各自按阶段长度换算）
    const rowStartIn = Float64Array.from(sched.start, (u) => win.in.start + u * inLen);
    const rowStartOut = Float64Array.from(sched.start, (u) => win.out.start + u * outLen);
    const tickIn = (sched.length * inLen) / ticks;
    const tickOut = (sched.length * outLen) / ticks;

    // 音效：游戏里活塞伸出、收回的声音音量 0.5，音高 0.6–0.85（伸出）、0.6–0.8（收回）的随机数（经搜索确认）。
    // 每种最多 12 个 cue，按时刻均匀抽样；退出时倒着放，伸出和收回互换
    const pushes = pushTicks(m);
    const at = { x: 0, y: 0 };
    const rp = ctx.random('pitch');
    const cueSet = (sound: ParamValue | undefined, times: number[], where: { x: number; y: number }[], pitchHi: number) => {
      if (typeof sound !== 'string') return;
      for (const k of sampleCueIndices(times)) ctx.audio.cue(sound, times[k]!, { gain: volume, rate: 0.6 + (pitchHi - 0.6) * rp.next(), position: cuePosition(where[k]!.x, where[k]!.y, W) });
    };
    const extendT: number[] = [];
    const extendAt: { x: number; y: number }[] = [];
    const contractT: number[] = [];
    const contractAt: { x: number; y: number }[] = [];
    for (const sigma of [-1, 1]) {
      for (let r = 0; r < rows; r++) {
        const pos = { ...place(sigma, r, m - 1, at) };
        for (const p of pushes) {
          extendT.push(rowStartIn[r]! + p.extend * tickIn);
          extendAt.push(pos);
          contractT.push(rowStartIn[r]! + p.retract * tickIn);
          contractAt.push(pos);
          // 退出倒着放：进入时的收回（第 retract … retract + 2 刻）倒过来是伸出，伸出倒过来是收回（拉回方块）
          extendT.push(rowStartOut[r]! + (ticks - p.retract - 2) * tickOut);
          extendAt.push(pos);
          contractT.push(rowStartOut[r]! + (ticks - p.extend - 2) * tickOut);
          contractAt.push(pos);
        }
      }
    }
    cueSet(params.extendSound, extendT, extendAt, 0.85);
    cueSet(params.contractSound, contractT, contractAt, 0.8);

    // update 里复用的对象
    const state = emptyRowState(m);
    const mtx = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const ident = new THREE.Quaternion();
    const backOut = ctx.ease.backOut;
    const cellPos = { x: 0, y: 0 };
    let blockIdx = 0;

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const entering = t <= win.cutTime;
        blockIdx = 0;
        for (let si = 0; si < 2; si++) {
          const sigma = si === 0 ? -1 : 1;
          const q = faceQuat[si]!;
          const dir = pushDir[si]!;
          for (let r = 0; r < rows; r++) {
            // 这一排在第几刻：进入时顺着走，退出时倒着走
            const tau = entering ? (t - rowStartIn[r]!) / tickIn : ticks - (t - rowStartOut[r]!) / tickOut;
            rowState(Math.min(ticks, Math.max(0, tau)), m, state);
            const visible = tau > 0;
            const k = si * rows + r;
            // 活塞：底座在 pistonCell 格（滑进来的途中是小数）；pistonCell = m 时整个在画外，先藏起来
            place(sigma, r, state.pistonCell, cellPos);
            const show = visible && state.pistonCell < m;
            pos.set(cellPos.x, cellPos.y, 0);
            scl.setScalar(show ? s : 0);
            mtx.compose(pos, q, scl);
            bases.setMatrixAt(k, mtx);
            pos.set(cellPos.x + dir.x * state.head * s, cellPos.y + dir.y * state.head * s, 0);
            mtx.compose(pos, q, scl);
            heads.setMatrixAt(k, mtx);
            // 推杆：从底座前面（+0.25 格）到活塞头后面，长 head 格
            pos.set(cellPos.x + dir.x * 0.25 * s, cellPos.y + dir.y * 0.25 * s, 0);
            scl.set(show ? state.head * s : 0, s, s);
            mtx.compose(pos, q, scl);
            arms.setMatrixAt(k, mtx);
            // 方块
            for (let j = 1; j <= blocksPerRow; j++) {
              const c = state.blockCell[j - 1]!;
              const pop = state.blockPop[j - 1]!;
              let scale = 0;
              let lift = 0;
              if (visible && !Number.isNaN(c) && pop > 0) {
                place(sigma, r, c, cellPos);
                // 出现时从 0.6 弹到 1（略过冲），弹的时候朝相机抬起一点，免得和邻居的面重合闪烁
                scale = pop >= 1 ? 1 : 0.6 + 0.4 * backOut(pop);
                lift = pop < 1 ? (1 - pop) * s * 0.3 : 0;
              }
              pos.set(cellPos.x, cellPos.y, lift);
              scl.setScalar(scale * s);
              mtx.compose(pos, ident, scl);
              instances[groups.cellKind[blockIdx]!]!.setMatrix(groups.cellIndex[blockIdx]!, mtx);
              blockIdx++;
            }
          }
        }
        bases.instanceMatrix.needsUpdate = true;
        heads.instanceMatrix.needsUpdate = true;
        arms.instanceMatrix.needsUpdate = true;
        for (const g of instances) g?.commit();
      },
      dispose() {
        baseGeometry.dispose();
        headGeometry.dispose();
        armGeometry.dispose();
        for (const mm of [sideMat, bottomMat, innerMat, topMat]) mm.dispose();
      },
    };
  },
};

export default template;
