// pnpm review:templates：内置模板在真实原版素材下的评审截图（用法、每类模板该看什么见 docs/review/templates/README.md）。
//
// 后台启动已构建的应用：窗口不显示、用临时的用户数据目录、Mojang 的下载地址指到一个不通的本机端口（不联网）。
// 把本机游戏目录里的某个版本按“本机游戏”这一种原版来源接进资源栈（--no-assets 时什么都不接），先核对资源栈里确实是
// 这一层，再逐个选中模板、等预览装载完，经测试钩子 reviewFrames 渲染各时刻的帧（与导出同一条静帧路径，输出分辨率、
// 直通 alpha），最后拼联络图、写 report.json（每次装载的警告、错误、缺失的贴图 ID）和 index.html。
//
// **输出含原版贴图和字体的派生图像。**只写进被 git 忽略的 docs/review/templates/out/（或 --out 指定的目录），
// 不提交、不外传（AGENTS.md 硬性规则 1）。游戏文件只读。版本目录名应用不认时（带空格等），--mirror 在临时目录里建一个
// 只含这一版的镜像游戏目录（jar 用硬链接或复制、assets 用目录联接），用完删掉；原来的游戏目录一个字节都不动。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ElectronApplication, Page } from '@playwright/test';
import { findBdfGlyph, parseUnifontOtf, vanillaLayerId, VersionIdSchema, type UnihexTables } from '../packages/assets/src/index';
import { frameCount } from '../packages/engine/src/frames';
import { localize, localizePresetParams, type ParamValues, type TemplateManifest } from '../packages/template-sdk/src/index';
import { EMBEDDED_UNIFONT_FILE } from '../apps/desktop/src/main/resources/fonts';
import { listVersions } from '../apps/desktop/src/main/resources/vanilla';
import type { ReviewFrames } from '../apps/desktop/src/renderer/test-hooks';
import type { ResourceState } from '../apps/desktop/src/shared/resources';
import { packageFileName } from '../apps/desktop/src/shared/templates';
import { readTemplateManifest, templateDirs, TEMPLATES_LIB, TEMPLATES_OUT } from './build-templates';
import { decodePng, encodePng, type Rgba } from './mascot-bake/png';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
/** 默认的输出根目录（.gitignore 忽略 docs/review 下各目录的 out） */
export const DEFAULT_OUT_ROOT = join(ROOT, 'docs/review/templates/out');
const TAG = '[review:templates]';

// ---------------------------------------------------------------- 参数

export type Aspect = '16:9' | '9:16' | '1:1';
/** 三种画幅：输出分辨率和项目里的那一档一致（OutputSettingsForm 的 RESOLUTIONS） */
export const ASPECTS: Readonly<Record<Aspect, { width: number; height: number; slug: string }>> = {
  '16:9': { width: 1920, height: 1080, slug: '16x9' },
  '9:16': { width: 1080, height: 1920, slug: '9x16' },
  '1:1': { width: 1080, height: 1080, slug: '1x1' },
};
const ASPECT_NAMES = new Map<string, Aspect>([
  ['16:9', '16:9'],
  ['16x9', '16:9'],
  ['9:16', '9:16'],
  ['9x16', '9:16'],
  ['1:1', '1:1'],
  ['1x1', '1:1'],
]);

/** 截哪个时刻：时长的比例、秒、帧号、剪辑点、首末帧附近 */
export type ShotSpec = { kind: 'fraction'; value: number } | { kind: 'seconds'; value: number } | { kind: 'frame'; value: number } | { kind: 'cut' } | { kind: 'first' } | { kind: 'last' };

export type Lang = 'zh-CN' | 'en';

export type SourceOption = { kind: 'local'; gameDir: string; versionDir: string } | { kind: 'none' };

export interface ReviewOptions {
  help: boolean;
  /** 只有 --help 时为 null */
  source: SourceOption | null;
  mirror: boolean;
  out: string | null;
  /** 模板目录名；空表示全部 */
  templates: string[];
  presets: boolean;
  /** 另截一张封面（320 × 180、默认参数，取法和模板库的封面相同） */
  cover: boolean;
  /** null 表示默认的时刻（DEFAULT_SHOTS，有剪辑点时加上剪辑点） */
  shots: ShotSpec[] | null;
  aspects: Aspect[];
  lang: Lang;
  /** --set 给的参数：盖在每一组参数（默认参数、各个预设）和封面上，用来比较几个候选值 */
  set: Record<string, unknown>;
}

export class UsageError extends Error {
  override name = 'UsageError';
}

const VALUE_OPTIONS = new Set(['--game', '--version', '--out', '--at', '--aspect', '--lang']);
const FLAG_OPTIONS = new Set(['--no-assets', '--mirror', '--presets', '--cover', '--help', '-h']);

export function usage(): string {
  return [
    '用法：pnpm review:templates [选项] [模板名…]',
    '',
    '内置模板在真实原版素材下的评审截图。先 pnpm build。输出含原版贴图的派生图像，只写进被忽略的目录，不提交、不外传。',
    '',
    '原版来源（二选一）：',
    '  --game <目录> --version <版本目录名>   本机游戏目录（.minecraft）和 versions/ 下的版本目录名，按“本机游戏”接进资源栈',
    '  --no-assets                           不接任何原版来源，看没有素材时的样子',
    '  --mirror                              版本目录名应用不认（带空格等）时，在临时目录里建一个只含这一版的镜像游戏目录再接入',
    '',
    '其他：',
    '  --out <目录>        输出目录（默认 docs/review/templates/out/<版本目录名或 no-assets>/）',
    '  --presets           除默认参数外，每个自带预设也截一组',
    '  --cover             另截一张封面：320 × 180、默认参数，取法和模板库的封面相同（剪辑点；没有剪辑点时是前 4 秒的中间一帧）',
    '  --at <时刻,…>       50%、1.5s（或 1.5）、f30（帧号）、cut（剪辑点）、first / last（首末帧附近）',
    '                      默认 first,20%,40%,60%,80%,last，模板有剪辑点时再加 cut',
    '  --aspect <画幅,…>   16:9、9:16、1:1 或 all（默认 16:9）',
    '  --lang <zh-CN|en>   界面语言，文字参数的默认值跟着变（默认 zh-CN）',
    '  --set <参数=值>     盖在每一组参数和封面上的参数，可以给多次，如 --set guiScale=7。值按 JSON 读（7、true、"文字"），读不成时当文字',
    '  模板名              packages/templates 下的目录名，如 boss-bar；不给就是全部有 manifest.json 的内置模板',
    '',
    '例：pnpm review:templates --game "C:\\Users\\<你>\\AppData\\Roaming\\.minecraft" --version 1.21.1 --presets boss-bar hud-status',
    '',
    '退出码：0 完成；2 参数不对或没有构建；3 原版来源接不进资源栈；4 有模板装载或渲染失败（截图和报告照样写出）。',
  ].join('\n');
}

export function parseArgs(argv: readonly string[]): ReviewOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const templates: string[] = [];
  const set: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // pnpm 可能把 -- 原样传进来
    if (arg === '--') continue;
    if (!arg.startsWith('-')) {
      if (!templates.includes(arg)) templates.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (FLAG_OPTIONS.has(name)) {
      if (eq > 0) throw new UsageError(`${name} 不带值`);
      flags.add(name === '-h' ? '--help' : name);
      continue;
    }
    if (name === '--set') {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new UsageError('--set 后面要跟“参数=值”');
      const [key, parsed] = parseSet(value);
      if (Object.hasOwn(set, key)) throw new UsageError(`--set ${key} 只能给一次`);
      set[key] = parsed;
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) throw new UsageError(`不认识的选项 ${name}`);
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new UsageError(`${name} 后面要跟一个值`);
    if (values.has(name)) throw new UsageError(`${name} 只能给一次`);
    values.set(name, value);
  }
  const help = flags.has('--help');
  const lang = values.get('--lang') ?? 'zh-CN';
  if (lang !== 'zh-CN' && lang !== 'en') throw new UsageError(`--lang 只能是 zh-CN 或 en（收到 ${lang}）`);
  const aspects = parseAspects(values.get('--aspect') ?? '16:9');
  const at = values.get('--at');
  const shots = at === undefined ? null : parseShots(at);
  const game = values.get('--game');
  const version = values.get('--version');
  let source: SourceOption | null = null;
  if (flags.has('--no-assets')) {
    if (game !== undefined || version !== undefined) throw new UsageError('--no-assets 不能和 --game、--version 一起用');
    if (flags.has('--mirror')) throw new UsageError('--mirror 只在接本机游戏时有用');
    source = { kind: 'none' };
  } else if (game !== undefined || version !== undefined) {
    if (game === undefined || version === undefined) throw new UsageError('--game 和 --version 要一起给');
    source = { kind: 'local', gameDir: resolve(game), versionDir: version };
  } else if (!help) {
    throw new UsageError('要么给 --game 和 --version（接本机游戏的某个版本），要么给 --no-assets');
  }
  const out = values.get('--out');
  return { help, source, mirror: flags.has('--mirror'), out: out === undefined ? null : resolve(out), templates, presets: flags.has('--presets'), cover: flags.has('--cover'), shots, aspects, lang, set };
}

/** --set 的一项：“参数=值”。参数名的写法和 manifest 里的一样；值按 JSON 读，读不成时当文字（--set style=toast） */
export function parseSet(text: string): [key: string, value: unknown] {
  const eq = text.indexOf('=');
  const key = eq < 0 ? text : text.slice(0, eq);
  if (eq < 0 || !/^[a-z][a-zA-Z0-9]*$/.test(key)) throw new UsageError(`--set 要写成“参数=值”，参数名是 manifest 里的 key（收到 ${text}）`);
  const raw = text.slice(eq + 1);
  try {
    return [key, JSON.parse(raw) as unknown];
  } catch {
    return [key, raw];
  }
}

/** --set 的内容写成一行（报告、输出目录名、参数组的名字里用） */
export const describeSet = (set: Readonly<Record<string, unknown>>): string =>
  Object.entries(set)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');

export function parseAspects(text: string): Aspect[] {
  if (text.trim() === 'all') return ['16:9', '9:16', '1:1'];
  const out: Aspect[] = [];
  for (const raw of text.split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const aspect = ASPECT_NAMES.get(t);
    if (!aspect) throw new UsageError(`不认识的画幅 ${t}（可以是 16:9、9:16、1:1，或 all）`);
    if (!out.includes(aspect)) out.push(aspect);
  }
  if (out.length === 0) throw new UsageError('--aspect 至少要给一个画幅');
  return out;
}

export function parseShots(text: string): ShotSpec[] {
  const out: ShotSpec[] = [];
  for (const raw of text.split(',')) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    let m: RegExpExecArray | null;
    if (t === 'cut' || t === 'first' || t === 'last') out.push({ kind: t });
    else if ((m = /^(\d+(?:\.\d+)?)%$/.exec(t))) {
      const v = Number(m[1]);
      if (v > 100) throw new UsageError(`--at 的比例不能超过 100%（收到 ${raw.trim()}）`);
      out.push({ kind: 'fraction', value: v / 100 });
    } else if ((m = /^f(\d+)$/.exec(t))) out.push({ kind: 'frame', value: Number(m[1]) });
    else if ((m = /^(\d+(?:\.\d+)?)s?$/.exec(t))) out.push({ kind: 'seconds', value: Number(m[1]) });
    else throw new UsageError(`--at 里不认识的时刻 ${raw.trim()}（可以是 50%、1.5s、f30、cut、first、last）`);
  }
  if (out.length === 0) throw new UsageError('--at 至少要给一个时刻');
  return out;
}

// ---------------------------------------------------------------- 截哪些时刻

/** 默认的时刻：首帧附近、时长的 20% / 40% / 60% / 80%、末帧附近（有剪辑点时 pickShots 再加上剪辑点） */
export const DEFAULT_SHOTS: readonly ShotSpec[] = [
  { kind: 'first' },
  { kind: 'fraction', value: 0.2 },
  { kind: 'fraction', value: 0.4 },
  { kind: 'fraction', value: 0.6 },
  { kind: 'fraction', value: 0.8 },
  { kind: 'last' },
];

export interface Shot {
  /** 给人看的名字：first、20%、cut、1.5s、f30；几个规格落在同一帧时用 + 连起来 */
  slot: string;
  /** 文件名里用的：first、p20、cut、s1.5、f30 */
  slotId: string;
  /** 帧序号（0 起） */
  index: number;
  /** 这一帧的时刻：index / fps，不超过时长 */
  t: number;
}

/** 模板库的封面（apps/desktop/src/renderer/features/gallery/covers.ts）：320 × 180、30 fps，最多看前 4 秒 */
export const COVER = { width: 320, height: 180, fps: 30, maxFrames: 120 } as const;

/** 封面是哪一刻：剪辑点所在的那一帧；没有剪辑点时，前 4 秒（不足 4 秒就是整段）里的中间一帧。和 covers.ts 的取法相同 */
export function coverTime(duration: number, cutTime: number | null): number {
  const total = Math.min(COVER.maxFrames, frameCount(duration, COVER.fps));
  const index = cutTime === null ? Math.floor(total / 2) : Math.min(total - 1, Math.round(cutTime * COVER.fps));
  return index / COVER.fps;
}

/**
 * “首末帧附近”离两端多远：时长的 3%，至少 2 帧。首末帧本身按规定是全透明的（叠加、标题、转场都是），
 * 往里挪一点才看得到淡入淡出的样子
 */
export function edgeOffset(duration: number, fps: number): number {
  return Math.max(2 / fps, duration * 0.03);
}

const compact = (n: number) => String(Math.round(n * 1000) / 1000);

/** 按规格选帧（帧号按 round(t × fps) 取、钳在首末帧之间），按帧号排好、同一帧只截一次 */
export function pickShots(specs: readonly ShotSpec[] | null, duration: number, fps: number, cutTime: number | null): Shot[] {
  const total = frameCount(duration, fps);
  const list: ShotSpec[] = [...(specs ?? DEFAULT_SHOTS)];
  if (specs === null && cutTime !== null) list.push({ kind: 'cut' });
  const clampIndex = (i: number) => Math.min(total - 1, Math.max(0, i));
  const at = (t: number) => clampIndex(Math.round(t * fps));
  const byIndex = new Map<number, { slots: string[]; ids: string[] }>();
  for (const s of list) {
    let index: number;
    let slot: string;
    let id: string;
    switch (s.kind) {
      case 'fraction':
        index = at(duration * s.value);
        slot = `${compact(s.value * 100)}%`;
        id = `p${compact(s.value * 100)}`;
        break;
      case 'seconds':
        index = at(s.value);
        slot = `${compact(s.value)}s`;
        id = `s${compact(s.value)}`;
        break;
      case 'frame':
        index = clampIndex(s.value);
        slot = id = `f${s.value}`;
        break;
      case 'cut':
        if (cutTime === null) continue;
        index = at(cutTime);
        slot = id = 'cut';
        break;
      case 'first':
        index = at(edgeOffset(duration, fps));
        slot = id = 'first';
        break;
      case 'last':
        index = at(duration - edgeOffset(duration, fps));
        slot = id = 'last';
        break;
      default: {
        const never: never = s;
        throw new Error(`unknown shot ${JSON.stringify(never)}`);
      }
    }
    const entry = byIndex.get(index) ?? { slots: [], ids: [] };
    if (!entry.slots.includes(slot)) {
      entry.slots.push(slot);
      entry.ids.push(id);
    }
    byIndex.set(index, entry);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, e]) => ({ slot: e.slots.join('+'), slotId: e.ids.join('+'), index, t: Math.min(index / fps, duration) }));
}

// ---------------------------------------------------------------- 构建是否最新

export interface FileStamp {
  path: string;
  mtimeMs: number;
}

export type BuildCheck = { state: 'fresh' } | { state: 'missing'; output: string } | { state: 'stale'; output: FileStamp; source: FileStamp };

/** 产物取最旧的一个、源码取最新的一个比修改时间；任何一个产物不在就是没构建 */
export function compareBuild(outputs: readonly { path: string; mtimeMs: number | null }[], newestSource: FileStamp | null): BuildCheck {
  let oldest: FileStamp | null = null;
  for (const o of outputs) {
    if (o.mtimeMs === null) return { state: 'missing', output: o.path };
    if (oldest === null || o.mtimeMs < oldest.mtimeMs) oldest = { path: o.path, mtimeMs: o.mtimeMs };
  }
  if (oldest && newestSource && newestSource.mtimeMs > oldest.mtimeMs) return { state: 'stale', output: oldest, source: newestSource };
  return { state: 'fresh' };
}

/** 应用的构建产物（pnpm --filter @allay/desktop build） */
const APP_OUTPUTS = ['apps/desktop/out/main/index.js', 'apps/desktop/out/preload/index.js', 'apps/desktop/out/renderer/index.html'];
/** 打进应用的源码：应用自己和它依赖的工作区包 */
const APP_SOURCES = [
  'apps/desktop/src',
  'apps/desktop/electron.vite.config.ts',
  'packages/assets/src',
  'packages/engine/src',
  'packages/template-sdk/src',
  'packages/ui/src',
  'packages/mascot/src',
  'packages/host-api/src',
  'packages/optional',
];
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist']);
const TEST_FILE = /\.test\.tsx?$/;

function stampOf(path: string): { path: string; mtimeMs: number | null } {
  try {
    return { path, mtimeMs: statSync(path).mtimeMs };
  } catch {
    return { path, mtimeMs: null };
  }
}

/** 几个目录（或文件）里最新的源码文件；跳过依赖、构建产物和单元测试 */
function newestFile(roots: readonly string[]): FileStamp | null {
  let best: FileStamp | null = null;
  const stack = [...roots];
  while (stack.length > 0) {
    const p = stack.pop()!;
    let st: Stats;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) if (!SKIP_DIRS.has(name)) stack.push(join(p, name));
      continue;
    }
    if (TEST_FILE.test(p)) continue;
    if (best === null || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
  }
  return best;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join('/');
const when = (ms: number) => new Date(ms).toLocaleString('zh-CN', { hour12: false });

/** 应用和要截的那几个模板的构建是否最新；返回问题列表（空表示可以截） */
function checkBuild(dirs: readonly string[]): string[] {
  const problems: string[] = [];
  const describe = (what: string, r: BuildCheck) => {
    if (r.state === 'missing') problems.push(`${what}还没构建：缺 ${rel(r.output)}`);
    else if (r.state === 'stale') problems.push(`${what}的构建（${rel(r.output.path)}，${when(r.output.mtimeMs)}）比源码旧：${rel(r.source.path)} 改于 ${when(r.source.mtimeMs)}`);
  };
  describe('应用', compareBuild(APP_OUTPUTS.map((p) => stampOf(join(ROOT, p))), newestFile(APP_SOURCES.map((p) => join(ROOT, p)))));
  for (const dir of dirs) {
    const m = readTemplateManifest(dir);
    describe(`模板 ${basename(dir)} `, compareBuild([stampOf(join(TEMPLATES_OUT, packageFileName(m.id, m.version)))], newestFile([dir, TEMPLATES_LIB])));
  }
  return problems;
}

/** 按名字选模板目录（packages/templates 下有 manifest.json 的）；不给名字就是全部 */
function selectTemplateDirs(names: readonly string[]): string[] {
  const all = templateDirs();
  if (names.length === 0) return all;
  const byName = new Map(all.map((d) => [basename(d), d]));
  return names.map((n) => {
    const name = n.startsWith('allay.builtin.') ? n.slice('allay.builtin.'.length) : n;
    const dir = byName.get(name);
    if (!dir) throw new UsageError(`没有叫 ${n} 的内置模板（有 manifest.json 的：${[...byName.keys()].join('、')}）`);
    return dir;
  });
}

// ---------------------------------------------------------------- 原版来源

const isDir = (p: string) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
const isFile = (p: string) => statSync(p, { throwIfNoEntry: false })?.isFile() === true;

export type VersionCheck = { ok: true } | { ok: false; reason: string; nameRejected: boolean };

/** 应用的版本识别认不认这个版本目录：先用应用自己的 listVersions，认不了再查是哪一步不行 */
export async function checkVersion(gameDir: string, versionDir: string): Promise<VersionCheck> {
  const versions = join(gameDir, 'versions');
  if (!isDir(versions)) return { ok: false, nameRejected: false, reason: `${gameDir} 下面没有 versions 文件夹，不像游戏目录（.minecraft）` };
  const dir = join(versions, versionDir);
  if (!isDir(dir)) {
    const withJar = readdirSync(versions).filter((n) => isFile(join(versions, n, `${n}.jar`)));
    return { ok: false, nameRejected: false, reason: `versions 下没有 ${versionDir}。带同名 jar 的版本目录有：${withJar.join('、') || '（没有）'}` };
  }
  if (!isFile(join(dir, `${versionDir}.jar`))) return { ok: false, nameRejected: false, reason: `${versionDir} 里没有同名的 ${versionDir}.jar（只装了加载器的版本目录里没有原版客户端）` };
  const found = await listVersions(gameDir);
  if (found.some((v) => v.versionId === versionDir)) return { ok: true };
  if (!VersionIdSchema.safeParse(versionDir).success) {
    const bad = [...new Set(versionDir.replace(/[\w.-]/g, ''))].map((c) => (c === ' ' ? '空格' : c)).join(' ');
    return {
      ok: false,
      nameRejected: true,
      reason:
        `目录名“${versionDir}”里有应用不认的字符（${bad}）。应用的版本识别只认字母、数字、点、下划线、连字符：` +
        'apps/desktop/src/main/resources/vanilla.ts 的 listVersions 跳过这样的目录，设置文件里原版来源的 versionId（packages/assets/src/stack.ts 的 VersionIdSchema）也不收',
    };
  }
  return { ok: false, nameRejected: false, reason: `${versionDir}.json 读不了，或者缺 type、releaseTime（应用的版本识别因此跳过它）` };
}

/** 镜像里的版本号：版本 JSON 的 clientVersion（PCL 写的原版版本号）合规就用它，否则把目录名里不认的字符换成下划线 */
export function mirrorVersionId(json: unknown, dirName: string): string {
  const cv = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).clientVersion : undefined;
  if (typeof cv === 'string' && VersionIdSchema.safeParse(cv).success) return cv;
  const s = dirName.replace(/[^\w.-]/g, '_').slice(0, 64);
  return VersionIdSchema.safeParse(s).success ? s : 'mirror';
}

export interface Mirror {
  /** 镜像游戏目录 */
  gameDir: string;
  versionId: string;
  jar: 'hardlink' | 'copy';
  /** 有没有接上 assets（资源索引和对象：音效、语言文件、unifont 等） */
  assets: boolean;
}

/** 在临时目录里建一个只含这一版的镜像游戏目录：jar 硬链接（不同磁盘时复制）、版本 JSON 只留四个字段、assets 是目录联接 */
function createMirror(gameDir: string, versionDir: string): Mirror {
  const srcDir = join(gameDir, 'versions', versionDir);
  const json: unknown = JSON.parse(readFileSync(join(srcDir, `${versionDir}.json`), 'utf8').replace(/^\uFEFF/, ''));
  const id = mirrorVersionId(json, versionDir);
  const root = mirrorRoot(gameDir, versionDir);
  removeMirror(root);
  const dst = join(root, 'versions', id);
  mkdirSync(dst, { recursive: true });
  let jar: Mirror['jar'] = 'hardlink';
  try {
    linkSync(join(srcDir, `${versionDir}.jar`), join(dst, `${id}.jar`));
  } catch {
    copyFileSync(join(srcDir, `${versionDir}.jar`), join(dst, `${id}.jar`));
    jar = 'copy';
  }
  const j = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  writeFileSync(join(dst, `${id}.json`), JSON.stringify({ id, type: j.type, releaseTime: j.releaseTime, assetIndex: j.assetIndex }));
  const assets = isDir(join(gameDir, 'assets'));
  if (assets) symlinkSync(join(gameDir, 'assets'), join(root, 'assets'), 'junction');
  return { gameDir: root, versionId: id, jar, assets };
}

function mirrorRoot(gameDir: string, versionDir: string): string {
  return join(tmpdir(), 'allay-review-mirror', createHash('sha256').update(`${gameDir}|${versionDir}`).digest('hex').slice(0, 12));
}

/**
 * 删掉镜像目录。先单独解开 assets 联接（只删联接本身，不碰它指向的游戏目录），再确认剩下的没有任何链接，最后才整个删。
 * 碰到预料之外的链接就停下报错，宁可留下垃圾也不冒删到游戏文件的险
 */
export function removeMirror(root: string): void {
  if (!existsSync(root)) return;
  const link = join(root, 'assets');
  const st = lstatSync(link, { throwIfNoEntry: false });
  if (st) {
    if (!st.isSymbolicLink()) throw new Error(`${link} 不是目录联接，没有删；请人工检查`);
    unlinkSync(link);
  }
  const stack = [root];
  while (stack.length > 0) {
    const p = stack.pop()!;
    for (const d of readdirSync(p, { withFileTypes: true })) {
      if (d.isSymbolicLink()) throw new Error(`${join(p, d.name)} 是链接，没有删 ${root}；请人工检查`);
      if (d.isDirectory()) stack.push(join(p, d.name));
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

/** 输出目录的名字：版本目录名（不认的字符换成下划线）或 no-assets；英文界面加 -en，有 --set 时再加“+参数=值”（不认的字符同样换掉） */
export function outLabel(source: SourceOption, lang: Lang, set: Readonly<Record<string, unknown>> = {}): string {
  const base = source.kind === 'none' ? 'no-assets' : source.versionDir.replace(/[^\w.-]+/g, '_');
  const label = lang === 'en' ? `${base}-en` : base;
  if (Object.keys(set).length === 0) return label;
  return `${label}+${describeSet(set).split(' ').join('+')}`.replace(/[^a-zA-Z0-9_.=+-]+/g, '_');
}

/** 写给应用的设置文件：引导、新手引导算走过，界面语言，自动更新关掉，资源栈里只有给定的原版来源（或什么都没有） */
export function seedSettings(source: { gameDir: string; versionId: string } | null, lang: Lang): Record<string, unknown> {
  const vanilla = source ? { kind: 'local' as const, gameDir: source.gameDir, versionId: source.versionId } : null;
  return {
    formatVersion: 1,
    ui: { language: lang, onboardingCompleted: true, tourCompleted: true, updates: { mode: 'off', source: 'auto', skipVersion: null } },
    resources: {
      vanilla: { consent: vanilla !== null, enabled: true, dir: vanilla?.gameDir ?? null },
      vanillaSources: vanilla ? [{ id: vanillaLayerId(vanilla), source: vanilla, enabled: true }] : [],
      packs: [],
    },
  };
}

// ---------------------------------------------------------------- 参数组

export interface ParamSet {
  /** default 或 preset-<预设的 key> */
  key: string;
  name: string;
  params: Record<string, unknown>;
}

/**
 * 默认参数，加上（--presets 时）每个自带预设；预设里写成双语的文字按界面语言取（和应用套用预设时一样）。
 * --set 的参数盖在每一组上，组名后面注明
 */
export function paramSetsOf(manifest: Pick<TemplateManifest, 'presets' | 'params'>, withPresets: boolean, lang: Lang, set: Readonly<Record<string, unknown>> = {}): ParamSet[] {
  const sets: ParamSet[] = [{ key: 'default', name: lang === 'zh-CN' ? '默认参数' : 'Defaults', params: {} }];
  if (withPresets) for (const p of manifest.presets ?? []) sets.push({ key: `preset-${p.key}`, name: localize(p.name, lang), params: localizePresetParams(manifest.params ?? [], p.params, lang) });
  if (Object.keys(set).length === 0) return sets;
  return sets.map((s) => ({ ...s, name: `${s.name} + ${describeSet(set)}`, params: { ...s.params, ...set } }));
}

// ---------------------------------------------------------------- 图像：缩放、合成、裁切

export type RGB = readonly [number, number, number];

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function blank(width: number, height: number, rgb: RGB): Rgba {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** 一维的面积权重：目标第 i 格覆盖源的 [i·k, (i+1)·k)，边上的源像素按覆盖的比例算 */
function areaWeights(srcLen: number, dstLen: number): { start: Int32Array; count: Int32Array; weights: Float32Array; stride: number } {
  const k = srcLen / dstLen;
  const stride = Math.ceil(k) + 2;
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const weights = new Float32Array(dstLen * stride);
  for (let i = 0; i < dstLen; i++) {
    const a = i * k;
    const b = Math.min(srcLen, (i + 1) * k);
    const s0 = Math.floor(a);
    let n = 0;
    for (let s = s0; s < Math.ceil(b) && n < stride; s++, n++) weights[i * stride + n] = (Math.min(b, s + 1) - Math.max(a, s)) / (b - a);
    start[i] = s0;
    count[i] = n;
  }
  return { start, count, weights, stride };
}

/** 面积平均缩放到 width × height。在预乘 alpha 下平均：透明像素不会把边上的颜色拉黑 */
export function resizeArea(src: Rgba, width: number, height: number): Rgba {
  const h = areaWeights(src.width, width);
  const v = areaWeights(src.height, height);
  const tmp = new Float32Array(width * src.height * 4);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let n = 0; n < h.count[x]!; n++) {
        const o = (y * src.width + h.start[x]! + n) * 4;
        const w = h.weights[x * h.stride + n]! * (src.data[o + 3]! / 255);
        r += src.data[o]! * w;
        g += src.data[o + 1]! * w;
        b += src.data[o + 2]! * w;
        a += w;
      }
      const t = (y * width + x) * 4;
      tmp[t] = r;
      tmp[t + 1] = g;
      tmp[t + 2] = b;
      tmp[t + 3] = a;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let n = 0; n < v.count[y]!; n++) {
        const t = ((v.start[y]! + n) * width + x) * 4;
        const w = v.weights[y * v.stride + n]!;
        r += tmp[t]! * w;
        g += tmp[t + 1]! * w;
        b += tmp[t + 2]! * w;
        a += tmp[t + 3]! * w;
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        data[o] = Math.round(r / a);
        data[o + 1] = Math.round(g / a);
        data[o + 2] = Math.round(b / a);
      }
      data[o + 3] = Math.round(a * 255);
    }
  }
  return { width, height, data };
}

/** 整数倍放大（最近邻）：界面像素放大后仍是方块 */
export function scaleNearest(src: Rgba, k: number): Rgba {
  const width = src.width * k;
  const height = src.height * k;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < width; x++) {
      const s = (sy * src.width + Math.floor(x / k)) * 4;
      data.set(src.data.subarray(s, s + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** 按倍数缩放：≥ 1 的整数倍用最近邻，其余用面积平均 */
export function scaleBy(src: Rgba, k: number): Rgba {
  if (k >= 1 && Number.isInteger(k)) return k === 1 ? src : scaleNearest(src, k);
  return resizeArea(src, Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
}

/** 把直通 alpha 的 src 叠到不透明的 dst 上（超出 dst 的部分裁掉） */
export function over(dst: Rgba, src: Rgba, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const a = src.data[s + 3]! / 255;
      if (a === 0) continue;
      const d = (dy * dst.width + dx) * 4;
      for (let c = 0; c < 3; c++) dst.data[d + c] = Math.round(src.data[s + c]! * a + dst.data[d + c]! * (1 - a));
      dst.data[d + 3] = 255;
    }
  }
}

/** 浅灰的棋盘格（透明的地方看得出是透明的，白字和黑底都看得清） */
export const CHECKER = { a: [111, 111, 111] as RGB, b: [122, 122, 122] as RGB };

export function fillChecker(img: Rgba, x0: number, y0: number, width: number, height: number, cell: number): void {
  for (let y = 0; y < height; y++) {
    const py = y0 + y;
    if (py < 0 || py >= img.height) continue;
    for (let x = 0; x < width; x++) {
      const px = x0 + x;
      if (px < 0 || px >= img.width) continue;
      const rgb = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? CHECKER.a : CHECKER.b;
      const o = (py * img.width + px) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
}

/** 不透明像素的外框、覆盖率（alpha > 0 的像素占比）、最大 alpha */
export function alphaStats(img: Rgba): { bbox: BBox | null; coverage: number; maxAlpha: number } {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  let maxAlpha = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const a = img.data[(y * img.width + x) * 4 + 3]!;
      if (a === 0) continue;
      count++;
      if (a > maxAlpha) maxAlpha = a;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bbox = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { bbox, coverage: count / (img.width * img.height), maxAlpha };
}

export function unionBBox(boxes: readonly (BBox | null)[]): BBox | null {
  let u: BBox | null = null;
  for (const b of boxes) {
    if (!b) continue;
    if (!u) {
      u = { ...b };
      continue;
    }
    const x1 = Math.max(u.x + u.width, b.x + b.width);
    const y1 = Math.max(u.y + u.height, b.y + b.height);
    u.x = Math.min(u.x, b.x);
    u.y = Math.min(u.y, b.y);
    u.width = x1 - u.x;
    u.height = y1 - u.y;
  }
  return u;
}

/** 四周各加 pad，钳在 width × height 里 */
export function padBBox(b: BBox, pad: number, width: number, height: number): BBox {
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  return { x, y, width: Math.min(width, b.x + b.width + pad) - x, height: Math.min(height, b.y + b.height + pad) - y };
}

export function crop(img: Rgba, b: BBox): Rgba {
  const data = new Uint8Array(b.width * b.height * 4);
  for (let y = 0; y < b.height; y++) data.set(img.data.subarray(((b.y + y) * img.width + b.x) * 4, ((b.y + y) * img.width + b.x + b.width) * 4), y * b.width * 4);
  return { width: b.width, height: b.height, data };
}

/** 联络图里一格的缩放：整帧放进 480 × 480 的框（16:9 是 1/4，480 × 270） */
export function contactScale(width: number, height: number): number {
  return Math.min(480 / width, 480 / height);
}

/**
 * 细节图的缩放：所有帧里不透明部分的外框放进 960 × 720。小的放大到 2 或 3 倍（最近邻），放得下的 1:1，
 * 放不下的缩小但不小于 1/2（默认界面缩放下一个界面像素仍有两个像素以上宽）
 */
export function detailScale(width: number, height: number): number {
  const fit = Math.min(960 / width, 720 / height);
  if (fit >= 2) return Math.min(3, Math.floor(fit));
  if (fit >= 1) return 1;
  return Math.max(0.5, fit);
}

// ---------------------------------------------------------------- 文字（联络图上的标注）

export interface TextRenderer {
  lineHeight: number;
  measure(text: string): number;
  draw(img: Rgba, x: number, y: number, text: string, rgb: RGB): void;
}

/** 用随应用分发的 Unifont（resources/fonts/unifont）画标注：一个 Unifont 像素一个像素，16 像素高，中文也能写 */
export function unifontRenderer(t: UnihexTables): TextRenderer {
  const glyphOf = (cp: number) => {
    const i = findBdfGlyph(t.codepoints, cp);
    return i >= 0 ? i : findBdfGlyph(t.codepoints, 0xfffd);
  };
  const advance = (i: number) => (i >= 0 ? t.metrics[i * 5]! : 8);
  return {
    lineHeight: t.ascent + t.descent,
    measure(text) {
      let w = 0;
      for (const ch of text) w += advance(glyphOf(ch.codePointAt(0)!));
      return w;
    },
    draw(img, x, y, text, rgb) {
      const baseline = y + t.ascent;
      let pen = x;
      for (const ch of text) {
        const i = glyphOf(ch.codePointAt(0)!);
        if (i < 0) {
          pen += 8;
          continue;
        }
        const [adv, w, h, xo, yo] = [t.metrics[i * 5]!, t.metrics[i * 5 + 1]!, t.metrics[i * 5 + 2]!, t.metrics[i * 5 + 3]!, t.metrics[i * 5 + 4]!];
        const rowBytes = Math.ceil(w / 8);
        const off = t.offsets[i]!;
        for (let row = 0; row < h; row++) {
          const py = baseline - yo - h + row;
          if (py < 0 || py >= img.height) continue;
          for (let col = 0; col < w; col++) {
            if (!(t.bits[off + row * rowBytes + (col >> 3)]! & (0x80 >> (col & 7)))) continue;
            const px = pen + xo + col;
            if (px < 0 || px >= img.width) continue;
            const o = (py * img.width + px) * 4;
            img.data[o] = rgb[0];
            img.data[o + 1] = rgb[1];
            img.data[o + 2] = rgb[2];
            img.data[o + 3] = 255;
          }
        }
        pen += adv;
      }
    },
  };
}

/** 太长的标注从后面截掉、加省略号 */
export function fitText(text: TextRenderer, s: string, maxWidth: number): string {
  if (text.measure(s) <= maxWidth) return s;
  const chars = [...s];
  while (chars.length > 0 && text.measure(`${chars.join('')}…`) > maxWidth) chars.pop();
  return `${chars.join('')}…`;
}

// ---------------------------------------------------------------- 联络图

export const SHEET = { pad: 12, labelWidth: 280, headerHeight: 24, captionHeight: 20, checker: 8, background: [30, 30, 30] as RGB };
/** 细节图一行最宽多少像素（超过就折行）；联络图不折，一组参数一行 */
const DETAIL_MAX_WIDTH = 2600;

export interface SheetLine {
  text: string;
  rgb?: RGB;
}

export interface SheetRow {
  label: SheetLine[];
  cells: ({ image: Rgba; caption: string } | null)[];
}

export interface SheetLayout {
  width: number;
  height: number;
  /** 一行最多放几格（放不下的折到下一行，标注只写在第一行左边） */
  perLine: number;
  cell(row: number, col: number): { x: number; y: number };
  label(row: number): { x: number; y: number };
}

/**
 * 联络图的版式：左边一栏写参数组，每格上面是标注，格子是 cellWidth × cellHeight。一组参数的格子一行放不下
 * perLine 个时折行（缺省不折）
 */
export function sheetLayout(rows: number, cols: number, cellWidth: number, cellHeight: number, perLine = cols): SheetLayout {
  const { pad, labelWidth, headerHeight, captionHeight } = SHEET;
  const per = Math.max(1, Math.min(cols, perLine));
  const top = pad + headerHeight + pad;
  const lineHeight = captionHeight + cellHeight + pad;
  const rowHeight = Math.ceil(cols / per) * lineHeight;
  return {
    width: pad + labelWidth + pad + per * (cellWidth + pad),
    height: top + rows * rowHeight,
    perLine: per,
    cell: (row, col) => ({ x: pad + labelWidth + pad + (col % per) * (cellWidth + pad), y: top + row * rowHeight + Math.floor(col / per) * lineHeight + captionHeight }),
    label: (row) => ({ x: pad, y: top + row * rowHeight + captionHeight }),
  };
}

/**
 * 拼一张联络图：每组参数一行、每个时刻一列；格子里是棋盘格上叠的帧（居中），text 为 null 时不写字。
 * 宽度超过 maxWidth 时一组参数折成几行
 */
export function composeSheet(title: string, cellWidth: number, cellHeight: number, rows: readonly SheetRow[], text: TextRenderer | null, maxWidth = Infinity): Rgba {
  const cols = Math.max(1, ...rows.map((r) => r.cells.length));
  const fit = Math.floor((maxWidth - 2 * SHEET.pad - SHEET.labelWidth) / (cellWidth + SHEET.pad));
  const layout = sheetLayout(rows.length, cols, cellWidth, cellHeight, Number.isFinite(fit) ? fit : cols);
  const img = blank(layout.width, layout.height, SHEET.background);
  text?.draw(img, SHEET.pad, SHEET.pad + 4, fitText(text, title, layout.width - 2 * SHEET.pad), [240, 240, 240]);
  rows.forEach((row, r) => {
    const l = layout.label(r);
    row.label.forEach((line, i) => text?.draw(img, l.x, l.y + i * (text.lineHeight + 4), fitText(text, line.text, SHEET.labelWidth), line.rgb ?? [220, 220, 220]));
    row.cells.forEach((cell, c) => {
      const p = layout.cell(r, c);
      fillChecker(img, p.x, p.y, cellWidth, cellHeight, SHEET.checker);
      if (!cell) return;
      over(img, cell.image, p.x + Math.floor((cellWidth - cell.image.width) / 2), p.y + Math.floor((cellHeight - cell.image.height) / 2));
      text?.draw(img, p.x, p.y - SHEET.captionHeight + 2, fitText(text, cell.caption, cellWidth), [190, 190, 190]);
    });
  });
  return img;
}

// ---------------------------------------------------------------- 报告

export interface ShotRecord extends Shot {
  /** 相对输出目录的路径 */
  file: string | null;
  /** alpha > 0 的像素占比；全透明是 0 */
  coverage: number | null;
  bbox: BBox | null;
}

export interface RunRecord {
  aspect: Aspect;
  paramSet: { key: string; name: string };
  /** 选中后工程里的参数（经参数校验清洗、补了默认值） */
  params: Record<string, unknown>;
  output: { width: number; height: number; fps: number };
  /** 预览装载的结果：ready（带警告）或 error、crashed、unresponsive、timeout */
  preview: { status: string; warnings: string[]; message?: string };
  duration: number | null;
  cutTime: number | null;
  shots: ShotRecord[];
  /** 截图那次装载的警告（与预览的应当一致） */
  warnings: string[];
  /** 模板要过、资源栈里没有的贴图 ID（可选贴图缺失时引擎不记警告，只能从这里看出来） */
  missingTextures: string[];
  foundTextures: string[];
  fonts: { id: string; found: boolean; skipped?: string[] }[];
  sounds: { id: string; found: boolean }[];
  /** 引擎经宿主日志报的消息 */
  engineLog: string[];
  /** 这一组期间页面控制台的警告和错误 */
  console: string[];
  error: string | null;
}

export interface ReportTemplate {
  name: string;
  id: string;
  version: string;
  title: string;
  capturedAt: string;
  runs: RunRecord[];
  sheets: { aspect: Aspect; contact: string | null; detail: string | null; detailScale: number | null }[];
  /** --cover 时的封面：320 × 180、默认参数、coverTime 那一刻；截不到时 file 为 null、error 写原因 */
  cover?: { file: string | null; t: number | null; coverage: number | null; error: string | null };
}

export type ReportSource =
  | { kind: 'none' }
  | {
      kind: 'local';
      gameDir: string;
      versionDir: string;
      /** 资源栈里那一层的 id、版本号（镜像时是镜像里的）、资源包格式号、有没有资源索引 */
      layerId: string;
      versionId: string;
      resourceFormat: string | null;
      hasAssetIndex: boolean | null;
      mirror: Mirror | null;
    };

export interface ReportFile {
  tool: 'review:templates';
  formatVersion: 1;
  /** 同一个输出目录只放同一个来源、同一种语言、同一组 --set 的结果 */
  sourceKey: string;
  label: string;
  lang: Lang;
  /** --set 的参数；以前的报告没有这一项，当作空的 */
  set?: Record<string, unknown>;
  source: ReportSource;
  build: { commit: string | null; dirty: boolean | null; appBuiltAt: string | null };
  layers: { id: string; kind: string; name: string; enabled: boolean; versionId?: string; resourceFormat?: string; hasAssetIndex?: boolean; base?: boolean }[];
  updatedAt: string;
  templates: ReportTemplate[];
}

export function sourceKey(source: SourceOption): string {
  return source.kind === 'none' ? 'none' : `local:${source.gameDir}|${source.versionDir}`;
}

/** 两份报告的 --set 是否相同 */
const sameSet = (a: Readonly<Record<string, unknown>> | undefined, b: Readonly<Record<string, unknown>> | undefined): boolean => describeSet(a ?? {}) === describeSet(b ?? {});

/** 和输出目录里已有的报告合并：这次截了的模板整条换掉，没截的留着；来源、语言或 --set 不同就拒绝 */
export function mergeReport(previous: ReportFile | null, next: ReportFile): ReportFile {
  if (!previous) return next;
  if (previous.sourceKey !== next.sourceKey || previous.lang !== next.lang || !sameSet(previous.set, next.set)) {
    throw new UsageError(`输出目录里是另一个来源、语言或 --set 的结果（${previous.label}，${previous.lang}）；换一个 --out，或者先删掉那个目录`);
  }
  const replaced = new Set(next.templates.map((t) => t.name));
  const templates = [...previous.templates.filter((t) => !replaced.has(t.name)), ...next.templates].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { ...next, templates };
}

/** 读输出目录里已有的报告。目录不空、却没有这个工具写的报告时拒绝（不往别人的目录里写） */
function readPreviousReport(outDir: string): ReportFile | null {
  if (!existsSync(outDir)) return null;
  const file = join(outDir, 'report.json');
  if (!existsSync(file)) {
    if (readdirSync(outDir).length > 0) throw new UsageError(`输出目录 ${outDir} 不是空的，也没有这个工具写的 report.json；换一个 --out`);
    return null;
  }
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof raw !== 'object' || raw === null || (raw as { tool?: unknown }).tool !== 'review:templates') throw new UsageError(`${file} 不是这个工具写的；换一个 --out`);
  return raw as ReportFile;
}

export interface Summary {
  runs: number;
  frames: number;
  runsWithWarnings: number;
  errors: number;
  /** 缺失的贴图 ID → 要过它的“模板 参数组”（去重） */
  missing: Map<string, string[]>;
}

export function summarize(templates: readonly ReportTemplate[]): Summary {
  const s: Summary = { runs: 0, frames: 0, runsWithWarnings: 0, errors: 0, missing: new Map() };
  for (const t of templates) {
    for (const r of t.runs) {
      s.runs++;
      s.frames += r.shots.filter((x) => x.file !== null).length;
      if (r.warnings.length > 0 || r.preview.warnings.length > 0) s.runsWithWarnings++;
      if (r.error !== null) s.errors++;
      for (const id of r.missingTextures) {
        const who = `${t.name} ${r.paramSet.key}`;
        const list = s.missing.get(id) ?? [];
        if (!list.includes(who)) list.push(who);
        s.missing.set(id, list);
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------- index.html

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const href = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** 所有图按模板列出来：模板名、参数组、时刻，联络图和细节图在前，逐帧的缩略图在后 */
export function renderIndex(report: ReportFile): string {
  const sum = summarize(report.templates);
  const src = report.source;
  const sourceRows =
    src.kind === 'none'
      ? '<tr><th>原版来源</th><td>无（--no-assets）：资源栈里只有内置层</td></tr>'
      : [
          `<tr><th>游戏目录</th><td><code>${esc(src.gameDir)}</code></td></tr>`,
          `<tr><th>版本目录</th><td><code>${esc(src.versionDir)}</code>${src.mirror ? `（应用不认这个目录名，经镜像 <code>${esc(src.mirror.gameDir)}</code> 以 <code>${esc(src.mirror.versionId)}</code> 接入；jar ${src.mirror.jar === 'hardlink' ? '硬链接' : '复制'}，assets ${src.mirror.assets ? '联接' : '没有'}）` : ''}</td></tr>`,
          `<tr><th>资源栈里的层</th><td><code>${esc(src.layerId)}</code>，资源包格式 ${esc(src.resourceFormat ?? '未知')}，资源索引${src.hasAssetIndex ? '有' : '没有（没有音效和中文语言文件）'}</td></tr>`,
        ].join('');
  const out: string[] = [
    '<!doctype html>',
    `<html lang="zh-CN"><head><meta charset="utf-8"><title>模板评审截图 · ${esc(report.label)}</title>`,
    '<style>',
    'body{font:14px/1.55 system-ui,"Microsoft YaHei",sans-serif;background:#161616;color:#e6e6e6;margin:24px 32px}',
    'a{color:#8cc8ff}code{background:#262626;padding:0 4px;border-radius:3px}h2{margin-top:48px;border-top:1px solid #333;padding-top:24px}',
    'table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #333;padding:4px 8px;vertical-align:top;text-align:left}',
    '.warn{color:#ffcf66}.err{color:#ff7a7a}.dim{color:#9a9a9a}.sheet{max-width:100%;display:block;margin:8px 0}',
    '.frames td.f{padding:4px}.frames img{width:240px;display:block;background:repeating-conic-gradient(#6f6f6f 0 25%,#7a7a7a 0 50%) 0 0/16px 16px}',
    '.cap{font-size:12px;color:#aaa}details{margin:2px 0}summary{cursor:pointer}ul{margin:4px 0;padding-left:20px}',
    '.covers{display:flex;flex-wrap:wrap;gap:12px}.covers figure{margin:0}.covers img{display:block;background:repeating-conic-gradient(#6f6f6f 0 25%,#7a7a7a 0 50%) 0 0/8px 8px}.covers img.x2{width:640px;image-rendering:pixelated}',
    '</style></head><body>',
    `<h1>模板评审截图 · ${esc(report.label)}</h1>`,
    '<p class="warn">这里的图含原版贴图和字体的派生图像：只在本机看，不提交、不外传。</p>',
    '<table>',
    sourceRows,
    `<tr><th>界面语言</th><td>${esc(report.lang)}</td></tr>`,
    report.set && Object.keys(report.set).length > 0 ? `<tr><th>--set</th><td>${esc(describeSet(report.set))}（盖在每一组参数和封面上）</td></tr>` : '',
    `<tr><th>构建</th><td>${esc(report.build.commit ?? '未知')}${report.build.dirty ? '（有未提交的改动）' : ''}，应用构建于 ${esc(report.build.appBuiltAt ?? '未知')}</td></tr>`,
    `<tr><th>更新于</th><td>${esc(report.updatedAt)}</td></tr>`,
    `<tr><th>合计</th><td>${report.templates.length} 个模板、${sum.runs} 组参数、${sum.frames} 张；有警告的 ${sum.runsWithWarnings} 组，出错的 <span class="${sum.errors ? 'err' : ''}">${sum.errors}</span> 组</td></tr>`,
    '</table>',
    '<table><tr><th>模板</th><th>截于</th><th>组数</th><th>张数</th><th>有警告的组</th><th>缺的贴图 ID</th><th>出错</th></tr>',
  ];
  for (const t of report.templates) {
    const s = summarize([t]);
    out.push(
      `<tr><td><a href="#${esc(t.name)}">${esc(t.name)}</a> ${esc(t.title)}</td><td class="dim">${esc(t.capturedAt)}</td><td>${s.runs}</td><td>${s.frames}</td><td class="${s.runsWithWarnings ? 'warn' : ''}">${s.runsWithWarnings}</td><td>${s.missing.size}</td><td class="${s.errors ? 'err' : ''}">${s.errors}</td></tr>`,
    );
  }
  out.push('</table>');
  const covers = report.templates.filter((t) => t.cover);
  if (covers.length > 0) {
    out.push('<h2>封面</h2><p class="dim">模板库里看到的封面：320 × 180、默认参数，剪辑点（没有剪辑点时前 4 秒的中间一帧）。左边是原大，右边放大 2 倍。</p><div class="covers">');
    for (const t of covers) {
      const c = t.cover!;
      out.push(c.file ? `<figure><img src="${href(c.file)}" alt="${esc(t.name)} 封面"><figcaption class="cap">${esc(t.name)} · ${c.t?.toFixed(2) ?? '—'} 秒${c.coverage === 0 ? ' · 全透明' : ''}</figcaption></figure><figure><img class="x2" src="${href(c.file)}" alt="${esc(t.name)} 封面（放大）"></figure>` : `<figure><figcaption class="err">${esc(t.name)} 封面没截到：${esc(c.error ?? '')}</figcaption></figure>`);
    }
    out.push('</div>');
  }
  if (sum.missing.size > 0) {
    out.push('<details open><summary>资源栈里没有、模板要过的贴图 ID（可选贴图缺失时引擎不记警告；按“新路径 → 旧路径”试的，缺了新路径而取到旧路径是正常的）</summary><ul>');
    for (const [id, who] of [...sum.missing.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(`<li><code>${esc(id)}</code> <span class="dim">${esc(who.join('、'))}</span></li>`);
    out.push('</ul></details>');
  }
  for (const t of report.templates) {
    out.push(`<h2 id="${esc(t.name)}">${esc(t.name)} · ${esc(t.title)}</h2>`, `<p class="dim">${esc(t.id)}@${esc(t.version)}，截于 ${esc(t.capturedAt)}</p>`);
    for (const sheet of t.sheets) {
      out.push(`<h3>${esc(sheet.aspect)}</h3>`);
      if (sheet.contact) out.push(`<p>联络图（每行一组参数、每列一个时刻）：</p><a href="${href(sheet.contact)}"><img class="sheet" src="${href(sheet.contact)}" alt="${esc(t.name)} ${esc(sheet.aspect)} 联络图"></a>`);
      if (sheet.detail) out.push(`<p>细节图（各帧不透明部分的外框，${sheet.detailScale !== null && sheet.detailScale >= 1 ? `放大 ${sheet.detailScale} 倍` : `缩小到 ${Math.round((sheet.detailScale ?? 1) * 100)}%`}）：</p><a href="${href(sheet.detail)}"><img class="sheet" src="${href(sheet.detail)}" alt="${esc(t.name)} ${esc(sheet.aspect)} 细节图"></a>`);
      out.push('<table class="frames">');
      for (const r of t.runs.filter((x) => x.aspect === sheet.aspect)) {
        const notes: string[] = [];
        if (r.error) notes.push(`<div class="err">出错：${esc(r.error)}</div>`);
        if (r.preview.status !== 'ready') notes.push(`<div class="err">预览：${esc(r.preview.status)}${r.preview.message ? ` ${esc(r.preview.message)}` : ''}</div>`);
        const warnings = [...new Set([...r.preview.warnings, ...r.warnings])];
        if (warnings.length) notes.push(`<details open><summary class="warn">警告 ${warnings.length}</summary><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`);
        if (r.missingTextures.length) notes.push(`<details><summary>缺的贴图 ${r.missingTextures.length}</summary><ul>${r.missingTextures.map((w) => `<li><code>${esc(w)}</code></li>`).join('')}</ul></details>`);
        const fontNotes = r.fonts.filter((f) => !f.found || f.skipped?.length);
        if (fontNotes.length) notes.push(`<details><summary class="warn">字体 ${fontNotes.length}</summary><ul>${fontNotes.map((f) => `<li><code>${esc(f.id)}</code> ${f.found ? `缺提供器：${esc((f.skipped ?? []).join('、'))}` : '资源栈里没有'}</li>`).join('')}</ul></details>`);
        const soundNotes = r.sounds.filter((x) => !x.found);
        if (soundNotes.length) notes.push(`<div class="warn">没有的音效：${soundNotes.map((x) => `<code>${esc(x.id)}</code>`).join(' ')}</div>`);
        if (r.engineLog.length || r.console.length) notes.push(`<details><summary class="warn">日志 ${r.engineLog.length + r.console.length}</summary><ul>${[...r.engineLog, ...r.console].map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>`);
        const head = `<td><b>${esc(r.paramSet.name)}</b><br><span class="dim">${esc(r.paramSet.key)}</span><br>时长 ${r.duration?.toFixed(2) ?? '—'} 秒${r.cutTime !== null ? `，剪辑点 ${r.cutTime.toFixed(2)} 秒` : ''}${notes.join('')}</td>`;
        const cells = r.shots.map(
          (s) =>
            `<td class="f">${s.file ? `<a href="${href(s.file)}"><img loading="lazy" src="${href(s.file)}" alt="${esc(r.paramSet.key)} ${esc(s.slot)}"></a>` : ''}<div class="cap">${esc(s.slot)} · ${s.t.toFixed(2)} 秒 · 第 ${s.index} 帧${s.coverage === 0 ? ' · 全透明' : ''}</div></td>`,
        );
        out.push(`<tr>${head}${cells.join('')}</tr>`);
      }
      out.push('</table>');
    }
  }
  out.push('</body></html>');
  return out.join('\n');
}

// ---------------------------------------------------------------- 驱动应用

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { _electron: electron } = await import('@playwright/test');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS' && k !== 'ELECTRON_RENDERER_URL') env[k] = v;
  Object.assign(env, {
    ALLAY_USER_DATA_DIR: userData,
    // 窗口不显示、不抢焦点
    ALLAY_E2E_HIDDEN: '1',
    ALLAY_E2E_HOOKS: '1',
    // 下载原版资源连一个没人监听的本机端口：绝不联网
    ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:9',
    // 探测本机游戏时不看 %APPDATA%\.minecraft：资源栈里只有设置文件里给的那一个来源
    ALLAY_E2E_GAME_APPDATA: join(userData, 'no-appdata'),
    // 悦灵用占位（和截图无关，少读一份图集）
    ALLAY_E2E_MASCOT_DIR: join(userData, 'no-mascot'),
  });
  const executablePath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath, args: [DESKTOP], env, cwd: DESKTOP });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(() => window.__allayTest !== undefined, undefined, { timeout: 60_000 });
  return { app, page };
}

async function closeApp(app: ElectronApplication): Promise<void> {
  const child = app.process();
  await Promise.race([app.close().catch(() => undefined), sleep(15_000)]);
  // 关不掉就直接结束进程：不能留一个 Electron 占着显卡
  if (child.exitCode === null && child.signalCode === null) child.kill();
}

/** 资源栈里确实接上了要的那一层（或者确实什么都没接）；不是就抛错，不截一堆占位图还当成功 */
function verifySource(state: ResourceState, expected: { layerId: string } | null): void {
  const layers = state.layers.map((l) => `${l.id}（${l.kind}${l.enabled ? '' : '，停用'}）`).join('、');
  if (!expected) {
    const extra = state.layers.filter((l) => l.kind !== 'builtin');
    if (extra.length > 0) throw new SourceError(`要的是没有原版素材，资源栈里却有：${extra.map((l) => l.id).join('、')}`);
    return;
  }
  const layer = state.layers.find((l) => l.id === expected.layerId);
  if (!layer || !layer.enabled || layer.kind !== 'vanilla' || state.vanilla.baseId !== expected.layerId) {
    const missing = state.vanilla.missingSources.map((m) => `${m.versionId}（${m.gameDir ?? m.kind}）`).join('、');
    throw new SourceError(
      `资源栈里没有接上 ${expected.layerId}。现在的层：${layers || '（无）'}；原版基底：${state.vanilla.baseId ?? '无'}；` + `问题：${state.vanilla.problem ?? '无'}${missing ? `；登记了但打不开的来源：${missing}` : ''}`,
    );
  }
}

class SourceError extends Error {
  override name = 'SourceError';
}

/** 切画幅：经界面的输出设置（右栏“输出”页的分辨率下拉框），和用户同一条路；切完核对工程的输出 */
async function setAspect(page: Page, aspect: Aspect): Promise<void> {
  const { width, height } = ASPECTS[aspect];
  const current = await page.evaluate(() => window.__allayTest!.output());
  if (current.width === width && current.height === height) return;
  try {
    await page.click('[data-testid="right-tab-output"]', { timeout: 15_000 });
    await page.click('[data-testid="output-resolution"]', { timeout: 15_000 });
    await page.getByRole('option', { name: new RegExp(`^${width}×${height}`) }).click({ timeout: 15_000 });
    await page.waitForFunction(([w, h]) => {
      const o = window.__allayTest!.output();
      return o.width === w && o.height === h;
    }, [width, height] as const, { timeout: 15_000 });
  } catch (error) {
    throw new Error(`切换画幅到 ${aspect} 失败（界面的输出设置找不到或没生效）：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

type PreviewResult = { status: string; warnings: string[]; message?: string };

/** 等预览装载完这一版工程：就绪且是最新的，或者出错、崩溃、无响应 */
async function waitPreview(page: Page): Promise<PreviewResult> {
  try {
    const handle = await page.waitForFunction(
      () => {
        const h = window.__allayTest!;
        const s = h.status();
        if (s.kind === 'ready' && h.previewUpToDate()) return { status: 'ready', warnings: s.warnings };
        if (s.kind === 'error') return { status: 'error', warnings: [], message: s.message };
        if (s.kind === 'crashed') return { status: 'crashed', warnings: [], message: s.message };
        if (s.kind === 'unresponsive') return { status: 'unresponsive', warnings: [], message: s.operation };
        return false;
      },
      undefined,
      { timeout: 60_000, polling: 100 },
    );
    return (await handle.jsonValue()) as PreviewResult;
  } catch {
    const s = await page.evaluate(() => window.__allayTest!.status());
    return { status: 'timeout', warnings: [], message: `60 秒内没有装载完（状态 ${s.kind}）` };
  }
}

interface Captured {
  run: RunRecord;
  /** 联络图的格子（已缩小）和这一帧在磁盘上的位置 */
  cells: ({ image: Rgba; caption: string; file: string } | null)[];
}

/** 一个模板、一组参数：选中、等预览、渲染各时刻、写文件 */
async function captureRun(page: Page, opts: ReviewOptions, entry: { id: string; version: string }, set: ParamSet, aspect: Aspect, outDir: string, dir: string, consoleSink: string[]): Promise<Captured> {
  const run: RunRecord = {
    aspect,
    paramSet: { key: set.key, name: set.name },
    params: {},
    output: { width: 0, height: 0, fps: 0 },
    preview: { status: 'not-loaded', warnings: [] },
    duration: null,
    cutTime: null,
    shots: [],
    warnings: [],
    missingTextures: [],
    foundTextures: [],
    fonts: [],
    sounds: [],
    engineLog: [],
    console: consoleSink,
    error: null,
  };
  const selected = await page.evaluate(([id, version, params]) => window.__allayTest!.selectTemplate(id, version, params as ParamValues), [entry.id, entry.version, set.params] as const);
  if (!selected) {
    run.error = '选不中这个模板（templates.read 没有返回）';
    return { run, cells: [] };
  }
  run.preview = await waitPreview(page);
  run.params = (await page.evaluate(() => window.__allayTest!.project().params)) as Record<string, unknown>;
  const output = await page.evaluate(() => window.__allayTest!.output());
  run.output = { width: output.width, height: output.height, fps: output.fps };
  let shots: Shot[] = [];
  if (run.preview.status === 'ready') {
    const transport = await page.evaluate(() => window.__allayTest!.transport());
    shots = pickShots(opts.shots, transport.duration, output.fps, transport.cutTime);
  }
  const res: ReviewFrames = await page.evaluate((times) => window.__allayTest!.reviewFrames(times), shots.map((s) => s.t));
  run.duration = res.duration;
  run.cutTime = res.cutTime;
  run.warnings = res.warnings;
  run.engineLog = res.log.map((l) => `${l.level}: ${l.message}`);
  run.error = res.error ? `${res.error.message}${res.error.code ? `（${res.error.code}）` : ''}` : run.preview.status === 'ready' ? null : `预览没有装载成功（${run.preview.status}）`;
  for (const r of res.resources) {
    if (r.kind === 'texture') (r.found ? run.foundTextures : run.missingTextures).push(r.id);
    else if (r.kind === 'font') run.fonts.push({ id: r.id, found: r.found, ...(r.skipped ? { skipped: r.skipped } : {}) });
    else if (r.kind === 'sound-meta') run.sounds.push({ id: r.id, found: r.found });
  }
  const scale = contactScale(res.width, res.height);
  const cells: Captured['cells'] = [];
  for (const shot of shots) {
    const frame = res.frames.find((f) => f.index === shot.index);
    if (!frame) {
      run.shots.push({ ...shot, file: null, coverage: null, bbox: null });
      cells.push(null);
      continue;
    }
    const file = `${basename(dir)}/${ASPECTS[aspect].slug}/${set.key}/${String(run.shots.length + 1).padStart(2, '0')}-${shot.slotId}.png`;
    const bytes = Buffer.from(frame.pngBase64, 'base64');
    mkdirSync(join(outDir, file, '..'), { recursive: true });
    writeFileSync(join(outDir, file), bytes);
    const img = decodePng(bytes);
    const stats = alphaStats(img);
    run.shots.push({ ...shot, file, coverage: Math.round(stats.coverage * 1e6) / 1e6, bbox: stats.bbox });
    cells.push({ image: resizeArea(img, Math.round(img.width * scale), Math.round(img.height * scale)), caption: `${shot.slot} · ${shot.t.toFixed(2)}s · #${shot.index}`, file });
  }
  return { run, cells };
}

/** 封面：默认参数，按 coverTime 取那一刻，渲染成 320 × 180（和模板库的封面同一条静帧路径、同样的尺寸） */
async function captureCover(page: Page, entry: { id: string; version: string } | undefined, outDir: string, name: string, set: Readonly<Record<string, unknown>>): Promise<NonNullable<ReportTemplate['cover']>> {
  const miss = (error: string, t: number | null = null) => ({ file: null, t, coverage: null, error });
  if (!entry) return miss('应用里没有这个模板');
  const selected = await page.evaluate(([id, version, params]) => window.__allayTest!.selectTemplate(id, version, params as ParamValues), [entry.id, entry.version, set] as const);
  if (!selected) return miss('选不中这个模板');
  const preview = await waitPreview(page);
  if (preview.status !== 'ready') return miss(`预览没有装载成功（${preview.status}${preview.message ? ` ${preview.message}` : ''}）`);
  const transport = await page.evaluate(() => window.__allayTest!.transport());
  const t = coverTime(transport.duration, transport.cutTime);
  const res: ReviewFrames = await page.evaluate(([times, edge]) => window.__allayTest!.reviewFrames(times, edge), [[t], COVER.width] as [number[], number]);
  const frame = res.frames[0];
  if (res.error || !frame) return miss(res.error?.message ?? '没有渲染出帧', t);
  const file = `${name}/cover.png`;
  mkdirSync(join(outDir, name), { recursive: true });
  const bytes = Buffer.from(frame.pngBase64, 'base64');
  writeFileSync(join(outDir, file), bytes);
  return { file, t, coverage: Math.round(alphaStats(decodePng(bytes)).coverage * 1e6) / 1e6, error: null };
}

/** 一个模板、一种画幅的联络图和细节图 */
function writeSheets(outDir: string, tpl: ReportTemplate, aspect: Aspect, captured: readonly Captured[], text: TextRenderer, label: string): ReportTemplate['sheets'][number] {
  const { width, height, slug } = ASPECTS[aspect];
  const scale = contactScale(width, height);
  const cellW = Math.round(width * scale);
  const cellH = Math.round(height * scale);
  const rowLabel = (r: RunRecord): SheetLine[] => {
    const warnings = new Set([...r.preview.warnings, ...r.warnings]).size;
    return [
      { text: r.paramSet.name, rgb: [235, 235, 235] },
      { text: r.paramSet.key, rgb: [150, 150, 150] },
      { text: `时长 ${r.duration?.toFixed(2) ?? '—'}s${r.cutTime !== null ? ` · 剪辑点 ${r.cutTime.toFixed(2)}s` : ''}`, rgb: [190, 190, 190] },
      r.error ? { text: `出错：${r.error}`, rgb: [255, 122, 122] } : { text: `警告 ${warnings} · 缺贴图 ${r.missingTextures.length}`, rgb: warnings > 0 ? [255, 207, 102] : [150, 150, 150] },
    ];
  };
  const title = `${tpl.name} · ${tpl.title} · ${label} · ${aspect} · ${width}×${height}`;
  const contact = composeSheet(title, cellW, cellH, captured.map((c) => ({ label: rowLabel(c.run), cells: c.cells })), text);
  const contactFile = `${tpl.name}/contact-${slug}.png`;
  writeFileSync(join(outDir, contactFile), encodePng(contact));
  // 细节图：所有帧不透明部分的外框（四周留 8 像素），同一块区域裁出来并排
  const box = unionBBox(captured.flatMap((c) => c.run.shots.map((s) => s.bbox)));
  if (!box) return { aspect, contact: contactFile, detail: null, detailScale: null };
  const region = padBBox(box, 8, width, height);
  const k = detailScale(region.width, region.height);
  const rows: SheetRow[] = captured.map((c) => ({
    label: rowLabel(c.run),
    cells: c.cells.map((cell) => (cell ? { image: scaleBy(crop(decodePng(readFileSync(join(outDir, cell.file))), region), k), caption: cell.caption } : null)),
  }));
  const detail = composeSheet(`${title} · 区域 (${region.x}, ${region.y}) ${region.width}×${region.height} · ×${compact(k)}`, Math.round(region.width * k), Math.round(region.height * k), rows, text, DETAIL_MAX_WIDTH);
  const detailFile = `${tpl.name}/detail-${slug}.png`;
  writeFileSync(join(outDir, detailFile), encodePng(detail));
  return { aspect, contact: contactFile, detail: detailFile, detailScale: k };
}

function gitInfo(): { commit: string | null; dirty: boolean | null } {
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  return { commit: head.status === 0 ? head.stdout.trim() : null, dirty: status.status === 0 ? status.stdout.trim().length > 0 : null };
}

// ---------------------------------------------------------------- 主流程

export async function main(argv: readonly string[]): Promise<number> {
  let opts: ReviewOptions;
  let dirs: string[];
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      console.log(usage());
      return 0;
    }
    dirs = selectTemplateDirs(opts.templates);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${TAG} ${error.message}\n\n${usage()}`);
    return 2;
  }
  const source = opts.source!;
  const problems = checkBuild(dirs);
  if (problems.length > 0) {
    console.error(`${TAG} 构建产物缺失或比源码旧，不能截图（不会悄悄用旧产物）：\n${problems.map((p) => `  - ${p}`).join('\n')}\n先运行 pnpm build，再重跑。`);
    return 2;
  }

  // 原版来源：先问应用自己的版本识别认不认这个目录
  let mirror: Mirror | null = null;
  let vanilla: { gameDir: string; versionId: string } | null = null;
  if (source.kind === 'local') {
    const check = await checkVersion(source.gameDir, source.versionDir);
    if (check.ok) vanilla = { gameDir: source.gameDir, versionId: source.versionDir };
    else if (check.nameRejected && opts.mirror) {
      mirror = createMirror(source.gameDir, source.versionDir);
      vanilla = { gameDir: mirror.gameDir, versionId: mirror.versionId };
      console.log(`${TAG} ${check.reason}\n${TAG} --mirror：在 ${mirror.gameDir} 建了镜像，以 ${mirror.versionId} 接入（jar ${mirror.jar === 'hardlink' ? '硬链接' : '复制'}，assets ${mirror.assets ? '联接' : '没有'}）`);
    } else {
      console.error(`${TAG} 应用认不了这个版本：${check.reason}${check.nameRejected ? '\n加 --mirror 可以在临时目录里建一个镜像游戏目录接入同一个 jar（不改应用的识别逻辑，见 docs/review/templates/README.md）。' : ''}`);
      return 3;
    }
  }
  const expectedLayer = vanilla ? { layerId: vanillaLayerId({ kind: 'local', gameDir: vanilla.gameDir, versionId: vanilla.versionId }) } : null;

  const label = outLabel(source, opts.lang, opts.set);
  const outDir = opts.out ?? join(DEFAULT_OUT_ROOT, label);
  let previous: ReportFile | null;
  try {
    previous = readPreviousReport(outDir);
    if (previous && (previous.sourceKey !== sourceKey(source) || previous.lang !== opts.lang || !sameSet(previous.set, opts.set))) {
      throw new UsageError(`输出目录 ${outDir} 里是另一个来源、语言或 --set 的结果（${previous.label}，${previous.lang}）；换一个 --out，或者先删掉那个目录`);
    }
  } catch (error) {
    if (mirror) removeMirror(mirror.gameDir);
    if (!(error instanceof UsageError)) throw error;
    console.error(`${TAG} ${error.message}`);
    return 2;
  }
  mkdirSync(outDir, { recursive: true });

  const userData = mkdtempSync(join(tmpdir(), 'allay-review-'));
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(seedSettings(vanilla, opts.lang)));
  let app: ElectronApplication | null = null;
  const cleanup = async () => {
    if (app) await closeApp(app);
    app = null;
    if (mirror) removeMirror(mirror.gameDir);
    mirror = null;
    rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  };
  const onSignal = () => {
    void cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let failed = 0;
  try {
    console.log(`${TAG} 启动应用（窗口不显示，数据目录 ${userData}）`);
    const launched = await launch(userData);
    app = launched.app;
    const page = launched.page;
    let sink: string[] = [];
    page.on('console', (m) => {
      if ((m.type() === 'warning' || m.type() === 'error') && sink.length < 100) sink.push(`${m.type()}: ${m.text().slice(0, 500)}`);
    });
    page.on('pageerror', (e) => {
      if (sink.length < 100) sink.push(`pageerror: ${e.message.slice(0, 500)}`);
    });
    await page.waitForFunction(
      () => {
        const s = window.__allayTest!.resourceState();
        return s !== null && !s.detecting;
      },
      undefined,
      { timeout: 60_000 },
    );
    const state = (await page.evaluate(() => window.__allayTest!.resourceState()))!;
    try {
      verifySource(state, expectedLayer);
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      console.error(`${TAG} ${error.message}`);
      return 3;
    }
    const layer = expectedLayer ? state.layers.find((l) => l.id === expectedLayer.layerId) : undefined;
    const reportSource: ReportSource =
      source.kind === 'none' || !vanilla || !expectedLayer
        ? { kind: 'none' }
        : {
            kind: 'local',
            gameDir: source.gameDir,
            versionDir: source.versionDir,
            layerId: expectedLayer.layerId,
            versionId: vanilla.versionId,
            resourceFormat: layer?.resourceFormat ?? null,
            hasAssetIndex: layer?.hasAssetIndex ?? null,
            mirror,
          };
    console.log(`${TAG} 资源栈：${state.layers.map((l) => `${l.id}${l.enabled ? '' : '（停用）'}`).join('、')}`);
    const appBuilt = stampOf(join(ROOT, APP_OUTPUTS[0]!)).mtimeMs;
    const base: Omit<ReportFile, 'templates' | 'updatedAt'> = {
      tool: 'review:templates',
      formatVersion: 1,
      sourceKey: sourceKey(source),
      label,
      lang: opts.lang,
      set: opts.set,
      source: reportSource,
      build: { ...gitInfo(), appBuiltAt: appBuilt === null ? null : new Date(appBuilt).toISOString() },
      layers: state.layers.map((l) => ({
        id: l.id,
        kind: l.kind,
        name: l.name,
        enabled: l.enabled,
        ...(l.versionId ? { versionId: l.versionId } : {}),
        ...(l.resourceFormat ? { resourceFormat: l.resourceFormat } : {}),
        ...(l.hasAssetIndex !== undefined ? { hasAssetIndex: l.hasAssetIndex } : {}),
        ...(l.base !== undefined ? { base: l.base } : {}),
      })),
    };

    const entries = await page.evaluate(() => window.__allayTest!.templates());
    const text = unifontRenderer(parseUnifontOtf(new Uint8Array(readFileSync(join(ROOT, 'resources', ...EMBEDDED_UNIFONT_FILE)))));
    const done = new Map<string, ReportTemplate>();
    const writeReport = () => {
      const merged = mergeReport(previous, { ...base, updatedAt: new Date().toISOString(), templates: [...done.values()] });
      writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(merged, null, 2)}\n`);
      writeFileSync(join(outDir, 'index.html'), renderIndex(merged));
    };
    const total = dirs.reduce((n, d) => n + paramSetsOf(readTemplateManifest(d), opts.presets, opts.lang, opts.set).length, 0) * opts.aspects.length;
    const templateOf = (dir: string): ReportTemplate => {
      const name = basename(dir);
      let tpl = done.get(name);
      if (!tpl) {
        // 这个模板上一次的输出整个换掉
        rmSync(join(outDir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        const manifest = readTemplateManifest(dir);
        tpl = { name, id: manifest.id, version: manifest.version, title: localize(manifest.name, opts.lang), capturedAt: new Date().toISOString(), runs: [], sheets: [] };
        done.set(name, tpl);
      }
      return tpl;
    };
    const entryOf = (dir: string) => {
      const manifest = readTemplateManifest(dir);
      return entries.find((e) => e.id === manifest.id && e.version === manifest.version);
    };
    if (opts.cover) {
      // 模板库的封面总是 16:9，不随工程的画幅变
      await setAspect(page, '16:9');
      const cells: SheetRow['cells'] = [];
      for (const dir of dirs) {
        const tpl = templateOf(dir);
        sink = [];
        tpl.cover = await captureCover(page, entryOf(dir), outDir, tpl.name, opts.set);
        if (tpl.cover.error) failed++;
        cells.push(tpl.cover.file ? { image: decodePng(readFileSync(join(outDir, tpl.cover.file))), caption: `${tpl.name} · ${tpl.cover.t?.toFixed(2)}s` } : null);
        console.log(`${TAG} 封面 ${tpl.name}：${tpl.cover.file ? `${tpl.cover.t?.toFixed(2)} 秒` : `没截到（${tpl.cover.error}）`}`);
      }
      const rows: SheetRow[] = [];
      for (let i = 0; i < cells.length; i += 4) rows.push({ label: [], cells: cells.slice(i, i + 4) });
      writeFileSync(join(outDir, 'covers.png'), encodePng(composeSheet(`封面 · ${label} · ${COVER.width}×${COVER.height}`, COVER.width, COVER.height, rows, text)));
      writeReport();
    }
    let n = 0;
    for (const aspect of opts.aspects) {
      await setAspect(page, aspect);
      for (const dir of dirs) {
        const name = basename(dir);
        const manifest = readTemplateManifest(dir);
        const entry = entryOf(dir);
        const tpl = templateOf(dir);
        if (!entry) {
          failed++;
          console.error(`${TAG} 应用里没有 ${manifest.id}@${manifest.version}（构建了却没装上？看应用日志）`);
          tpl.runs.push({ ...emptyRun(aspect, opts.lang), error: `应用里没有 ${manifest.id}@${manifest.version}` });
          writeReport();
          continue;
        }
        const captured: Captured[] = [];
        for (const set of paramSetsOf(entry.manifest, opts.presets, opts.lang, opts.set)) {
          n++;
          sink = [];
          const c = await captureRun(page, opts, entry, set, aspect, outDir, dir, sink);
          captured.push(c);
          tpl.runs.push(c.run);
          if (c.run.error) failed++;
          const warnings = new Set([...c.run.preview.warnings, ...c.run.warnings]).size;
          console.log(
            `${TAG} [${n}/${total}] ${aspect} ${name} ${set.key}：${c.run.shots.filter((s) => s.file).length} 张，警告 ${warnings}，缺贴图 ${c.run.missingTextures.length}${c.run.error ? `，出错：${c.run.error}` : ''}`,
          );
        }
        tpl.sheets.push(writeSheets(outDir, tpl, aspect, captured, text, label));
        writeReport();
      }
    }
    const end = (await page.evaluate(() => window.__allayTest!.resourceState()))!;
    if (end.stamp !== state.stamp) console.warn(`${TAG} 注意：截图期间资源栈变过（stamp ${state.stamp} → ${end.stamp}）`);
    writeReport();
    const merged = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as ReportFile;
    const sum = summarize([...done.values()]);
    console.log(
      [
        `${TAG} 完成：${done.size} 个模板、${sum.runs} 组参数、${sum.frames} 张；有警告的 ${sum.runsWithWarnings} 组，出错的 ${sum.errors} 组；缺的贴图 ID ${sum.missing.size} 个。`,
        `${TAG} 输出：${outDir}（index.html、report.json；报告里共 ${merged.templates.length} 个模板）`,
        `${TAG} 这些图含原版贴图的派生图像：不提交、不外传。`,
      ].join('\n'),
    );
    return failed > 0 ? 4 : 0;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await cleanup();
  }
}

function emptyRun(aspect: Aspect, lang: Lang): RunRecord {
  return {
    aspect,
    paramSet: { key: 'default', name: lang === 'zh-CN' ? '默认参数' : 'Defaults' },
    params: {},
    output: { width: 0, height: 0, fps: 0 },
    preview: { status: 'not-loaded', warnings: [] },
    duration: null,
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
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`${TAG} ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 1;
    },
  );
}
