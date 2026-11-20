// T-ANIM-1：动画文档的格式（docs/animation-editor.md 第 3 节）与生成的模板（第 4 节）。
// T-ANIM-2：生成的 template.js 在一个假的 ctx 里运行：只用公开接口、画面只取决于 t（乱序取帧结果相同）、关键帧与缓动的取值正确。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest, type SetupContext, type TemplateInstance, type TemplateModule } from '../../packages/template-sdk/src/index';
import { animationManifest, animationTemplateCode, animationTemplateFiles, GENERATED_MARKER } from '../../apps/desktop/src/shared/animation/compile';
import { AnimationDocSchema, newAnimationDoc, parseAnimation, serializeAnimation, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { analyzeTemplateCode } from '../../apps/desktop/src/shared/template-code';
import { ProjectDataSchema, ProjectFileSchema } from '../../apps/desktop/src/shared/project';

// three 是引擎的依赖（根目录没有）：从引擎包解析
const THREE = (await import(pathToFileURL(createRequire(new URL('../../packages/engine/package.json', import.meta.url)).resolve('three')).href)) as SetupContext['THREE'];
type Matrix4 = InstanceType<SetupContext['THREE']['Matrix4']>;

const REF = { id: 'user.abc123.animation', version: '1.0.0' };

function doc(patch: Partial<AnimationDoc> = {}): AnimationDoc {
  return AnimationDocSchema.parse({ ...newAnimationDoc('Test'), ...patch });
}

describe('T-ANIM-1 动画文档', () => {
  it('新建的文档合 schema，序列化再解析得到同一份', () => {
    const d = newAnimationDoc('Hello', '方块');
    const text = serializeAnimation(d);
    const back = parseAnimation(text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.doc).toEqual(d);
    // 关键帧压成一行，读起来像表格
    expect(text).toMatch(/\{ "t": 0, "v": -700, "ease": "backOut" \}/);
  });

  it('JSON 语法错误带行列', () => {
    const r = parseAnimation('{\n  "kind": "allay-animation",\n  "name": oops\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ line: 3, column: 11 });
    const trailing = parseAnimation('{\n  "a": 1,\n}');
    if (!trailing.ok) expect(trailing.issues[0]).toMatchObject({ line: 3, column: 1 });
  });

  it('schema 错误指出路径；关键帧必须按时间排序；图层 id 不得重复；转场必须有剪辑点', () => {
    const base = newAnimationDoc('X');
    const bad = (mut: (d: Record<string, unknown>) => void) => {
      const j = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mut(j);
      const r = parseAnimation(JSON.stringify(j, null, 2));
      expect(r.ok).toBe(false);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    expect(bad((j) => ((j.layers as { props: { y: unknown } }[])[0]!.props.y = { keys: [{ t: 1, v: 0 }, { t: 0.5, v: 1 }] }))).toEqual(['layers.0.props.y']);
    expect(bad((j) => (j.layers = [...(j.layers as unknown[]), ...(j.layers as unknown[])]))).toContain('layers.1.id');
    expect(bad((j) => (j.category = 'transition'))).toEqual(['cutTime']);
    expect(bad((j) => ((j.layers as { block: string }[])[0]!.block = 'not an id'))).toEqual(['layers.0.block']);
    expect(bad((j) => (j.extra = 1))).toEqual(['']);
  });

  it('生成的 manifest 合规；template.js 过静态检查（语法、import、确定性规则）', async () => {
    const d = doc();
    expect(animationManifest(d, REF)).toMatchObject({ id: REF.id, version: '1.0.0', category: 'overlay' });
    const files = animationTemplateFiles(d, REF);
    expect(parseManifest(JSON.parse(files['manifest.json'])).ok).toBe(true);
    expect(files['template.js'].startsWith(GENERATED_MARKER)).toBe(true);
    expect(await analyzeTemplateCode(files['template.js'])).toEqual([]);
    expect(parseAnimation(files['animation.json'])).toMatchObject({ ok: true });
  });

  it('文字内容里的引号、换行、</script> 不会改变生成代码的结构', async () => {
    const d = doc({ layers: [{ id: 't', name: 'T', type: 'text', text: '"; throw 1; //\n</script> ', size: 8, color: '#FFFFFF', shadow: true, align: 'center', props: {} }] });
    const code = animationTemplateCode(d);
    expect(await analyzeTemplateCode(code)).toEqual([]);
    const mod = await importTemplate(code);
    expect(typeof mod.setup).toBe('function');
  });

  it('工程文件：动画字段可选，旧工程照常解析；新工程带着文档往返', () => {
    const old = { formatVersion: 1, name: 'a', template: { id: 'allay.builtin.block-wipe', version: '1.0.0' } };
    expect(ProjectFileSchema.parse(old).animation).toBeUndefined();
    const d = doc();
    const data = ProjectDataSchema.parse({
      name: 'a',
      template: REF,
      params: {},
      output: { width: 1920, height: 1080, fps: 60 },
      export: { preset: 'prores4444', quality: 'standard', shutterAngle: 180, key: '#00FF00' },
      preview: { background: 'checker' },
      resourceHint: [],
      animation: d,
    });
    expect(ProjectFileSchema.parse({ ...old, template: REF, animation: data.animation }).animation).toEqual(d);
    expect(ProjectFileSchema.safeParse({ ...old, animation: { kind: 'allay-animation' } }).success).toBe(false);
  });
});

// ---- T-ANIM-2：在假的 ctx 里运行 ----

async function importTemplate(code: string): Promise<TemplateModule> {
  const mod = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as { default: TemplateModule };
  return mod.default;
}

interface Probe {
  matrices: Matrix4[];
  opacities: number[];
  visible: boolean[];
}

function fakeCtx(probe: Probe): SetupContext {
  const scene = new THREE.Scene();
  const stage = { width: 1920, height: 1080, aspect: 16 / 9, fps: 60, pixelScale: 1 };
  const easeFns: Record<string, (x: number) => number> = { linear: (x) => x, cubicOut: (x) => 1 - (1 - x) ** 3, backOut: (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2, quadIn: (x) => x * x };
  const block = {
    single: () => new THREE.Object3D(),
    instanced: (count: number) => {
      const object = new THREE.Object3D();
      const i = probe.matrices.length;
      probe.matrices.push(new THREE.Matrix4());
      probe.opacities.push(1);
      probe.visible.push(true);
      return {
        object,
        count,
        setMatrix: (_idx: number, m: Matrix4) => void probe.matrices[i]!.copy(m),
        setOpacity: (_idx: number, o: number) => void (probe.opacities[i] = o),
        setTint: () => undefined,
        commit: () => void (probe.visible[i] = object.visible),
      };
    },
    faceTexture: () => new THREE.Texture(),
  };
  const ctx = {
    THREE,
    params: {},
    stage,
    scene,
    camera: new THREE.OrthographicCamera(),
    setCamera: () => undefined,
    createStageCamera: () => new THREE.PerspectiveCamera(),
    resources: {
      texture: async () => new THREE.Texture(),
      block: async () => block,
      item: async () => ({ single: () => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()) }),
    },
    text: { create: () => ({ object: new THREE.Object3D(), width: 10, height: 10, setOpacity: () => undefined }) },
    sprite: { create: () => ({ object: new THREE.Object3D(), setSize: () => undefined, setOpacity: () => undefined }) },
    random: () => {
      throw new Error('not used');
    },
    noise2D: () => 0,
    ease: { ...easeFns, bezier: () => (x: number) => x, from: (v: unknown) => (typeof v === 'string' && easeFns[v]) || ((x: number) => x) },
    math: { clamp: (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)), lerp: (a: number, b: number, t: number) => a + (b - a) * t, invLerp: () => 0, remap: () => 0, smoothstep: () => 0 },
    time: { segment: () => 0 },
    audio: { cue: () => undefined },
    warn: () => undefined,
  };
  return ctx as unknown as SetupContext;
}

async function run(d: AnimationDoc): Promise<{ inst: TemplateInstance; probe: Probe }> {
  const probe: Probe = { matrices: [], opacities: [], visible: [] };
  const mod = await importTemplate(animationTemplateCode(d));
  const inst = await mod.setup(fakeCtx(probe));
  return { inst, probe };
}

const pos = (m: Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);

describe('T-ANIM-2 生成的模板在 Worker 契约下运行', () => {
  it('时长、剪辑点取自文档', async () => {
    const { inst } = await run(doc({ duration: 3, category: 'transition', cutTime: 1.5 }));
    expect(inst.duration).toBe(3);
    expect(inst.cutTime).toBe(1.5);
  });

  it('关键帧之间按缓动插值，之前取第一个值、之后取最后一个值；hold 保持到下一个关键帧', async () => {
    const d = doc({
      layers: [
        {
          id: 'b',
          name: 'B',
          type: 'block',
          block: 'minecraft:stone',
          size: 100,
          props: {
            x: { keys: [{ t: 0.5, v: 0 }, { t: 1.5, v: 100 }] },
            y: { keys: [{ t: 0, v: 10, ease: 'hold' }, { t: 1, v: 20 }] },
            opacity: { keys: [{ t: 0, v: 0, ease: 'quadIn' }, { t: 1, v: 1 }] },
          },
        },
      ],
    });
    const { inst, probe } = await run(d);
    inst.update(0);
    expect(pos(probe.matrices[0]!).x).toBeCloseTo(0);
    expect(probe.visible[0]).toBe(false); // 不透明度为 0 时不画
    inst.update(1);
    expect(pos(probe.matrices[0]!).x).toBeCloseTo(50);
    expect(pos(probe.matrices[0]!).y).toBeCloseTo(20);
    inst.update(0.5);
    expect(pos(probe.matrices[0]!).y).toBeCloseTo(10);
    expect(probe.opacities[0]).toBeCloseTo(0.25);
    inst.update(2);
    expect(pos(probe.matrices[0]!).x).toBeCloseTo(100);
    // 方块边长 = size × scale
    expect(new THREE.Vector3().setFromMatrixScale(probe.matrices[0]!).x).toBeCloseTo(100);
  });

  it('画面只取决于 t：乱序取帧与顺序取帧结果相同', async () => {
    const d = doc();
    const times = [0, 0.3, 0.61, 1.2, 1.9];
    const seq = await run(d);
    const forward = times.map((t) => {
      seq.inst.update(t);
      return seq.probe.matrices[0]!.toArray().concat(seq.probe.opacities[0]!);
    });
    const shuffled = await run(d);
    for (const i of [3, 0, 4, 1, 2, 3, 0]) {
      shuffled.inst.update(times[i]!);
      expect(shuffled.probe.matrices[0]!.toArray().concat(shuffled.probe.opacities[0]!)).toEqual(forward[i]);
    }
  });

  it('图层的可见区间 [from, to)', async () => {
    const d = doc({ layers: [{ id: 'r', name: 'R', type: 'block', block: 'minecraft:stone', size: 10, from: 0.5, to: 1, props: {} }] });
    const { inst, probe } = await run(d);
    inst.update(0.2);
    expect(probe.visible[0]).toBe(false);
    inst.update(0.7);
    expect(probe.visible[0]).toBe(true);
    inst.update(1);
    expect(probe.visible[0]).toBe(false);
  });

  it('四种图层都能建出来，dispose 不抛错', async () => {
    const d = doc({
      camera: { type: 'perspective', fov: 30 },
      layers: [
        { id: 'a', name: 'A', type: 'block', block: 'minecraft:stone', size: 10, props: {} },
        { id: 'b', name: 'B', type: 'item', item: 'minecraft:diamond', size: 10, props: { opacity: 0.5 } },
        { id: 'c', name: 'C', type: 'text', text: 'Hi', size: 8, color: '#FFFFFF', shadow: true, align: 'center', props: {} },
        { id: 'd', name: 'D', type: 'rect', width: 10, height: 10, color: '#3CB7F4', props: { rotZ: 45 } },
      ],
    });
    const { inst } = await run(d);
    inst.update(0.5);
    expect(() => inst.dispose?.()).not.toThrow();
  });
});
