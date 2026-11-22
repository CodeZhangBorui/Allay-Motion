// 011 关门 allay.builtin.door-shut（docs/templates/door-shut.md）。
// 进入：两扇放大的门（或一扇）从朝着镜头敞开的位置绕门轴合上，越关越快，撞上门框回弹一下落定，盖住画面；
// 退出：门被推开，转回镜头这一侧、出画。门上的窗是镂空的，门后垫一层不透明的底（backing），剪辑点不透明。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { boxGeometry, type BoxFace } from '../../_lib/src/block-box';
import { clamp01, cuePosition, srgbToLinear } from '../../_lib/src/block-kit';
import { num, rgbOf } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { closeAngle, DOOR_LAYOUTS, DOOR_THICKNESS, doorGrid, DOORS, doorSound, maxPerspective, openAngle, openLimit, SLAM_AT, swingShade, type Door, type DoorLayout } from './layout';

const pick = <T extends string>(v: ParamValue | undefined, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);

/** 门扇一半（上半或下半）的各个面：正面整张贴图，背面左右翻过来，四条边取贴图边上 3 像素宽的一条 */
function halfFaces(mirror: boolean, top: boolean): Partial<Record<'up' | 'down' | 'north' | 'south' | 'east' | 'west', BoxFace>> {
  const front = mirror ? [16, 0, 0, 16] : [0, 0, 16, 16];
  const back = mirror ? [0, 0, 16, 16] : [16, 0, 0, 16];
  return {
    south: { material: 0, uv: front },
    north: { material: 0, uv: back },
    east: { material: 0, uv: [13, 0, 16, 16] },
    west: { material: 0, uv: [0, 0, 3, 16] },
    ...(top ? { up: { material: 0, uv: [0, 0, 16, 3] } } : { down: { material: 0, uv: [0, 13, 16, 16] } }),
  };
}

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const door = pick<Door>(params.door, DOORS, 'oak');
    const layout = pick<DoorLayout>(params.layout, DOOR_LAYOUTS, 'auto');
    const bounce = num(params.bounce, 0.5) * 6;
    const volume = num(params.volume, 0.8);
    const ease = ctx.ease.from(params.easing ?? 'quadIn');
    const win = transitionWindows(stage.fps, num(params.inDuration, 0.6), num(params.hold, 0.2), num(params.outDuration, 0.55));

    const grid = doorGrid(W, H, layout);
    // 透视不超过 maxPerspective：横屏、方屏单开时门扇比画面还宽，视角再大门转过来会扫过相机
    const fov = Math.min(num(params.perspective, 35), maxPerspective(H, grid));
    const camera = ctx.createStageCamera({ fov });
    ctx.setCamera(camera);
    // 门开到这个角度就整扇在画外：关门从这里开始，开门转到这里为止（不浪费看不见的那一段）
    const open = openLimit(W, camera.position.z);

    const L = grid.width;
    const T = L * DOOR_THICKNESS;
    const topTex = await ctx.resources.texture(`minecraft:block/${door}_door_top`);
    const bottomTex = await ctx.resources.texture(`minecraft:block/${door}_door_bottom`);
    const backingColor = new THREE.Color(rgbOf(params.backing, '#17130F'));

    // 每扇门：门轴处一个枢轴，里面是上半、下半两个长方体和贴在门里面的垫底。
    // 对开时左扇的门轴在 x = −L、右扇在 x = +L（门扇比半个画面宽一点，外沿在画外），右扇的贴图左右翻转（同游戏）
    const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
    const materials: InstanceType<typeof THREE.MeshBasicMaterial>[] = [];
    const pivots: { pivot: InstanceType<typeof THREE.Object3D>; sign: number; delay: number; shade: InstanceType<typeof THREE.MeshBasicMaterial>[] }[] = [];
    const backingMaterial = new THREE.MeshBasicMaterial({ color: backingColor });
    materials.push(backingMaterial);
    for (let r = 0; r < grid.rows; r++) {
      const y = ((grid.rows - 1) / 2 - r) * 2 * L;
      for (let j = 0; j < grid.leaves; j++) {
        // sign：门扇从门轴向 +x（左扇、单开）还是 −x（右扇）伸出
        const sign = grid.leaves === 1 || j === 0 ? 1 : -1;
        const hingeX = grid.leaves === 1 ? -L / 2 : sign * -L;
        const pivot = new THREE.Object3D();
        pivot.position.set(hingeX, y, 0);
        const mirror = sign < 0;
        const leafMaterials: InstanceType<typeof THREE.MeshBasicMaterial>[] = [];
        for (const top of [true, false]) {
          // 门轴在门扇背面的那条棱上（门扇在 z ∈ [0, T]）：开到 90° 时整扇门（连厚度）都在门轴外侧、画面外
          const geometry = boxGeometry(THREE, [L, L, T], halfFaces(mirror, top), { center: [(sign * L) / 2, top ? L / 2 : -L / 2, T / 2] });
          const material = new THREE.MeshBasicMaterial({ map: top ? topTex : bottomTex, vertexColors: true, alphaTest: 0.5 });
          geometries.push(geometry);
          materials.push(material);
          leafMaterials.push(material);
          pivot.add(new THREE.Mesh(geometry, material));
        }
        // 垫底：门扇里面一层不透明的平面，门窗的镂空处透出来的是它
        const backingGeometry = new THREE.PlaneGeometry(L * 0.998, 2 * L * 0.998);
        geometries.push(backingGeometry);
        const backing = new THREE.Mesh(backingGeometry, backingMaterial);
        backing.position.set((sign * L) / 2, 0, T / 2);
        pivot.add(backing);
        scene.add(pivot);
        // 对开时右扇晚一点点（推开时两只手不会完全同时）
        pivots.push({ pivot, sign, delay: sign < 0 ? 0.04 : 0, shade: leafMaterials });
      }
    }

    // 音效：撞上门框时关门声，开始推开时开门声；保持木门的默认音效时按门的种类换（layout.ts 的 doorSound）
    const slamAt = win.in.start + SLAM_AT * (win.in.end - win.in.start);
    const rs = ctx.random('sound');
    const closeSound = doorSound(typeof params.closeSound === 'string' ? params.closeSound : null, door, 'close');
    const openSound = doorSound(typeof params.openSound === 'string' ? params.openSound : null, door, 'open');
    // 游戏里开关门声的音高是 0.9–1.0 之间的随机数（凭记忆）
    if (closeSound) ctx.audio.cue(closeSound, slamAt, { gain: volume, rate: 0.9 + 0.1 * rs.next(), position: cuePosition(0, 0, W) });
    if (openSound) ctx.audio.cue(openSound, win.out.start, { gain: volume, rate: 0.9 + 0.1 * rs.next(), position: cuePosition(0, 0, W) });

    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;
    const baseShade = srgbToLinear(0.8);

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        for (const p of pivots) {
          let angle: number;
          if (t <= win.cutTime) angle = closeAngle(clamp01((t - win.in.start) / inLen), ease, bounce, open);
          else {
            const d = p.delay * outLen;
            angle = openAngle(clamp01((t - win.out.start - d) / (outLen - d)), open);
          }
          // 门朝镜头这一侧转开：左扇绕 y 轴转 −θ，右扇转 +θ
          p.pivot.rotation.y = (-p.sign * angle * Math.PI) / 180;
          const k = srgbToLinear(swingShade(angle)) / baseShade;
          for (const m of p.shade) m.color.setRGB(k, k, k);
        }
      },
      dispose() {
        for (const g of geometries) g.dispose();
        for (const m of materials) m.dispose();
      },
    };
  },
};

export default template;
