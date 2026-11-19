// 在假的 ctx 里跑动画生成的 template.js（Worker 契约：只用 ctx，不 import）。记下每个画出来的对象的
// 世界矩阵、可见、不透明度，以及音效、随机流的调用，供第三轮的单元测试核对（T-ANIM-22 起）。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { SetupContext, TemplateInstance, TemplateModule } from '../../../packages/template-sdk/src/index';
import { animationTemplateCode } from '../../../apps/desktop/src/shared/animation/compile';
import type { AnimationDoc } from '../../../apps/desktop/src/shared/animation/schema';
import { createRng } from '../../../packages/engine/src/random';

export const THREE = (await import(pathToFileURL(createRequire(new URL('../../../packages/engine/package.json', import.meta.url)).resolve('three')).href)) as SetupContext['THREE'];
type Matrix4 = InstanceType<SetupContext['THREE']['Matrix4']>;
type Object3D = InstanceType<SetupContext['THREE']['Object3D']>;

/** 一个画出来的东西：方块实例（每个实例一项）或其他对象 */
export interface Drawn {
  kind: 'block' | 'item' | 'text' | 'mesh' | 'sprite';
  /** 方块、物品的 id，文字的内容，精灵的贴图 */
  what: string;
  matrix: () => Matrix4;
  visible: () => boolean;
  opacity: () => number;
}

export interface Run {
  instance: TemplateInstance;
  drawn: Drawn[];
  cues: { sound: string | null; at: number; opts: unknown }[];
  textures: string[];
  scene: InstanceType<SetupContext['THREE']['Scene']>;
}

function worldOf(o: Object3D): Matrix4 {
  o.updateWorldMatrix(true, false);
  return o.matrixWorld.clone();
}

/** code 不给时用转成模板的代码（文档嵌在里面）；给了就用它（比如编辑时的预览模板，文档在参数里） */
export async function runAnimation(doc: AnimationDoc, params: Record<string, unknown> = {}, code = animationTemplateCode(doc)): Promise<Run> {
  const mod = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as { default: TemplateModule };
  const drawn: Drawn[] = [];
  const cues: Run['cues'] = [];
  const textures: string[] = [];
  const scene = new THREE.Scene();
  const meshOpacity = (o: Object3D): number => {
    let v = 1;
    o.traverse((x) => {
      const m = (x as unknown as { material?: { opacity?: number } }).material;
      if (m && typeof m.opacity === 'number') v = m.opacity;
    });
    return v;
  };
  const tracked = (kind: Drawn['kind'], what: string, object: Object3D, opacity: () => number) => {
    drawn.push({ kind, what, matrix: () => worldOf(object), visible: () => object.visible && object.parent !== null && object.parent.visible, opacity });
  };
  const ctx = {
    THREE,
    params,
    stage: { width: 1920, height: 1080, aspect: 16 / 9, fps: 60, pixelScale: 1 },
    scene,
    camera: new THREE.OrthographicCamera(),
    setCamera: () => undefined,
    createStageCamera: () => new THREE.PerspectiveCamera(),
    resources: {
      texture: async (id: string) => {
        textures.push(id);
        const tex = new THREE.Texture();
        (tex as unknown as { image: unknown }).image = { width: 16, height: 16 };
        return tex;
      },
      block: async (id: string) => ({
        single: () => new THREE.Object3D(),
        faceTexture: () => new THREE.Texture(),
        instanced: (count: number) => {
          const object = new THREE.Object3D();
          const ms = Array.from({ length: count }, () => new THREE.Matrix4());
          const op = Array.from({ length: count }, () => 1);
          for (let i = 0; i < count; i++) {
            drawn.push({
              kind: 'block',
              what: id,
              matrix: () => {
                object.updateWorldMatrix(true, false);
                return object.matrixWorld.clone().multiply(ms[i]!);
              },
              visible: () => object.visible && (object.parent ? object.parent.visible : true),
              opacity: () => op[i]!,
            });
          }
          return { object, count, setMatrix: (i: number, m: Matrix4) => void ms[i]!.copy(m), setOpacity: (i: number, o: number) => void (op[i] = o), setTint: () => undefined, commit: () => undefined };
        },
      }),
      item: async (id: string) => ({
        single: () => {
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
          mesh.userData.tracked = true;
          tracked('item', id, mesh, () => meshOpacity(mesh));
          return mesh;
        },
      }),
    },
    text: {
      create: (opts: { text: string; size: number }) => {
        const object = new THREE.Object3D();
        let op = 1;
        tracked('text', opts.text, object, () => op);
        return { object, width: opts.text.length * 6 * opts.size, height: 9 * opts.size, setOpacity: (o: number) => void (op = o) };
      },
    },
    sprite: {
      create: (tex: { image?: unknown }) => {
        const object = new THREE.Object3D();
        let op = 1;
        tracked('sprite', String(textures.at(-1) ?? ''), object, () => op);
        void tex;
        return { object, setSize: (w: number, h: number) => void object.scale.set(w, h, 1), setOpacity: (o: number) => void (op = o) };
      },
    },
    random: (key = 'default') => createRng(0, key),
    noise2D: () => 0,
    ease: { linear: (x: number) => x, from: () => (x: number) => x, bezier: () => (x: number) => x },
    math: {},
    time: { segment: () => 0 },
    audio: { cue: (sound: string | null, at: number, opts?: unknown) => void cues.push({ sound, at, opts }) },
    warn: () => undefined,
  } as unknown as SetupContext;
  const instance = await mod.default.setup(ctx);
  // 场景里直接挂着的 Mesh（色块、形状）：按出现顺序记下
  scene.traverse((o) => {
    if ((o as unknown as { isMesh?: boolean }).isMesh && !o.userData.tracked) tracked('mesh', o.name || 'mesh', o, () => meshOpacity(o));
  });
  return { instance, drawn, cues, textures, scene };
}

export const pos = (m: Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
export const scaleOf = (m: Matrix4) => new THREE.Vector3().setFromMatrixScale(m);
