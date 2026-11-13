// 内部模板 allay.internal.mascot（docs/07-allay-mascot.md 7.3“烘焙”）：不在模板库里显示，只给 pnpm mascot:bake 用。
//
// 只用公开的模板接口（硬性规则 5）：THREE 和贴图都从 ctx 拿，和用户模板走同一条装载路径（EngineHost.load）。
// 烘焙时把本文件连同 allay.model / allay.motions / allay.rig 打成一个不含 import 的 ESM 文件再交给引擎；
// 这里只有类型导入（编译后消失）。画面是时间的纯函数：update(t) 只看 t。
//
// 参数：
//   view     'body'（全身，用于图集）| 'head'（正面头像）
//   clip     'hover' | 'fly' | 'dance' | 'sad'（view = body）
//   texture  贴图 ID（闭眼版头像用另一张贴图）
//   headK    头像的整数放大倍数（view = head）
import type { SetupContext, TemplateModule } from '@allay/template-sdk';
import { ALLAY_PARTS, ALLAY_TEXTURE_ID, ALLAY_TEXTURE_SIZE, type PartName } from './allay.model';
import { CLIPS, pose, restPose, type ClipName } from './allay.motions';
import { BODY_VIEW, boxFaces, faceShade, headFraming, partMatrices, transformDirection, type Face, type View } from './allay.rig';

export const MASCOT_TEMPLATE_ID = 'allay.internal.mascot';

type Three = SetupContext['THREE'];

interface BoxMesh {
  part: PartName;
  faces: Face[];
  colors: InstanceType<Three['Float32BufferAttribute']>;
  mesh: InstanceType<Three['Mesh']>;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

const template: TemplateModule = {
  async setup(ctx) {
    const { THREE, scene, params, stage } = ctx;
    const view: View = params.view === 'head' ? { kind: 'head' } : { kind: 'body' };
    const clipParam = str(params.clip, 'hover');
    const clip: ClipName = clipParam === 'fly' || clipParam === 'dance' || clipParam === 'sad' ? clipParam : 'hover';
    const texture = await ctx.resources.texture(str(params.texture, ALLAY_TEXTURE_ID));

    // 正交相机，固定看 −Z；取景的转角和俯角在 partMatrices 里作用到模型上
    let camera: InstanceType<Three['OrthographicCamera']>;
    if (view.kind === 'body') {
      const h = BODY_VIEW.half;
      const aspect = stage.width / stage.height;
      camera = new THREE.OrthographicCamera(-h * Math.max(1, aspect), h * Math.max(1, aspect), h / Math.min(1, aspect), -h / Math.min(1, aspect), 1, 100);
    } else {
      const k = typeof params.headK === 'number' && params.headK >= 1 ? Math.floor(params.headK) : 1;
      // stage 是设计单位（短边 1080），换回输出像素
      const f = headFraming(Math.round(stage.width * stage.pixelScale), k);
      camera = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, 1, 100);
    }
    camera.position.set(0, 0, 50);
    camera.updateProjectionMatrix();
    ctx.setCamera(camera);

    const solid = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
    const translucent = new THREE.MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.01,
    });

    const boxes: BoxMesh[] = [];
    for (const part of ALLAY_PARTS) {
      // 头像只画头
      if (view.kind === 'head' && part.name !== 'head') continue;
      for (const b of part.boxes) {
        const faces = boxFaces(b);
        const pos: number[] = [];
        const uv: number[] = [];
        const index: number[] = [];
        faces.forEach((f, i) => {
          for (let k = 0; k < 4; k++) {
            pos.push(...f.positions[k]!);
            uv.push(f.uvs[k]![0] / ALLAY_TEXTURE_SIZE, 1 - f.uvs[k]![1] / ALLAY_TEXTURE_SIZE);
          }
          index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        const colors = new THREE.Float32BufferAttribute(new Float32Array(faces.length * 4 * 3).fill(1), 3);
        geometry.setAttribute('color', colors);
        geometry.setIndex(index);
        const mesh = new THREE.Mesh(geometry, b.translucent ? translucent : solid);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        // 半透明的下摆在不透明部分之后画
        mesh.renderOrder = b.translucent ? 1 : 0;
        scene.add(mesh);
        boxes.push({ part: part.name, faces, colors, mesh });
      }
    }

    const duration = view.kind === 'body' ? CLIPS[clip].duration : 0.1;

    return {
      duration,
      cutTime: null,
      update(t) {
        const p = view.kind === 'body' ? pose(clip, t) : restPose();
        const matrices = partMatrices(p, view);
        for (const b of boxes) {
          const m = matrices[b.part];
          b.mesh.matrix.fromArray(m);
          // 头像不加明暗：正面就是贴图本来的颜色
          if (view.kind === 'head') continue;
          b.faces.forEach((f, i) => {
            const s = faceShade(transformDirection(m, f.normal), f.twoSided);
            for (let k = 0; k < 4; k++) b.colors.setXYZ(i * 4 + k, s, s, s);
          });
          b.colors.needsUpdate = true;
        }
      },
    };
  },
};

export default template;
