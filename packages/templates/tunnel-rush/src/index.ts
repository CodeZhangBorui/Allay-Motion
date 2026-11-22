// 018 矿道穿梭 allay.builtin.tunnel-rush（docs/templates/tunnel-rush.md）。
// 进入：远处一个方块围成的矿道口迎面放大，镜头钻进矿道，沿着铁轨越冲越快，火把一个个闪过，尽头的墙迎面撞上、铺满画面；
// 退出：撞穿那面墙，墙上的方块往四周翻滚着飞开，镜头从洞里冲出去。
// 墙面只画朝矿道里面的那一面（成批的贴图方片，block-tiles），光照按火把的光照等级算好烘进每块的颜色；尽头的墙是整块的方块（要翻滚）。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { BlockFace, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { blockList, clamp01, cuePosition, kindInstances, sampleCueIndices, srgbToLinear, type BlockEntry } from '../../_lib/src/block-kit';
import { createTiles, MAX_TILE_TEXTURES, type Tiles } from '../../_lib/src/block-tiles';
import { num } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { brightness, FOV, ORES, torchSlices, tunnelLength, wallDistance, weightedPick } from './layout';

const DEFAULT_WALLS: readonly BlockEntry[] = [
  { id: 'minecraft:stone', weight: 8 },
  { id: 'minecraft:andesite', weight: 2 },
  { id: 'minecraft:cobblestone', weight: 1 },
  { id: 'minecraft:gravel', weight: 1 },
];
/** 世界坐标里一格多大（任意取的，只影响数值的大小） */
const S = 100;
/** 镜头从多远开始飞向矿道口（格），开始时矿道口只是远处的一个小点 */
const FAR = 400;
/** 进入阶段里飞向矿道口占的比例 */
const APPROACH_SHARE = 0.3;
/** 面明暗（同引擎的方块）：顶 1.0、底 0.5、南北 0.8、东西 0.6 */
const SHADE: Readonly<Record<BlockFace, number>> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

interface Face {
  kind: string;
  face: BlockFace;
  /** 方片中心（世界坐标）和朝向（绕 x、y 轴转的角度） */
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  /** 这块方块所在的格（算光照用的曼哈顿距离） */
  bx: number;
  by: number;
  bz: number;
}

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const size = Math.round(num(params.size, 3));
    const oreRate = num(params.ores, 0.08);
    const torchSpacing = Math.round(num(params.torches, 6));
    const volume = num(params.volume, 0.6);
    const win = transitionWindows(stage.fps, num(params.inDuration, 1.2), num(params.hold, 0.1), num(params.outDuration, 0.5));
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;
    const N = tunnelLength(num(params.speed, 30), inLen);
    const h = size / 2;
    const dCut = wallDistance(size, stage.aspect);
    const eyeY = -0.12;

    const camera = new THREE.PerspectiveCamera(FOV, stage.aspect, 5, (FAR + N + 20) * S);
    camera.position.set(0, eyeY * S, FAR * S);
    camera.updateProjectionMatrix();
    ctx.setCamera(camera);

    // 墙上的每块方块：墙的方块按权重挑，按“矿石”的比例换成矿石
    const walls = blockList(params.blocks, DEFAULT_WALLS);
    const rk = ctx.random('walls');
    const pickKind = () => (rk.next() < oreRate ? ORES[weightedPick(ORES, rk.next())]!.id : walls[weightedPick(walls, rk.next())]!.id);
    const faces: Face[] = [];
    const cross = Array.from({ length: size }, (_, j) => -h + 0.5 + j);
    for (let k = 0; k < N; k++) {
      const zc = -(k + 0.5);
      for (const c of cross) {
        // 左墙朝东的面、右墙朝西的面、地面朝上的面、顶上朝下的面
        faces.push({ kind: pickKind(), face: 'east', x: -h, y: c, z: zc, rx: 0, ry: Math.PI / 2, bx: -h - 0.5, by: c, bz: zc });
        faces.push({ kind: pickKind(), face: 'west', x: h, y: c, z: zc, rx: 0, ry: -Math.PI / 2, bx: h + 0.5, by: c, bz: zc });
        faces.push({ kind: pickKind(), face: 'up', x: c, y: -h, z: zc, rx: -Math.PI / 2, ry: 0, bx: c, by: -h - 0.5, bz: zc });
        faces.push({ kind: pickKind(), face: 'down', x: c, y: h, z: zc, rx: Math.PI / 2, ry: 0, bx: c, by: h + 0.5, bz: zc });
      }
    }
    // 矿道口：外面一圈方块朝镜头的那一面（连四个角）
    for (let i = -1; i <= size; i++) {
      for (let j = -1; j <= size; j++) {
        if (i >= 0 && i < size && j >= 0 && j < size) continue;
        const x = -h + 0.5 + i;
        const y = -h + 0.5 + j;
        faces.push({ kind: pickKind(), face: 'south', x, y, z: 0, rx: 0, ry: 0, bx: x, by: y, bz: -0.5 });
      }
    }

    // 火把：每隔几节一个，左右墙交替；尽头前一节两边各一个（照亮撞上的那面墙）
    const torches: { x: number; y: number; z: number }[] = [];
    const torchY = -h + 1.5;
    torchSlices(N, torchSpacing).forEach((k, i) => torches.push({ x: i % 2 === 0 ? -h + 0.12 : h - 0.12, y: torchY, z: -(k + 0.5) }));
    if (torchSpacing > 0) for (const x of [-h + 0.12, h - 0.12]) torches.push({ x, y: torchY, z: -(N - 0.5) });
    const ambient = torchSpacing > 0 ? 0.28 : 0.85;
    const lightAt = (bx: number, by: number, bz: number) => {
      const d = torches.map((t) => Math.abs(t.x - bx) + Math.abs(t.y - by) + Math.abs(t.z - bz));
      const torch = torches.length > 0 ? brightness(d, 0) : 0;
      // 火把的光偏暖（游戏里方块光照的颜色偏黄），没有火把照到的地方偏冷一点
      return [Math.min(1, ambient * 0.9 + torch * 1.0), Math.min(1, ambient * 0.93 + torch * 0.88), Math.min(1, ambient * 1.0 + torch * 0.7)] as const;
    };

    // 墙面贴图：每种方块每个面的贴图（引擎缓存里的，只读）；去重后每 8 张一组，一组一个实例化网格
    const handles = new Map<string, Awaited<ReturnType<typeof ctx.resources.block>>>();
    for (const f of faces) if (!handles.has(f.kind)) handles.set(f.kind, await ctx.resources.block(f.kind, { shading: false }));
    const textures: InstanceType<typeof THREE.Texture>[] = [];
    const texIndex = faces.map((f) => {
      const tex = handles.get(f.kind)!.faceTexture(f.face);
      let i = textures.indexOf(tex);
      if (i < 0) i = textures.push(tex) - 1;
      return i;
    });
    const groups: { tiles: Tiles; members: number[] }[] = [];
    for (let g = 0; g * MAX_TILE_TEXTURES < textures.length; g++) {
      const members = faces.map((_, i) => i).filter((i) => Math.floor(texIndex[i]! / MAX_TILE_TEXTURES) === g);
      const tiles = createTiles(ctx, textures.slice(g * MAX_TILE_TEXTURES, (g + 1) * MAX_TILE_TEXTURES), members.length, { renderOrder: 1 + g });
      groups.push({ tiles, members });
      scene.add(tiles.mesh);
    }
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scl = new THREE.Vector3();
    for (const { tiles, members } of groups) {
      members.forEach((fi, j) => {
        const f = faces[fi]!;
        const l = lightAt(f.bx, f.by, f.bz);
        const k = SHADE[f.face];
        tiles.setTile(j, { texture: texIndex[fi]! % MAX_TILE_TEXTURES, tint: [srgbToLinear(l[0] * k), srgbToLinear(l[1] * k), srgbToLinear(l[2] * k)] });
        pos.set(f.x * S, f.y * S, f.z * S);
        quat.setFromEuler(euler.set(f.rx, f.ry, 0));
        scl.set(S * 1.002, S * 1.002, 1);
        m.compose(pos, quat, scl);
        tiles.setMatrix(j, m);
      });
      tiles.commitTiles();
      tiles.commit();
    }

    // 铁轨：每节一块，贴在地面上（铁轨的贴图沿矿道方向）
    const railTex = await ctx.resources.texture('minecraft:block/rail');
    const rails = createTiles(ctx, [railTex], N, { renderOrder: 4 });
    for (let k = 0; k < N; k++) {
      const l = lightAt(0, -h + 0.5, -(k + 0.5));
      rails.setTile(k, { texture: 0, tint: [srgbToLinear(l[0]), srgbToLinear(l[1]), srgbToLinear(l[2])] });
      pos.set(0, -h * S + 1.5, -(k + 0.5) * S);
      quat.setFromEuler(euler.set(-Math.PI / 2, 0, 0));
      scl.set(S, S, 1);
      m.compose(pos, quat, scl);
      rails.setMatrix(k, m);
    }
    rails.commitTiles();
    rails.commit();
    scene.add(rails.mesh);

    // 火把：贴在墙边、朝镜头的方片（block/torch）
    const torchTex = await ctx.resources.texture('minecraft:block/torch');
    const torchTiles = createTiles(ctx, [torchTex], Math.max(1, torches.length), { renderOrder: 5 });
    torches.forEach((t, i) => {
      torchTiles.setTile(i, { texture: 0 });
      pos.set(t.x * S, t.y * S, t.z * S);
      quat.identity();
      scl.set(S * 0.75, S * 0.75, 1);
      m.compose(pos, quat, scl);
      torchTiles.setMatrix(i, m);
    });
    if (torches.length === 0) {
      scl.setScalar(0);
      m.compose(pos, quat, scl);
      torchTiles.setMatrix(0, m);
    }
    torchTiles.commitTiles();
    torchTiles.commit();
    scene.add(torchTiles.mesh);

    // 尽头的墙：size × size 块整块的方块（撞穿时翻滚着飞开），只用墙的方块（不放矿石），照着尽头的火把光
    const endEntries = walls;
    const re = ctx.random('end');
    const endCells: { x: number; y: number; kind: number }[] = [];
    for (const y of cross) for (const x of cross) endCells.push({ x, y, kind: weightedPick(endEntries, re.next()) });
    const endKinds = [...new Set(endEntries.map((e) => e.id))];
    const endGroups = {
      kinds: endKinds,
      cellKind: Uint8Array.from(endCells, (c) => endKinds.indexOf(endEntries[c.kind]!.id)),
      cellIndex: new Uint32Array(endCells.length),
      kindCount: endKinds.map(() => 0),
    };
    endCells.forEach((_, i) => {
      const k = endGroups.cellKind[i]!;
      endGroups.cellIndex[i] = endGroups.kindCount[k]!;
      endGroups.kindCount[k] = endGroups.kindCount[k]! + 1;
    });
    const endBlocks = await kindInstances(ctx, endGroups, true);
    const tint = new THREE.Color();
    endCells.forEach((c, i) => {
      const l = lightAt(c.x, c.y, -(N + 0.5));
      tint.setRGB(srgbToLinear(l[0]), srgbToLinear(l[1]), srgbToLinear(l[2]));
      endBlocks[endGroups.cellKind[i]!]!.setTint(endGroups.cellIndex[i]!, tint);
    });
    // 撞穿后每块飞开的方向、距离、翻滚
    const flyDir = endCells.map((c) => {
      const d = Math.hypot(c.x, c.y);
      const a = d > 0.1 ? Math.atan2(c.y, c.x) : re.next() * Math.PI * 2;
      return { x: Math.cos(a), y: Math.sin(a), reach: 0.5 + 0.7 * re.next(), push: 1 + 1.5 * re.next(), spin: 2 + 4 * re.next(), axis: new THREE.Vector3(re.next() - 0.5, re.next() - 0.5, re.next() - 0.5).normalize() };
    });

    // 镜头的路径：先飞向矿道口（离矿道口的距离按指数缩短，矿道口匀速地放大），再在矿道里越冲越快，最后撞上尽头的墙。
    // 两段在矿道口接上时速度连续
    const tA = APPROACH_SHARE * inLen;
    const tB = inLen - tA;
    const dMouth = 1;
    const vMouth = (dMouth * Math.log(FAR / dMouth)) / tA;
    const lengthB = dMouth + N - dCut;
    const aB = vMouth * tB;
    const bB = lengthB - aB;
    const zAt = (t: number) => {
      const u = t - win.in.start;
      if (u <= tA) return dMouth * Math.exp(Math.log(FAR / dMouth) * (1 - Math.max(0, u) / tA));
      const v = Math.min(1, (u - tA) / tB);
      return dMouth - (aB * v + bB * v * v);
    };
    const zCut = dMouth - lengthB;

    // 音效：进矿道时矿车滚动的声音一次；撞穿时墙碎的声音（最多 12 个，按时刻均匀抽样）
    if (typeof params.rideSound === 'string') ctx.audio.cue(params.rideSound, win.in.start + tA * 0.85, { gain: volume });
    if (typeof params.smashSound === 'string') {
      const times = endCells.map((_, i) => win.out.start + 0.04 * (i % 5));
      for (const i of sampleCueIndices(times)) ctx.audio.cue(params.smashSound, times[i]!, { gain: volume, rate: 0.8, position: cuePosition(endCells[i]!.x * 160, endCells[i]!.y * 160, W) });
    }

    const visibleFrom = win.in.start;
    const ident = new THREE.Quaternion();
    const q1 = new THREE.Quaternion();
    const groupsAll = [...groups.map((g) => g.tiles.mesh), rails.mesh, torchTiles.mesh];

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        const show = t > visibleFrom && t < win.out.end;
        for (const g of groupsAll) g.visible = show;
        let z: number;
        let fov = FOV;
        let bob = 0;
        let pitch = 0;
        if (t <= win.in.end) {
          z = zAt(t);
          // 冲刺时视野略放大（像疾跑），撞上时正好回到 70°；矿车的颠簸
          const u = clamp01((t - win.in.start - tA) / tB);
          fov = FOV + 9 * Math.sin(Math.PI * u) * (1 - u * 0.4) * (u < 1 ? 1 : 0);
          bob = u > 0 && u < 1 ? 0.02 * Math.sin(2 * Math.PI * 9 * t) * Math.sin(Math.PI * u) : 0;
        } else if (t < win.out.start) {
          // 撞上之后：镜头停在墙前，轻轻震一下
          z = zCut;
          const tau = t - win.in.end;
          pitch = 0.006 * Math.exp(-12 * tau) * Math.sin(2 * Math.PI * 13 * tau);
        } else {
          // 撞穿：镜头越冲越快，大约在退出阶段六成时穿过墙所在的平面，再追上往前飞的碎块
          const p = clamp01((t - win.out.start) / outLen);
          z = zCut - (dCut + 4.5) * p ** 2.2;
          fov = FOV + 10 * p;
        }
        camera.position.set(0, (eyeY + bob) * S, z * S);
        camera.rotation.set(pitch, 0, 0);
        if (camera.fov !== fov) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
        // 尽头的墙
        const p = t <= win.cutTime ? 0 : clamp01((t - win.out.start) / outLen);
        endCells.forEach((c, i) => {
          const f = flyDir[i]!;
          // 碎块起步快、逐渐慢下来（被撞开），镜头越来越快地追上、从它们中间穿过去
          const e = 1 - (1 - p) ** 1.5;
          pos.set((c.x + f.x * f.reach * e) * S, (c.y + f.y * f.reach * e) * S, (-(N + 0.5) - f.push * e) * S);
          if (p > 0) q1.setFromAxisAngle(f.axis, f.spin * e);
          else q1.copy(ident);
          scl.setScalar(show ? S : 0);
          m.compose(pos, q1, scl);
          endBlocks[endGroups.cellKind[i]!]!.setMatrix(endGroups.cellIndex[i]!, m);
        });
        for (const b of endBlocks) b?.commit();
      },
      dispose() {
        for (const g of groups) g.tiles.dispose();
        rails.dispose();
        torchTiles.dispose();
      },
    };
  },
};

export default template;
