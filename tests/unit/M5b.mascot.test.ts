import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveMascotPath } from '../../apps/desktop/src/main/app-path';
import { splashUrl } from '../../apps/desktop/src/main/splash';
import { parseThemeVars, splashFiles, splashHtml } from '../../apps/desktop/src/splash/generate';
import { CLIP_ORDER, CLIPS } from '../../packages/mascot/model/allay.motions';
import { allHandAnchors } from '../../packages/mascot/model/allay.rig';
import { AtlasJsonSchema, pickHeadSize, pickSheetSize } from '../../packages/mascot/src/assets';
import { ATLAS_COLUMNS, ATLAS_SIZES, GENERATED_FILES } from '../../packages/mascot/src/atlas';
import { MascotStage } from '../../packages/mascot/src/stage';
import { brandMessages } from '../../packages/ui/src/brand/messages';
import { RUNTIME_FILES, stageMascot } from '../../scripts/mascot-dist';

// M5 后半（docs/decisions.md M5b）：全局协调的纯逻辑（T-ALY-3 的单元部分）、产物的读取与校验、
// 主进程提供产物的路径、启动画面的生成、pnpm dist 前放产物的步骤。

const ROOT = resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'allay-m5b-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('T-ALY-3 同一时刻只批准一只全身悦灵（stage.ts）', () => {
  it('优先级高的赢；同级先来的赢；撤回后下一个顶上', () => {
    const s = new MascotStage();
    const changes: (string | null)[] = [];
    s.subscribe(() => changes.push(s.winner));
    s.claim('gallery', 'gallery');
    s.claim('preview', 'preview');
    expect(s.winner).toBe('preview');
    s.claim('empty', 'empty');
    s.claim('error', 'error');
    expect(s.winner).toBe('preview');
    s.claim('export', 'export');
    expect(s.winner).toBe('export');
    s.claim('drop', 'drop');
    expect(s.winner).toBe('drop');
    s.release('drop');
    s.release('export');
    s.release('preview');
    expect(s.winner).toBe('gallery');
    s.claim('gallery2', 'gallery');
    expect(s.winner).toBe('gallery');
    s.release('gallery');
    expect(s.winner).toBe('gallery2');
    s.release('gallery2');
    expect(s.winner).toBe('error');
    s.release('error');
    s.release('empty');
    expect(s.winner).toBeNull();
    expect(s.size).toBe(0);
    // 只在赢家变化时通知
    expect(changes).toEqual(['gallery', 'preview', 'export', 'drop', 'export', 'preview', 'gallery', 'gallery2', 'error', 'empty', null]);
  });
});

describe('烘焙产物的读取', () => {
  const atlas = () => {
    let start = 0;
    const clips = Object.fromEntries(
      CLIP_ORDER.map((c) => {
        const r = [c, { start, count: CLIPS[c].frames }] as const;
        start += CLIPS[c].frames;
        return r;
      }),
    );
    return { fps: 30, columns: ATLAS_COLUMNS, frames: start, sizes: [...ATLAS_SIZES], clips, handAnchor: allHandAnchors(CLIP_ORDER) };
  };
  it('atlas.json 的 schema 接受烘焙脚本的格式，拒绝缺项和越界', () => {
    expect(AtlasJsonSchema.safeParse(atlas()).success).toBe(true);
    // 本机烘焙过的真实产物（有就核对，没有就只看上面的构造）
    const real = join(ROOT, 'packages/mascot/generated/allay.atlas.json');
    if (existsSync(real)) expect(AtlasJsonSchema.safeParse(JSON.parse(readFileSync(real, 'utf8'))).success).toBe(true);
    const a = atlas();
    expect(AtlasJsonSchema.safeParse({ ...a, handAnchor: a.handAnchor.slice(1) }).success).toBe(false);
    expect(AtlasJsonSchema.safeParse({ ...a, clips: { ...a.clips, sad: { start: 150, count: 30 } } }).success).toBe(false);
    const { fly: _fly, ...noFly } = a.clips;
    expect(AtlasJsonSchema.safeParse({ ...a, clips: noFly }).success).toBe(false);
  });
  it('按设备像素选图集与头像', () => {
    expect(pickSheetSize(72, [288, 96])).toBe(96);
    expect(pickSheetSize(96, [288, 96])).toBe(96);
    expect(pickSheetSize(108, [288, 96])).toBe(288);
    expect(pickSheetSize(600, [288, 96])).toBe(288);
    // 头像：不超过所需的最大一张（整数像素显示），太小时用最小的
    expect(pickHeadSize(33)).toBe(32);
    expect(pickHeadSize(20)).toBe(20);
    expect(pickHeadSize(10)).toBe(16);
    expect(pickHeadSize(100)).toBe(48);
  });
});

describe('主进程在 app://renderer/mascot/ 下提供产物', () => {
  const dir = join(tmp, 'mascot');
  it('只认扁平的 png 和 json 文件名', () => {
    expect(resolveMascotPath(dir, 'app://renderer/mascot/allay-96.png')).toBe(join(dir, 'allay-96.png'));
    expect(resolveMascotPath(dir, 'app://renderer/mascot/allay.atlas.json')).toBe(join(dir, 'allay.atlas.json'));
    expect(resolveMascotPath(dir, 'app://renderer/mascot/allay-head-20-closed.png')).toBe(join(dir, 'allay-head-20-closed.png'));
    // URL 先规范化：mascot/../index.html 就是 /index.html，不归它管
    expect(resolveMascotPath(dir, 'app://renderer/mascot/../index.html')).toBeUndefined();
    expect(resolveMascotPath(dir, 'app://renderer/mascot/%2e%2e/x.png')).toBeUndefined();
    for (const bad of ['app://renderer/mascot/sub/x.png', 'app://renderer/mascot/x.js', 'app://renderer/mascot/', 'app://renderer/mascot/..%5cx.png', 'app://renderer/mascot/X.PNG'])
      expect(resolveMascotPath(dir, bad)).toBeNull();
    // 其他路径不归它管
    expect(resolveMascotPath(dir, 'app://renderer/index.html')).toBeUndefined();
    expect(resolveMascotPath(dir, 'app://renderer/mascotx/a.png')).toBeUndefined();
    expect(resolveMascotPath(dir, 'app://evil/mascot/a.png')).toBeUndefined();
  });
});

describe('启动画面（7.6 C）', () => {
  it('每种语言 × 主题一个静态页面，没有脚本，文字来自品牌文案和界面文案', () => {
    const files = splashFiles(ROOT);
    expect([...files.keys()].sort()).toEqual(['splash/en-dark.html', 'splash/en-light.html', 'splash/splash.css', 'splash/zh-CN-dark.html', 'splash/zh-CN-light.html']);
    for (const [name, text] of files) {
      expect(text).not.toMatch(/<script|javascript:|on[a-z]+=/i);
      if (name.endsWith('.html')) expect(text).toContain('href="splash.css"');
    }
    const zh = splashHtml('zh-CN', 'dark');
    expect(zh).toContain(brandMessages['zh-CN'].wordmark);
    expect(zh).toContain(brandMessages['zh-CN'].name);
    expect(zh).toContain(brandMessages['zh-CN'].disclaimer);
    expect(zh).toContain('data-theme="dark"');
    const en = splashHtml('en', 'light');
    expect(en).toContain(brandMessages.en.disclaimer);
    expect(en).not.toContain('class="name"'); // 英文的产品名与字标相同，只写一次
  });
  it('颜色来自设计变量，帧动画按图集网格与动作帧数生成', () => {
    const css = splashFiles(ROOT).get('splash/splash.css')!;
    const vars = parseThemeVars(readFileSync(join(ROOT, 'packages/ui/src/styles/globals.css'), 'utf8'));
    expect(css).toContain(`--background:${vars.dark['--background']}`);
    expect(css).toContain(`--background:${vars.light['--background']}`);
    // 除两套主题的变量定义外不写死颜色
    expect(css.replace(/\[data-theme='(dark|light)'\]\{[^}]*\}/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain('url(../mascot/allay-288.png)');
    // hover 45 帧 + 末尾一帧，fly 24 帧 + 末尾一帧
    expect((/@keyframes sprite-hover\{([^}]*\}){46}\}/.exec(css) ?? []).length).toBeGreaterThan(0);
    expect((/@keyframes sprite-fly\{([^}]*\}){25}\}/.exec(css) ?? []).length).toBeGreaterThan(0);
    expect(css).toContain('@media (prefers-reduced-motion:reduce)');
  });
  it('地址片段选状态', () => {
    expect(splashUrl('app://renderer', 'zh-CN', 'dark', { hasAtlas: true, reduced: false })).toBe('app://renderer/splash/zh-CN-dark.html');
    expect(splashUrl('app://renderer', 'en', 'light', { hasAtlas: false, reduced: false })).toBe('app://renderer/splash/en-light.html#p');
    expect(splashUrl('app://renderer', 'en', 'dark', { hasAtlas: true, reduced: true })).toBe('app://renderer/splash/en-dark.html#s');
    expect(splashUrl('app://renderer', 'en', 'dark', { hasAtlas: false, reduced: true })).toBe('app://renderer/splash/en-dark.html#ps');
  });
});

describe('pnpm dist 前放产物（scripts/mascot-dist.ts）', () => {
  it('缺产物时默认失败；允许占位时清空并继续；产物齐全时复制运行时文件和图标', () => {
    const generated = join(tmp, 'generated');
    const build = join(tmp, 'build');
    mkdirSync(generated, { recursive: true });
    mkdirSync(join(build, 'mascot'), { recursive: true });
    writeFileSync(join(build, 'mascot', 'stale.png'), 'x');
    expect(() => stageMascot({ generated, build, allowPlaceholder: false })).toThrow(/pnpm mascot:bake[\s\S]*ALLAY_DIST_ALLOW_PLACEHOLDER/);
    const r = stageMascot({ generated, build, allowPlaceholder: true });
    expect(r.mode).toBe('placeholder');
    expect(readdirSync(join(build, 'mascot'))).toEqual([]);
    expect(existsSync(join(build, 'icon.ico'))).toBe(false);
    for (const f of GENERATED_FILES) writeFileSync(join(generated, f), f);
    expect(stageMascot({ generated, build, allowPlaceholder: false }).mode).toBe('baked');
    expect(readdirSync(join(build, 'mascot')).sort()).toEqual([...RUNTIME_FILES].sort());
    expect(readFileSync(join(build, 'icon.ico'), 'utf8')).toBe('icon.ico');
  });
  it('electron-builder 带上 build/mascot；放产物的位置被 git 忽略', () => {
    const yml = readFileSync(join(ROOT, 'apps/desktop/electron-builder.yml'), 'utf8');
    expect(yml).toMatch(/- from: build\/mascot\s+to: mascot/);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    for (const p of ['apps/desktop/build/mascot/allay-288.png', 'apps/desktop/build/icon.ico']) expect(git('check-ignore', '--no-index', p).trim()).toBe(p);
  });
});
