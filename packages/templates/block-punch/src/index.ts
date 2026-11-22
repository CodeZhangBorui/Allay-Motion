// 013 方块冲镜 allay.builtin.block-punch（docs/templates/block-punch.md）。
// 进入：一个方块从画外的远处翻滚着飞来，越来越快，撞到镜头时一个面正好铺满画面，撞上后自己晃几下；
// 退出：接着来时的势头冲向镜头、从镜头旁边掠过去。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（04-templates.md 4.9）。
import type { ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { clamp01 } from '../../_lib/src/block-kit';
import { num, str } from '../../_lib/src/gui-kit';
import { transitionWindows } from '../../_lib/src/timing';
import { approachStart, cameraDistance, exitPath, FACES, FRAMINGS, impactLayout, shakeAngle, type Face, type Framing } from './layout';

/** 透视的垂直视角（度）：比 block-wipe 的 30° 大一些，飞近时的变大更明显 */
const FOV = 40;
/** 飞来起点处方块投影的边长，占画面高度的比例 */
const START_SIZE = 0.32;

const pick = <T extends string>(v: ParamValue | undefined, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const approach = num(params.approach, 195);
    const turns = Math.round(num(params.spin, 1));
    const shake = num(params.impactShake, 0.5);
    const face = pick<Face>(params.face, FACES, 'side');
    const framing = pick<Framing>(params.framing, FRAMINGS, 'top');
    const volume = num(params.volume, 0.7);
    const ease = ctx.ease.from(params.easing ?? 'quadIn');
    const win = transitionWindows(stage.fps, num(params.inDuration, 0.55), num(params.hold, 0.12), num(params.outDuration, 0.45));

    // 自己建透视相机：飞来的起点很远，超出 createStageCamera 的远平面；位置和它一样（z = 0 平面恰好填满舞台）
    const D = cameraDistance(H, FOV);
    const { size: B, y: impactY } = impactLayout(W, H, framing);
    const far = D * (B / (START_SIZE * H) - 1);
    const camera = new THREE.PerspectiveCamera(FOV, stage.aspect, Math.max(1, D * 0.02), D + far + B * 4);
    camera.position.set(0, 0, D);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    ctx.setCamera(camera);

    // 方块：边长 B，撞上时前面贴着 z = 0 平面
    const block = (await ctx.resources.block(str(params.block, 'minecraft:grass_block'), { shading: true })).single();
    const holder = new THREE.Object3D();
    holder.add(block);
    holder.visible = false;
    scene.add(holder);

    // 撞上时朝向相机的面：side 是南面（默认朝向相机），top / bottom 绕 x 轴转 ±90°
    const final = new THREE.Quaternion();
    if (face === 'top') final.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    else if (face === 'bottom') final.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    // 翻滚轴：垂直于来的方向（像朝镜头滚过来），带一点竖轴的分量
    const a = (approach * Math.PI) / 180;
    const tumbleAxis = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0.45).normalize();
    const exitAxis = new THREE.Vector3(-Math.sin(a), Math.cos(a), -0.3).normalize();
    const shakeX = new THREE.Vector3(1, 0, 0);
    const shakeY = new THREE.Vector3(0, 1, 0);

    const start = approachStart(approach, W, H, B, D, far);
    const impact = { x: 0, y: impactY, z: -B / 2 };
    // 起点在画面上的投影（中心）：飞行中按投影插值，画面上走一条平滑的曲线
    const kStart = D / (D - start.z);
    const sx = start.x * kStart;
    const sy = start.y * kStart;

    // 音效：起飞时一声呼啸，撞上时一声（方块的位置在相机前一格），开始飞走时再一声
    const cue = (sound: ParamValue | undefined, at: number, position?: { x: number; y: number; z: number }) => {
      if (typeof sound === 'string') ctx.audio.cue(sound, at, { gain: volume, ...(position ? { position } : {}) });
    };
    cue(params.whooshSound, win.in.start);
    cue(params.impactSound, win.in.end, { x: 0, y: 0, z: -1 });
    cue(params.exitSound, win.out.start);

    // update 里复用的对象
    const q1 = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const inLen = win.in.end - win.in.start;
    const outLen = win.out.end - win.out.start;
    const spin = turns * Math.PI * 2;

    return {
      duration: win.duration,
      cutTime: win.cutTime,
      update(t: number) {
        holder.visible = t > win.in.start && t < win.out.end;
        if (!holder.visible) return;
        const quat = holder.quaternion;
        if (t <= win.in.end) {
          // 飞来：深度按缓动后的进度线性走，画面上的偏移按 (1 − q)² 收向中心；翻滚角走完整圈数，撞上时正好回到“面朝相机”
          const p = clamp01((t - win.in.start) / inLen);
          const q = p >= 1 ? 1 : ease(p);
          const z = start.z + (impact.z - start.z) * q;
          const k = (D - z) / D;
          const off = (1 - q) * (1 - q);
          holder.position.set(sx * off * k, sy * off * k + impactY * (1 - off), z);
          q1.setFromAxisAngle(tumbleAxis, (1 - q) * spin);
          quat.copy(final).premultiply(q1);
        } else if (t < win.out.start) {
          // 撞上之后：方块自己晃几下（衰减的正弦，绕两个轴错开相位）。面比画面大 14%，晃动不露边
          const tau = t - win.in.end;
          holder.position.set(impact.x, impact.y, impact.z + B * 0.012 * Math.exp(-10 * tau) * Math.sin(Math.min(1, tau * 30) * Math.PI));
          q1.setFromAxisAngle(shakeX, shakeAngle(tau, shake));
          q2.setFromAxisAngle(shakeY, shakeAngle(tau + 0.023, shake) * 0.7);
          quat.copy(final).premultiply(q1).premultiply(q2);
        } else {
          // 飞走：越来越快地冲向镜头，同时侧移到镜头旁边掠过去；接着翻滚
          const p = clamp01((t - win.out.start) / outLen);
          const q = p * p;
          const at = exitPath(q, impact, approach, B, D);
          holder.position.set(at.x, at.y, at.z);
          q1.setFromAxisAngle(exitAxis, q * Math.PI * 0.6);
          quat.copy(final).premultiply(q1);
        }
        holder.scale.setScalar(B);
      },
    };
  },
};

export default template;
