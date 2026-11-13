// T-TPL-1：manifest 的合法和非法夹具各 10 个以上。合法的通过；非法的给出指向具体字段的错误（docs/04-templates.md 4.3、4.11）。
// 另测格式版本：更高的拒绝（提示升级），更低的走迁移函数链。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, parseManifest, type Migrations } from '../../packages/template-sdk/src/index';

const ROOT = join(import.meta.dirname, '../..');

const base = {
  formatVersion: 1,
  id: 'user.k3f9.test',
  version: '1.0.0',
  name: 'Test',
  category: 'transition',
  params: [],
};

const num = (over: Record<string, unknown> = {}) => ({ key: 'size', type: 'number', label: 'Size', default: 1, min: 0, max: 2, ...over });
const dur = (key: string, over: Record<string, unknown> = {}) => ({ key, type: 'duration', label: key, default: 0.5, min: 0.1, max: 2, ...over });

const VALID: [string, unknown][] = [
  ['最小的脚本模板', base],
  ['多语言名称与描述', { ...base, name: { 'zh-CN': '测试', en: 'Test' }, description: { en: 'Only English' } }],
  ['15 种参数类型各一个', {
    ...base,
    params: [
      num(),
      { key: 'count', type: 'integer', label: 'n', default: 3, min: 1, max: 10, ui: 'slider' },
      { key: 'on', type: 'boolean', label: 'on', default: true },
      { key: 'mode', type: 'enum', label: 'm', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: { 'zh-CN': '乙', en: 'B' } }] },
      { key: 'tint', type: 'color', label: 'c', default: '#FF00FF80', alpha: true, palette: 'dye' },
      { key: 'title', type: 'text', label: 't', default: { 'zh-CN': '标题', en: 'Title' }, maxLength: 40, multiline: false },
      { key: 'block', type: 'block', label: 'b', default: 'minecraft:stone' },
      { key: 'blocks', type: 'blockList', label: 'bl', default: [{ id: 'minecraft:stone', weight: 1 }], max: 8 },
      { key: 'item', type: 'item', label: 'i', default: 'minecraft:diamond' },
      { key: 'image', type: 'texture', label: 'img', default: '', allowFile: true },
      { key: 'sound', type: 'sound', label: 's', default: null },
      { key: 'ease', type: 'easing', label: 'e', default: [0.2, -0.5, 0.8, 1.5] },
      dur('inDuration'),
      { key: 'angle', type: 'angle', label: 'a', default: 45, snap: 15 },
      { key: 'seed', type: 'seed', label: 'seed', default: 7 },
    ],
  }],
  ['分组与 visibleWhen', {
    ...base,
    groups: [{ key: 'look', label: 'Look', collapsed: true }],
    params: [
      { key: 'fill', type: 'enum', label: 'f', default: 'color', options: [{ value: 'color', label: 'C' }, { value: 'block', label: 'B' }], group: 'look' },
      { key: 'fillColor', type: 'color', label: 'fc', default: '#2072D5', visibleWhen: { key: 'fill', equals: 'color' } },
      { key: 'fillBlock', type: 'block', label: 'fb', default: 'minecraft:lapis_block', visibleWhen: { key: 'fill', in: ['block'] } },
    ],
  }],
  ['时间段', { ...base, params: [dur('inDuration'), dur('hold', { default: 0, min: 0 }), dur('outDuration')], timeline: { segments: [{ param: 'inDuration' }, { param: 'hold', label: 'Hold' }, { param: 'outDuration' }] } }],
  ['派生模板', { formatVersion: 1, id: 'user.k3f9.blue-wipe', version: '1.0.0', name: '蓝钻擦除', category: 'transition', extends: { id: 'allay.builtin.block-wipe', version: '^1.0.0' }, overrides: { defaults: { cols: 16 }, hidden: ['placeSound'] } }],
  ['默认输出与最低应用版本', { ...base, defaultOutput: { width: 1080, height: 1920, fps: 30 }, minAppVersion: '0.1.0' }],
  ['预发布版本号', { ...base, version: '2.0.0-beta.1' }],
  ['未知字段保留但忽略', { ...base, futureField: { anything: true }, params: [num({ futureParamField: 1 })] }],
  ['叠加层与标签', { ...base, category: 'overlay', tags: ['toast', 'ui'], author: 'someone', license: 'MIT' }],
  ['内置 T1 的 manifest', JSON.parse(readFileSync(join(ROOT, 'packages/templates/block-wipe/manifest.json'), 'utf8'))],
];

/** [说明, manifest, 期望的错误路径] */
const INVALID: [string, unknown, string][] = [
  ['不是对象', 'manifest', '(root)'],
  ['缺 formatVersion', { ...base, formatVersion: undefined }, 'formatVersion'],
  ['id 有大写', { ...base, id: 'User.Test' }, 'id'],
  ['id 不是反向域名', { ...base, id: 'test' }, 'id'],
  ['version 不是 semver', { ...base, version: '1.0' }, 'version'],
  ['category 不认识', { ...base, category: 'intro' }, 'category'],
  ['name 缺失', { ...base, name: undefined }, 'name'],
  ['参数 key 不合格式', { ...base, params: [num({ key: 'Size' })] }, 'params.0.key'],
  ['参数 key 重复', { ...base, params: [num(), num()] }, 'params.1.key'],
  ['参数类型不认识', { ...base, params: [{ key: 'x', type: 'vector', label: 'x', default: 1 }] }, 'params.0.type'],
  ['number 默认值越界', { ...base, params: [num({ default: 5 })] }, 'params.0.default'],
  ['number 缺 max', { ...base, params: [num({ max: undefined })] }, 'params.0.max'],
  ['enum 默认值不在选项里', { ...base, params: [{ key: 'm', type: 'enum', label: 'm', default: 'z', options: [{ value: 'a', label: 'A' }] }] }, 'params.0.default'],
  ['color 格式不对', { ...base, params: [{ key: 'c', type: 'color', label: 'c', default: 'red' }] }, 'params.0.default'],
  ['color 带 alpha 却没开 alpha', { ...base, params: [{ key: 'c', type: 'color', label: 'c', default: '#FFFFFF80' }] }, 'params.0.default'],
  ['text 默认值超长', { ...base, params: [{ key: 't', type: 'text', label: 't', default: 'abcdef', maxLength: 3 }] }, 'params.0.default'],
  ['block 不是资源 ID', { ...base, params: [{ key: 'b', type: 'block', label: 'b', default: 'stone block' }] }, 'params.0.default'],
  ['texture 默认值是 file:', { ...base, params: [{ key: 'i', type: 'texture', label: 'i', default: 'file:C:/x.png' }] }, 'params.0.default'],
  ['未知的分组', { ...base, params: [num({ group: 'nope' })] }, 'params.0.group'],
  ['visibleWhen 指向不存在的参数', { ...base, params: [num({ visibleWhen: { key: 'nope', equals: 1 } })] }, 'params.0.visibleWhen.key'],
  ['时间段指向非 duration 参数', { ...base, params: [num()], timeline: { segments: [{ param: 'size' }] } }, 'timeline.segments.0.param'],
  ['脚本模板缺 params', { ...base, params: undefined }, 'params'],
  ['脚本模板带 overrides', { ...base, overrides: { hidden: [] } }, 'overrides'],
  ['派生模板声明 params', { ...base, extends: { id: 'allay.builtin.block-wipe', version: '^1.0.0' } }, 'params'],
  ['extends.version 不是版本范围', { formatVersion: 1, id: 'user.x.y', version: '1.0.0', name: 'x', category: 'transition', extends: { id: 'allay.builtin.block-wipe', version: 'latest' } }, 'extends.version'],
  ['defaultOutput 帧率越界', { ...base, defaultOutput: { width: 1920, height: 1080, fps: 1000 } }, 'defaultOutput.fps'],
];

describe('T-TPL-1 manifest 校验', () => {
  it(`合法的夹具全部通过（${VALID.length} 个）`, () => {
    expect(VALID.length).toBeGreaterThanOrEqual(10);
    for (const [name, m] of VALID) {
      const r = parseManifest(m);
      expect(r.ok ? 'ok' : JSON.stringify(r.issues), name).toBe('ok');
    }
  });

  it(`非法的夹具全部被拒绝，错误指向具体字段（${INVALID.length} 个）`, () => {
    expect(INVALID.length).toBeGreaterThanOrEqual(10);
    for (const [name, m, path] of INVALID) {
      const r = parseManifest(m);
      expect(r.ok, name).toBe(false);
      if (r.ok) continue;
      expect(r.code, name).toBe('manifest-invalid');
      expect(r.issues.map((i) => i.path), name).toContain(path);
    }
  });

  it('未知字段保留在结果里', () => {
    const r = parseManifest({ ...base, futureField: 42 });
    expect(r.ok && (r.manifest as Record<string, unknown>).futureField).toBe(42);
  });

  it('更高的 formatVersion 拒绝并提示升级应用', () => {
    const r = parseManifest({ ...base, formatVersion: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('format-too-new');
      expect(r.issues[0]!.path).toBe('formatVersion');
    }
  });

  it('更低的 formatVersion 走迁移函数链（用假的迁移表测框架）', () => {
    // 假设当前是第 3 版：v1 叫 title，v2 改名为 name，v3 把 kind 改名为 category
    const fake: Migrations = {
      current: 3,
      steps: {
        1: ({ title, ...rest }) => ({ ...rest, name: title }),
        2: ({ kind, ...rest }) => ({ ...rest, category: kind }),
      },
    };
    const r = migrate({ formatVersion: 1, title: 'Old', kind: 'overlay' }, fake);
    expect(r).toEqual({ ok: true, doc: { formatVersion: 3, name: 'Old', category: 'overlay' }, migratedFrom: 1 });
    expect(migrate({ formatVersion: 3, name: 'x' }, fake)).toMatchObject({ ok: true, migratedFrom: null });
    expect(migrate({ formatVersion: 4 }, fake)).toMatchObject({ ok: false, error: 'format-too-new' });
    expect(migrate({ formatVersion: 2 }, { current: 3, steps: {} })).toMatchObject({ ok: false, error: 'no-migration', version: 2 });
    // 迁移后再做 schema 校验：parseManifest 接受迁移表参数
    const toV1: Migrations = { current: 1, steps: {} };
    expect(parseManifest({ ...base, formatVersion: 0 }, toV1).ok).toBe(false);
  });
});
