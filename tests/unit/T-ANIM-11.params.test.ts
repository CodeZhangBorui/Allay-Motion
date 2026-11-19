// 第三轮（docs/animation-editor.md 第 10 节）：
// T-ANIM-11 格式第 2 版：第 1 版的文档迁移、绑定的校验、编辑器里的求值与 Worker 里的求值一致（resolve.ts ↔ runtime.template.js）；
// T-ANIM-12 暴露为参数：新建、绑定、解除、删参数，生成的 manifest 带参数，转成模板后改参数画面跟着变；
// T-ANIM-13 音效轨：id、改动、速率与空间位置进 ctx.audio.cue。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest, type SetupContext, type TemplateModule } from '../../packages/template-sdk/src/index';
import { animationManifestJson, animationTemplateCode } from '../../apps/desktop/src/shared/animation/compile';
import { bindTo, exposeAsParam, nextSoundId, paramUsage, readTarget, removeParam, unbind, updateParam, updateSound } from '../../apps/desktop/src/shared/animation/params';
import { docDuration, resolveDoc } from '../../apps/desktop/src/shared/animation/resolve';
import { AnimationDocSchema, ANIMATION_FORMAT_VERSION, newAnimationDoc, parseAnimation, serializeAnimation, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import runtimeSource from '../../apps/desktop/src/shared/animation/runtime.template.js?raw';
import { analyzeTemplateCode } from '../../apps/desktop/src/shared/template-code';

const THREE = (await import(pathToFileURL(createRequire(new URL('../../packages/engine/package.json', import.meta.url)).resolve('three')).href)) as SetupContext['THREE'];

const V1 = {
  kind: 'allay-animation',
  formatVersion: 1,
  name: 'Old',
  duration: 2,
  layers: [{ id: 'b', name: 'B', type: 'block', block: 'minecraft:stone', props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }] } } }],
  sounds: [{ at: 0.5, sound: 'minecraft:block.stone.place' }, { at: 1, sound: 'minecraft:block.stone.break', gain: 0.5 }],
};

function withParams(): AnimationDoc {
  return AnimationDocSchema.parse({
    ...newAnimationDoc('P', 'Block'),
    duration: { $param: 'length' },
    params: [
      { key: 'length', label: '时长', type: 'duration', default: 2, min: 0.5, max: 8 },
      { key: 'mainBlock', label: { 'zh-CN': '方块', en: 'Block' }, type: 'block', default: 'minecraft:diamond_block' },
      { key: 'lift', label: 'Lift', type: 'number', default: 100, min: 0, max: 500 },
    ],
    layers: [
      { id: 'b', name: 'B', type: 'block', block: { $param: 'mainBlock' }, size: 100, from: 0.5, props: { y: { keys: [{ t: 0, v: 0, ease: 'cubicOut' }, { t: 1, v: { $param: 'lift' } }] } } },
    ],
    sounds: [{ id: 's1', at: 1, sound: 'minecraft:block.stone.place', gain: 0.8, rate: 1.2, position: { x: 2, y: 0, z: -4 } }],
  });
}

/** Worker 里的那份解析：把 runtime.template.js 的 resolveAnimation 拿出来跑 */
function runtimeResolve(doc: unknown, values: Record<string, unknown>): unknown {
  const fn = new Function(`${runtimeSource}\nreturn resolveAnimation;`)() as (d: unknown, v: Record<string, unknown>) => unknown;
  return fn(structuredClone(doc), values);
}

describe('T-ANIM-11 格式第 2 版', () => {
  it('第 1 版的文档原样读入：版本号变 2，音效按序号补上 id，其余不变', () => {
    const r = parseAnimation(JSON.stringify(V1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.formatVersion).toBe(ANIMATION_FORMAT_VERSION);
    expect(r.doc.sounds.map((s) => s.id)).toEqual(['sound-1', 'sound-2']);
    expect(r.doc.layers[0]).toMatchObject({ block: 'minecraft:stone', props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }] } } });
    expect(r.doc.params).toEqual([]);
    // 再序列化、再读一遍是同一份（第 2 版的往返）
    const again = parseAnimation(serializeAnimation(r.doc));
    expect(again.ok && again.doc).toEqual(r.doc);
  });

  it('更高的版本拒绝', () => {
    expect(parseAnimation(JSON.stringify({ ...V1, formatVersion: 3 })).ok).toBe(false);
  });

  it('绑定必须指向存在、类型对得上的参数；参数键不重复；默认值在范围内', () => {
    const base = withParams();
    const bad = (mut: (d: Record<string, unknown>) => void) => {
      const j = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mut(j);
      const r = AnimationDocSchema.safeParse(j);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(bad((j) => ((j.layers as { block: unknown }[])[0]!.block = { $param: 'nope' }))).toEqual(['unknown param "nope"']);
    expect(bad((j) => ((j.layers as { block: unknown }[])[0]!.block = { $param: 'lift' }))[0]).toMatch(/is a number param/);
    expect(bad((j) => (j.params = [...(j.params as unknown[]), (j.params as unknown[])[0]]))).toContain('duplicate param key "length"');
    expect(bad((j) => ((j.params as { default: number }[])[2]!.default = 900))).toEqual(['default must be within [min, max]']);
  });

  it('编辑器里的求值和 Worker 里的求值结果相同（默认值、改过的值、时长伸缩）', () => {
    const doc = withParams();
    for (const values of [{}, { length: 4, mainBlock: 'minecraft:gold_block', lift: 250 }, { lift: 9999 }]) {
      const ts = resolveDoc(doc, values);
      const js = runtimeResolve(doc, values) as Record<string, unknown>;
      const { params: _p, ...tsNoParams } = ts;
      expect(js).toEqual(JSON.parse(JSON.stringify(tsNoParams)));
    }
    const long = resolveDoc(doc, { length: 4 });
    expect(long.duration).toBe(4);
    // 时刻按 4 ÷ 2 伸缩
    expect(long.layers[0]!.from).toBe(1);
    expect(long.sounds[0]!.at).toBe(2);
    expect(long.layers[0]!.props.y).toMatchObject({ keys: [{ t: 0 }, { t: 2, v: 100 }] });
    // 超出范围的取值钳到范围内
    expect(resolveDoc(doc, { lift: 9999 }).layers[0]!.props.y).toMatchObject({ keys: [{}, { v: 500 }] });
    expect(docDuration(doc)).toBe(2);
  });
});

describe('T-ANIM-12 暴露为参数', () => {
  it('从当前值新建参数并绑定；绑定到已有参数要类型对；解除绑定写回默认值；删参数时所有绑定写回默认值', () => {
    let doc = AnimationDocSchema.parse(newAnimationDoc('E', 'Block'));
    const exposed = exposeAsParam(doc, { kind: 'field', layer: 'block-1', field: 'block' }, '方块', 'block');
    expect(exposed).not.toBeNull();
    doc = AnimationDocSchema.parse(exposed!.doc);
    expect(doc.params).toEqual([{ key: 'block', label: '方块', type: 'block', default: 'minecraft:grass_block' }]);
    expect(readTarget(doc, { kind: 'field', layer: 'block-1', field: 'block' })).toEqual({ $param: 'block' });
    // 常量属性 rotX = 20 暴露成数值参数
    const n = exposeAsParam(doc, { kind: 'prop', layer: 'block-1', prop: 'rotX' }, 'Tilt', 'tilt')!;
    doc = AnimationDocSchema.parse(n.doc);
    expect(doc.params[1]).toMatchObject({ key: 'tilt', type: 'number', default: 20 });
    expect(bindTo(doc, { kind: 'field', layer: 'block-1', field: 'block' }, 'tilt')).toBeNull();
    expect(paramUsage(doc, 'block')).toBe(1);
    const changed = AnimationDocSchema.parse(updateParam(doc, 'block', { default: 'minecraft:stone' })!);
    expect(resolveDoc(changed).layers[0]).toMatchObject({ block: 'minecraft:stone' });
    const un = AnimationDocSchema.parse(unbind(changed, { kind: 'field', layer: 'block-1', field: 'block' })!);
    expect(un.layers[0]).toMatchObject({ block: 'minecraft:stone' });
    const removed = AnimationDocSchema.parse(removeParam(doc, 'tilt'));
    expect(removed.params.map((p) => p.key)).toEqual(['block']);
    expect(removed.layers[0]!.props.rotX).toBe(20);
  });

  it('关键帧的值、文字的字体也能暴露；字体参数的默认值是现在的字体（没写时是游戏默认字体）', () => {
    let doc = AnimationDocSchema.parse({ ...newAnimationDoc('F', 'B'), layers: [{ id: 't', name: 'T', type: 'text', text: 'Hi', props: { y: { keys: [{ t: 0, v: 5 }, { t: 1, v: 9 }] } } }] });
    doc = AnimationDocSchema.parse(exposeAsParam(doc, { kind: 'field', layer: 't', field: 'font' }, 'Font', 'font')!.doc);
    expect(doc.params[0]).toMatchObject({ type: 'font', default: { family: 'minecraft:default' } });
    doc = AnimationDocSchema.parse(exposeAsParam(doc, { kind: 'key', layer: 't', prop: 'y', t: 1 }, 'End', 'endY')!.doc);
    expect(doc.layers[0]!.props.y).toEqual({ keys: [{ t: 0, v: 5 }, { t: 1, v: { $param: 'endY' } }] });
  });

  it('生成的 manifest 带上参数（时长画成时间轴的一段）和非默认字体的自动参数，合 schema；代码过静态检查', async () => {
    const doc = AnimationDocSchema.parse({
      ...withParams(),
      layers: [...withParams().layers, { id: 'tx', name: 'T', type: 'text', text: 'Hi', font: { family: 'minecraft:alt' }, props: {} }],
    });
    const raw = animationManifestJson(doc, { id: 'user.abc123.p', version: '1.0.0' });
    const parsed = parseManifest(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.params?.map((p) => `${p.key}:${p.type}`)).toEqual(['length:duration', 'mainBlock:block', 'lift:number', 'autoFont1:font']);
    expect(parsed.manifest.timeline).toEqual({ segments: [{ param: 'length' }] });
    expect(await analyzeTemplateCode(animationTemplateCode(doc))).toEqual([]);
  });
});

// ---- 在假的 ctx 里跑生成的代码 ----

async function run(doc: AnimationDoc, params: Record<string, unknown>) {
  const code = animationTemplateCode(doc);
  const mod = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as { default: TemplateModule };
  const blocks: string[] = [];
  const cues: { sound: string | null; at: number; opts: unknown }[] = [];
  const inst = { matrices: [] as InstanceType<SetupContext['THREE']['Matrix4']>[] };
  const ctx = {
    THREE,
    params,
    stage: { width: 1920, height: 1080, aspect: 16 / 9, fps: 60, pixelScale: 1 },
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(),
    setCamera: () => undefined,
    createStageCamera: () => new THREE.PerspectiveCamera(),
    resources: {
      texture: async () => new THREE.Texture(),
      block: async (id: string) => {
        blocks.push(id);
        return {
          single: () => new THREE.Object3D(),
          faceTexture: () => new THREE.Texture(),
          instanced: () => {
            const m = new THREE.Matrix4();
            inst.matrices.push(m);
            return { object: new THREE.Object3D(), count: 1, setMatrix: (_i: number, x: InstanceType<SetupContext['THREE']['Matrix4']>) => void m.copy(x), setOpacity: () => undefined, setTint: () => undefined, commit: () => undefined };
          },
        };
      },
      item: async () => ({ single: () => new THREE.Object3D() }),
    },
    text: { create: () => ({ object: new THREE.Object3D(), width: 1, height: 1, setOpacity: () => undefined }) },
    sprite: { create: () => ({ object: new THREE.Object3D(), setSize: () => undefined, setOpacity: () => undefined }) },
    random: () => ({ next: () => 0, range: () => 0, int: () => 0, pick: <T,>(a: readonly T[]) => a[0]!, shuffle: <T,>(a: T[]) => a }),
    noise2D: () => 0,
    ease: { from: () => (x: number) => x },
    math: {},
    time: { segment: () => 0 },
    audio: { cue: (sound: string | null, at: number, opts?: unknown) => void cues.push({ sound, at, opts }) },
    warn: () => undefined,
  } as unknown as SetupContext;
  const instance = await mod.default.setup(ctx);
  return { instance, blocks, cues, inst };
}

describe('T-ANIM-12 转成模板后改参数画面跟着变（Worker 契约下运行）', () => {
  it('方块、时长、关键帧的值都随参数变', async () => {
    const doc = withParams();
    const a = await run(doc, {});
    expect(a.blocks).toEqual(['minecraft:diamond_block']);
    expect(a.instance.duration).toBe(2);
    const b = await run(doc, { mainBlock: 'minecraft:gold_block', length: 4, lift: 300 });
    expect(b.blocks).toEqual(['minecraft:gold_block']);
    expect(b.instance.duration).toBe(4);
    b.instance.update(2);
    expect(new THREE.Vector3().setFromMatrixPosition(b.inst.matrices[0]!).y).toBeCloseTo(300);
  });
});

describe('T-ANIM-13 音效轨', () => {
  it('速率和空间位置进 ctx.audio.cue；时长伸缩时音效的时刻跟着变', async () => {
    const r = await run(withParams(), { length: 4 });
    expect(r.cues).toEqual([{ sound: 'minecraft:block.stone.place', at: 2, opts: { gain: 0.8, rate: 1.2, position: { x: 2, y: 0, z: -4 } } }]);
  });

  it('新 id 不重复；改音效按时刻重排；给 null 去掉速率和位置', () => {
    const doc = withParams();
    expect(nextSoundId(doc)).toBe('sound-1');
    const added = AnimationDocSchema.parse({ ...doc, sounds: [...doc.sounds, { id: 'sound-1', at: 0.2, sound: 'minecraft:ui.button.click' }] });
    const moved = AnimationDocSchema.parse(updateSound(added, 's1', { at: 0.1, rate: null, position: null })!);
    expect(moved.sounds.map((s) => s.id)).toEqual(['s1', 'sound-1']);
    expect(moved.sounds[0]).toEqual({ id: 's1', at: 0.1, sound: 'minecraft:block.stone.place', gain: 0.8 });
    expect(updateSound(doc, 'nope', { at: 1 })).toBeNull();
  });
});
