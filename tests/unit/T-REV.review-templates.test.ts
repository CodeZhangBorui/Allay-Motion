// T-REV：评审截图工具（scripts/review-templates.ts）里不依赖 Electron 的部分：参数解析、时刻选取、构建是否最新、
// 版本目录的识别和镜像、写给应用的设置、缩放与合成、联络图的版式、报告的合并和 index.html。
// 不读本机的游戏文件：要游戏目录的测试在临时目录里拼一个假的（空 jar、几行版本 JSON），只是测试数据。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseUnifontOtf, vanillaLayerId, VersionIdSchema } from '../../packages/assets/src/index';
import type { TemplateManifest } from '../../packages/template-sdk/src/index';
import { EMBEDDED_UNIFONT_FILE } from '../../apps/desktop/src/main/resources/fonts';
import { migrateSettingsFile } from '../../apps/desktop/src/shared/settings';
import {
  alphaStats,
  blank,
  checkVersion,
  CHECKER,
  compareBuild,
  composeSheet,
  contactScale,
  crop,
  detailScale,
  edgeOffset,
  fitText,
  mergeReport,
  mirrorVersionId,
  outLabel,
  over,
  padBBox,
  paramSetsOf,
  parseArgs,
  pickShots,
  removeMirror,
  renderIndex,
  resizeArea,
  scaleNearest,
  seedSettings,
  SHEET,
  sheetLayout,
  sourceKey,
  summarize,
  unifontRenderer,
  unionBBox,
  UsageError,
  type ReportFile,
  type ReportTemplate,
  type RunRecord,
} from '../../scripts/review-templates';

const ROOT = resolve(import.meta.dirname, '../..');

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    aspect: '16:9',
    paramSet: { key: 'default', name: '默认参数' },
    params: {},
    output: { width: 1920, height: 1080, fps: 60 },
    preview: { status: 'ready', warnings: [] },
    duration: 4.5,
    cutTime: null,
    shots: [],
    warnings: [],
    missingTextures: [],
    foundTextures: [],
    fonts: [],
    sounds: [],
    engineLog: [],
    console: [],
    error: null,
    ...over,
  };
}

function tpl(name: string, capturedAt: string, runs: RunRecord[] = []): ReportTemplate {
  return { name, id: `allay.builtin.${name}`, version: '1.0.0', title: name, capturedAt, runs, sheets: [] };
}

function report(templates: ReportTemplate[], key = 'local:G:\\mc|26.2'): ReportFile {
  return {
    tool: 'review:templates',
    formatVersion: 1,
    sourceKey: key,
    label: '26.2',
    lang: 'zh-CN',
    source: { kind: 'none' },
    build: { commit: null, dirty: null, appBuiltAt: null },
    layers: [],
    updatedAt: '2026-11-22T00:00:00.000Z',
    templates,
  };
}

describe('T-REV 评审截图工具', () => {
  test('T-REV-1 参数：来源二选一，默认只截 16:9、中文、默认参数和默认时刻；写法不对的给出用法错误', () => {
    const o = parseArgs(['--game', 'G:/mc', '--version', '26.2', 'boss-bar', 'hud-status', 'boss-bar']);
    expect(o.source).toEqual({ kind: 'local', gameDir: resolve('G:/mc'), versionDir: '26.2' });
    expect(o.templates).toEqual(['boss-bar', 'hud-status']);
    expect([o.aspects, o.lang, o.presets, o.shots, o.out, o.mirror, o.help]).toEqual([['16:9'], 'zh-CN', false, null, null, false, false]);

    // pnpm 会把 -- 原样传进来；= 写法；版本目录名可以带空格
    const p = parseArgs(['--', '--game=G:/mc', '--version=1.20.1-Fabric 0.19.3', '--mirror', '--presets', '--aspect', 'all', '--lang', 'en', '--at', '10%,cut,1.5s,f3,2', '--out', 'x']);
    expect(p.source).toEqual({ kind: 'local', gameDir: resolve('G:/mc'), versionDir: '1.20.1-Fabric 0.19.3' });
    expect([p.aspects, p.lang, p.mirror, p.presets, p.out]).toEqual([['16:9', '9:16', '1:1'], 'en', true, true, resolve('x')]);
    expect(p.shots).toEqual([{ kind: 'fraction', value: 0.1 }, { kind: 'cut' }, { kind: 'seconds', value: 1.5 }, { kind: 'frame', value: 3 }, { kind: 'seconds', value: 2 }]);
    expect(parseArgs(['--no-assets', '--aspect', '9x16,1:1,9:16']).aspects).toEqual(['9:16', '1:1']);
    expect(parseArgs(['--no-assets']).source).toEqual({ kind: 'none' });
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).source).toBeNull();

    const bad = [
      [],
      ['--game', 'G:/mc'],
      ['--version', '26.2'],
      ['--no-assets', '--game', 'G:/mc'],
      ['--no-assets', '--mirror'],
      ['--no-assets', '--bogus'],
      ['--no-assets', '--lang', 'fr'],
      ['--no-assets', '--aspect', '4:3'],
      ['--no-assets', '--aspect', 'toString'],
      ['--no-assets', '--at', 'later'],
      ['--no-assets', '--at', '150%'],
      ['--no-assets', '--at', ','],
      ['--no-assets', '--out'],
      ['--no-assets', '--out', '--presets'],
      ['--no-assets', '--presets=yes'],
      ['--no-assets', '--lang', 'en', '--lang', 'zh-CN'],
    ];
    for (const argv of bad) expect(() => parseArgs(argv), JSON.stringify(argv)).toThrow(UsageError);
  });

  test('T-REV-2 默认时刻：首末帧附近和时长的 20%–80%，按帧取整；有剪辑点时加上剪辑点', () => {
    // 叠加层 4.5 秒、60 fps：首帧附近是 max(2 帧, 4.5 × 3% = 0.135 秒) → 第 8 帧，末帧附近 4.365 秒 → 第 262 帧
    const overlay = pickShots(null, 4.5, 60, null);
    expect(overlay.map((s) => s.slot)).toEqual(['first', '20%', '40%', '60%', '80%', 'last']);
    expect(overlay.map((s) => s.slotId)).toEqual(['first', 'p20', 'p40', 'p60', 'p80', 'last']);
    expect(overlay.map((s) => s.index)).toEqual([8, 54, 108, 162, 216, 262]);
    for (const s of overlay) expect(s.t).toBeCloseTo(s.index / 60, 9);
    // 转场 1.5 秒、剪辑点 0.75 秒：剪辑点按时间排进去
    const transition = pickShots(null, 1.5, 60, 0.75);
    expect(transition.map((s) => `${s.slot}@${s.index}`)).toEqual(['first@3', '20%@18', '40%@36', 'cut@45', '60%@54', '80%@72', 'last@87']);
    expect(edgeOffset(0.5, 30)).toBeCloseTo(2 / 30, 9);
    expect(edgeOffset(10, 60)).toBeCloseTo(0.3, 9);
  });

  test('T-REV-3 指定的时刻：落在同一帧的只截一次，超出范围的钳到首末帧，没有剪辑点时跳过 cut', () => {
    const shots = pickShots(
      [{ kind: 'seconds', value: 1 }, { kind: 'fraction', value: 0.5 }, { kind: 'frame', value: 60 }, { kind: 'seconds', value: 99 }, { kind: 'cut' }, { kind: 'frame', value: 0 }, { kind: 'frame', value: 500 }],
      2,
      60,
      null,
    );
    expect(shots).toEqual([
      { slot: 'f0', slotId: 'f0', index: 0, t: 0 },
      { slot: '1s+50%+f60', slotId: 's1+p50+f60', index: 60, t: 1 },
      { slot: '99s+f500', slotId: 's99+f500', index: 120, t: 2 },
    ]);
  });

  test('T-REV-4 构建是否最新：缺任何一个产物是没构建；最旧的产物比最新的源码旧是过期', () => {
    const src = { path: 'src/a.ts', mtimeMs: 200 };
    expect(compareBuild([{ path: 'out/a', mtimeMs: 300 }, { path: 'out/b', mtimeMs: null }], src)).toEqual({ state: 'missing', output: 'out/b' });
    expect(compareBuild([{ path: 'out/a', mtimeMs: 300 }, { path: 'out/b', mtimeMs: 150 }], src)).toEqual({ state: 'stale', output: { path: 'out/b', mtimeMs: 150 }, source: src });
    expect(compareBuild([{ path: 'out/a', mtimeMs: 300 }], src)).toEqual({ state: 'fresh' });
    expect(compareBuild([{ path: 'out/a', mtimeMs: 200 }], src)).toEqual({ state: 'fresh' });
    expect(compareBuild([{ path: 'out/a', mtimeMs: 300 }], null)).toEqual({ state: 'fresh' });
  });

  test('T-REV-5 写给应用的设置文件过得了应用自己的 schema：资源栈里只有给定的本机来源，或者什么都没有', () => {
    const s = migrateSettingsFile(seedSettings({ gameDir: 'G:\\mc', versionId: '26.2' }, 'zh-CN'));
    expect(s).not.toBeNull();
    expect([s!.ui.language, s!.ui.onboardingCompleted, s!.ui.tourCompleted, s!.ui.updates.mode]).toEqual(['zh-CN', true, true, 'off']);
    const source = { kind: 'local', gameDir: 'G:\\mc', versionId: '26.2' } as const;
    expect(s!.resources).toEqual({ vanilla: { consent: true, enabled: true, dir: 'G:\\mc' }, vanillaSources: [{ id: vanillaLayerId(source), source, enabled: true }], packs: [] });
    const none = migrateSettingsFile(seedSettings(null, 'en'));
    expect(none!.ui.language).toBe('en');
    expect(none!.resources).toEqual({ vanilla: { consent: false, enabled: true, dir: null }, vanillaSources: [], packs: [] });
    // 带空格的版本号过不了设置的 schema，整个资源栈设置会静默退回默认值：所以这种目录要经 --mirror 接入
    const spaced = migrateSettingsFile(seedSettings({ gameDir: 'G:\\mc', versionId: '1.20.1-Fabric 0.19.3' }, 'zh-CN'));
    expect(spaced!.resources.vanillaSources).toEqual([]);
    expect(spaced!.resources.vanilla.consent).toBeNull();
  });

  test('T-REV-6 版本目录：用应用自己的识别核对，认不了时说清是哪一步（带空格的名字、没有 jar、没有这个目录）', async () => {
    const game = mkdtempSync(join(tmpdir(), 'allay-trev-game-'));
    try {
      const version = (name: string, jar: boolean, json: unknown) => {
        mkdirSync(join(game, 'versions', name), { recursive: true });
        if (jar) writeFileSync(join(game, 'versions', name, `${name}.jar`), '');
        if (json !== null) writeFileSync(join(game, 'versions', name, `${name}.json`), JSON.stringify(json));
      };
      const release = { type: 'release', releaseTime: '2026-06-16T20:03:33+08:00', assetIndex: { id: '32' } };
      version('26.2', true, release);
      version('1.20.1-Fabric 0.19.3', true, { ...release, clientVersion: '1.20.1' });
      version('1.20.1-Forge_47.4.0', false, release);
      version('broken', true, { type: 'release' });
      expect(await checkVersion(game, '26.2')).toEqual({ ok: true });
      const spaced = await checkVersion(game, '1.20.1-Fabric 0.19.3');
      expect(spaced).toMatchObject({ ok: false, nameRejected: true });
      expect(spaced.ok ? '' : spaced.reason).toContain('空格');
      expect(await checkVersion(game, '1.20.1-Forge_47.4.0')).toMatchObject({ ok: false, nameRejected: false, reason: expect.stringContaining('jar') });
      expect(await checkVersion(game, 'broken')).toMatchObject({ ok: false, nameRejected: false, reason: expect.stringContaining('releaseTime') });
      expect(await checkVersion(game, '9.9')).toMatchObject({ ok: false, reason: expect.stringContaining('26.2') });
      expect(await checkVersion(join(game, 'versions'), '26.2')).toMatchObject({ ok: false, reason: expect.stringContaining('versions') });
    } finally {
      rmSync(game, { recursive: true, force: true });
    }
    expect(VersionIdSchema.safeParse('1.20.1-Fabric 0.19.3').success).toBe(false);
    expect(mirrorVersionId({ clientVersion: '1.20.1' }, '1.20.1-Fabric 0.19.3')).toBe('1.20.1');
    expect(mirrorVersionId({}, '1.20.1-Fabric 0.19.3')).toBe('1.20.1-Fabric_0.19.3');
    expect(mirrorVersionId({ clientVersion: 'a b' }, '1.21.8-Fabric_0.17.3(生电)')).toBe('1.21.8-Fabric_0.17.3____');
    expect(outLabel({ kind: 'local', gameDir: 'G:\\mc', versionDir: '1.20.1-Fabric 0.19.3' }, 'zh-CN')).toBe('1.20.1-Fabric_0.19.3');
    expect(outLabel({ kind: 'none' }, 'en')).toBe('no-assets-en');
    expect(sourceKey({ kind: 'local', gameDir: 'G:\\mc', versionDir: '26.2' })).not.toBe(sourceKey({ kind: 'local', gameDir: 'H:\\mc', versionDir: '26.2' }));
  });

  test('T-REV-7 删镜像目录：只解开 assets 联接、不碰它指向的目录；碰到预料之外的链接就停下', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'allay-trev-mirror-'));
    const stray = join(tmp, 'm2', 'versions', 'stray');
    try {
      mkdirSync(join(tmp, 'target', 'sub'), { recursive: true });
      writeFileSync(join(tmp, 'target', 'sub', 'keep.txt'), 'keep');
      const m = join(tmp, 'm');
      mkdirSync(join(m, 'versions', 'x'), { recursive: true });
      writeFileSync(join(m, 'versions', 'x', 'x.json'), '{}');
      symlinkSync(join(tmp, 'target'), join(m, 'assets'), 'junction');
      removeMirror(m);
      expect(existsSync(m)).toBe(false);
      expect(readFileSync(join(tmp, 'target', 'sub', 'keep.txt'), 'utf8')).toBe('keep');

      mkdirSync(join(tmp, 'm2', 'versions'), { recursive: true });
      symlinkSync(join(tmp, 'target'), stray, 'junction');
      expect(() => removeMirror(join(tmp, 'm2'))).toThrow(/链接/);
      expect(existsSync(join(tmp, 'm2'))).toBe(true);
      expect(readFileSync(join(tmp, 'target', 'sub', 'keep.txt'), 'utf8')).toBe('keep');
      removeMirror(join(tmp, 'nope'));
    } finally {
      try {
        unlinkSync(stray);
      } catch {
        // 没建成
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('T-REV-8 缩放与合成：面积平均在预乘 alpha 下做（透明像素不把颜色拉黑），整数倍放大用最近邻，叠加按直通 alpha', () => {
    const corner = { width: 2, height: 2, data: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
    expect([...resizeArea(corner, 1, 1).data]).toEqual([255, 0, 0, 64]);
    // 3 → 2：每格覆盖 1.5 个源像素
    const stripes = { width: 3, height: 1, data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]) };
    expect([...resizeArea(stripes, 2, 1).data]).toEqual([85, 85, 85, 255, 85, 85, 85, 255]);
    const big = scaleNearest({ width: 1, height: 2, data: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]) }, 2);
    expect([big.width, big.height]).toEqual([2, 4]);
    expect([...big.data.subarray(0, 8)]).toEqual([1, 2, 3, 255, 1, 2, 3, 255]);
    expect([...big.data.subarray(16, 24)]).toEqual([4, 5, 6, 128, 4, 5, 6, 128]);
    const dst = blank(3, 1, [100, 100, 100]);
    over(dst, { width: 2, height: 1, data: new Uint8Array([200, 0, 0, 255, 0, 0, 200, 128]) }, 1, 0);
    expect([...dst.data]).toEqual([100, 100, 100, 255, 200, 0, 0, 255, 50, 50, 150, 255]);
  });

  test('T-REV-9 不透明部分的外框：合并、留边、裁切；联络图一格和细节图的缩放', () => {
    const img = { width: 4, height: 3, data: new Uint8Array(4 * 3 * 4) };
    img.data[(1 * 4 + 2) * 4 + 3] = 10;
    img.data[(2 * 4 + 3) * 4 + 3] = 255;
    expect(alphaStats(img)).toEqual({ bbox: { x: 2, y: 1, width: 2, height: 2 }, coverage: 2 / 12, maxAlpha: 255 });
    expect(alphaStats({ width: 2, height: 2, data: new Uint8Array(16) })).toEqual({ bbox: null, coverage: 0, maxAlpha: 0 });
    expect(unionBBox([null, { x: 2, y: 1, width: 2, height: 2 }, { x: 0, y: 2, width: 1, height: 1 }])).toEqual({ x: 0, y: 1, width: 4, height: 2 });
    expect(unionBBox([null, null])).toBeNull();
    expect(padBBox({ x: 2, y: 1, width: 2, height: 2 }, 8, 4, 3)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(padBBox({ x: 100, y: 50, width: 20, height: 10 }, 8, 1920, 1080)).toEqual({ x: 92, y: 42, width: 36, height: 26 });
    const c = crop(img, { x: 2, y: 1, width: 2, height: 2 });
    expect([c.width, c.height, c.data[3], c.data[15]]).toEqual([2, 2, 10, 255]);
    expect([contactScale(1920, 1080), contactScale(1080, 1920)]).toEqual([0.25, 0.25]);
    expect(contactScale(1080, 1080)).toBeCloseTo(480 / 1080, 9);
    expect([detailScale(300, 100), detailScale(400, 200), detailScale(910, 120), detailScale(1920, 400)]).toEqual([3, 2, 1, 0.5]);
    expect(detailScale(1200, 400)).toBeCloseTo(0.8, 9);
  });

  test('T-REV-10 联络图：版式算得对，帧叠在棋盘格上、在格子里居中，空格只有棋盘格；太宽时一组参数折成几行', () => {
    const red = blank(4, 2, [255, 0, 0]);
    const rows = [
      { label: [{ text: 'a' }], cells: [{ image: red, caption: 'x' }, null] },
      { label: [{ text: 'b' }], cells: [{ image: red, caption: 'y' }] },
    ];
    const img = composeSheet('t', 8, 4, rows, null);
    const layout = sheetLayout(2, 2, 8, 4);
    expect([img.width, img.height]).toEqual([layout.width, layout.height]);
    expect(layout.width).toBe(SHEET.pad + SHEET.labelWidth + SHEET.pad + 2 * (8 + SHEET.pad));
    expect(layout.height).toBe(SHEET.pad + SHEET.headerHeight + SHEET.pad + 2 * (SHEET.captionHeight + 4 + SHEET.pad));
    const px = (x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    const c = layout.cell(1, 0);
    expect(px(c.x + 2, c.y + 1)).toEqual([255, 0, 0, 255]);
    expect(px(c.x + 5, c.y + 2)).toEqual([255, 0, 0, 255]);
    expect(px(c.x, c.y)).toEqual([...CHECKER.a, 255]);
    const empty = layout.cell(0, 1);
    expect(px(empty.x + 4, empty.y + 2)).toEqual([...CHECKER.a, 255]);
    expect(px(0, 0)).toEqual([...SHEET.background, 255]);

    // 六格、一行只放得下两格：折成三行，第 3 格在第二行开头
    const wrapped = sheetLayout(1, 6, 100, 50, 2);
    expect(wrapped.perLine).toBe(2);
    expect(wrapped.cell(0, 2)).toEqual({ x: wrapped.cell(0, 0).x, y: wrapped.cell(0, 0).y + SHEET.captionHeight + 50 + SHEET.pad });
    const sheet = composeSheet('t', 100, 50, [{ label: [], cells: Array.from({ length: 6 }, () => ({ image: blank(100, 50, [0, 0, 255]), caption: '' })) }], null, SHEET.pad * 2 + SHEET.labelWidth + 2 * (100 + SHEET.pad));
    expect([sheet.width, sheet.height]).toEqual([wrapped.width, wrapped.height]);
  });

  test('T-REV-11 参数组与报告：默认参数加自带预设；合并时这次截了的模板整条换掉，来源或语言不同就拒绝；汇总缺的贴图', () => {
    const manifest: Pick<TemplateManifest, 'presets'> = { presets: [{ key: 'raid', name: { 'zh-CN': '袭击', en: 'Raid' }, params: { color: 'red' } }] };
    expect(paramSetsOf(manifest, false, 'zh-CN')).toEqual([{ key: 'default', name: '默认参数', params: {} }]);
    expect(paramSetsOf(manifest, true, 'en')).toEqual([
      { key: 'default', name: 'Defaults', params: {} },
      { key: 'preset-raid', name: 'Raid', params: { color: 'red' } },
    ]);
    expect(paramSetsOf({}, true, 'zh-CN')).toHaveLength(1);

    const merged = mergeReport(report([tpl('boss-bar', 'old'), tpl('chat-message', 'old')]), report([tpl('boss-bar', 'new'), tpl('aaa', 'new')]));
    expect(merged.templates.map((t) => `${t.name}:${t.capturedAt}`)).toEqual(['aaa:new', 'boss-bar:new', 'chat-message:old']);
    expect(mergeReport(null, report([]))).toEqual(report([]));
    expect(() => mergeReport(report([]), report([], 'none'))).toThrow(UsageError);
    expect(() => mergeReport(report([]), { ...report([]), lang: 'en' })).toThrow(UsageError);

    const shot = { slot: 'first', slotId: 'first', index: 8, t: 8 / 60, file: 'x.png', coverage: 0.1, bbox: null };
    const sum = summarize([
      tpl('boss-bar', 'now', [run({ shots: [shot, { ...shot, file: null }], missingTextures: ['minecraft:gui/sprites/boss_bar/pink_background'] }), run({ paramSet: { key: 'preset-raid', name: '袭击' }, warnings: ['w'], missingTextures: ['minecraft:gui/sprites/boss_bar/pink_background'] })]),
      tpl('hud-status', 'now', [run({ error: 'boom', preview: { status: 'error', warnings: [], message: 'boom' } })]),
    ]);
    expect([sum.runs, sum.frames, sum.runsWithWarnings, sum.errors]).toEqual([3, 1, 1, 1]);
    expect([...sum.missing]).toEqual([['minecraft:gui/sprites/boss_bar/pink_background', ['boss-bar default', 'boss-bar preset-raid']]]);
  });

  test('T-REV-12 index.html：按模板列出联络图和逐帧的图，文字都转义', () => {
    const t = tpl('boss-bar', '2026-11-22', [
      run({
        shots: [{ slot: 'first', slotId: 'first', index: 8, t: 8 / 60, file: 'boss-bar/16x9/default/01-first.png', coverage: 0, bbox: null }],
        warnings: ['text: 1 character(s) have no glyph in any font (<x>)'],
        missingTextures: ['minecraft:gui/sprites/hud/air_empty'],
        fonts: [{ id: 'minecraft:default', found: true, skipped: ['missing(minecraft:font/unifont.zip)'] }],
      }),
    ]);
    t.title = 'Boss <b>栏';
    t.sheets = [{ aspect: '16:9', contact: 'boss-bar/contact-16x9.png', detail: 'boss-bar/detail-16x9.png', detailScale: 2 }];
    const html = renderIndex(report([t]));
    expect(html).toContain('id="boss-bar"');
    expect(html).toContain('src="boss-bar/contact-16x9.png"');
    expect(html).toContain('src="boss-bar/16x9/default/01-first.png"');
    expect(html).toContain('全透明');
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('Boss &lt;b&gt;栏');
    expect(html).not.toContain('<b>栏');
    expect(html).toContain('minecraft:gui/sprites/hud/air_empty');
    expect(html).toContain('missing(minecraft:font/unifont.zip)');
  });

  test('T-REV-13 标注用随应用分发的 Unifont 写：中文比拉丁字母宽，太长的从后面截掉、加省略号', () => {
    const text = unifontRenderer(parseUnifontOtf(new Uint8Array(readFileSync(join(ROOT, 'resources', ...EMBEDDED_UNIFONT_FILE)))));
    expect(text.lineHeight).toBe(16);
    expect(text.measure('A')).toBeGreaterThan(0);
    expect(text.measure('栏')).toBeGreaterThan(text.measure('A'));
    const img = blank(40, 20, [0, 0, 0]);
    text.draw(img, 2, 2, 'A栏', [255, 255, 255]);
    let lit = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 255) lit++;
    expect(lit).toBeGreaterThan(20);
    const long = fitText(text, '两条栏：末影龙和凋灵，还有一些很长的说明', 80);
    expect(long.endsWith('…')).toBe(true);
    expect(text.measure(long)).toBeLessThanOrEqual(80);
    expect(fitText(text, 'ok', 80)).toBe('ok');
  });
});
