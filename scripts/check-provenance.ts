// 素材来源登记检查（docs/09-compliance.md 9.6）。CI 里运行。
//
// 1. 仓库里的每个图片、音频、字体、压缩包都必须被 ASSETS_PROVENANCE.json 的某条记录覆盖。
// 2. 拒绝：路径里有 assets/minecraft/ 却不在 resources/builtin-pack/ 或测试夹具目录下；扩展名为 .jar。
// 3. origin 为 generated 的记录：重新运行生成器，产物必须与仓库里的文件逐字节相同
//    （这样“与原版贴图同名、内容却不是生成脚本产出的”文件过不了）。
//    生成器约定：以环境变量 ALLAY_GEN_OUT=<临时目录> 运行时，把产物按仓库相对路径写进那个目录。
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import picomatch from 'picomatch';
import { z } from 'zod';

export const BINARY_EXTENSIONS = new Set([
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'svg', 'tga', 'tif', 'tiff', 'psd', 'avif',
  // 音频
  'ogg', 'oga', 'wav', 'mp3', 'flac', 'm4a', 'aac', 'opus',
  // 视频
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'gif',
  // 字体
  'ttf', 'otf', 'woff', 'woff2', 'ttc', 'fnt', 'bdf',
  // 压缩包与模型
  'zip', 'jar', '7z', 'rar', 'gz', 'tgz', 'tar', 'xz', 'mcpack', 'mcworld', 'allaytpl', 'nbt', 'schem', 'litematic', 'obj', 'glb', 'gltf', 'bbmodel',
]);

const EntrySchema = z.discriminatedUnion('origin', [
  z.strictObject({
    path: z.string().min(1),
    origin: z.literal('generated'),
    generator: z.string().min(1),
    license: z.string().min(1),
    note: z.string().optional(),
  }),
  z.strictObject({
    path: z.string().min(1),
    origin: z.literal('third-party'),
    source: z.url(),
    author: z.string().min(1),
    license: z.string().min(1),
    note: z.string().optional(),
  }),
  // 项目自己做的、无法由脚本重新生成的文件（比如评审截图）
  z.strictObject({
    path: z.string().min(1),
    origin: z.literal('original'),
    author: z.string().min(1),
    license: z.string().min(1),
    note: z.string().optional(),
  }),
]);
export const ProvenanceSchema = z.array(EntrySchema);
export type ProvenanceEntry = z.infer<typeof EntrySchema>;

/** 测试夹具目录：只放脚本生成的假数据 */
const FIXTURE_DIRS = ['tests/fixtures/'];
const BUILTIN_PACK = 'resources/builtin-pack/';

export function isBinaryAsset(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

export interface ProvenanceProblem {
  path: string;
  problem: string;
}

/** 不依赖文件系统的检查：覆盖、禁止的路径和扩展名 */
export function checkFiles(files: readonly string[], entries: readonly ProvenanceEntry[]): ProvenanceProblem[] {
  const problems: ProvenanceProblem[] = [];
  const matchers = entries.map((e) => ({ entry: e, match: picomatch(e.path, { dot: true }) }));
  for (const raw of files) {
    const path = raw.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    if (lower.endsWith('.jar')) {
      problems.push({ path, problem: '不允许 .jar 文件（9.6）' });
      continue;
    }
    if (lower.includes('assets/minecraft/') && !lower.startsWith(BUILTIN_PACK) && !FIXTURE_DIRS.some((d) => lower.startsWith(d))) {
      problems.push({ path, problem: 'assets/minecraft/ 只能出现在 resources/builtin-pack/ 或测试夹具目录下（9.6）' });
      continue;
    }
    if (!isBinaryAsset(path)) continue;
    const covering = matchers.find((m) => m.match(path));
    if (!covering) {
      problems.push({ path, problem: '没有被 ASSETS_PROVENANCE.json 的任何记录覆盖（9.6）' });
      continue;
    }
    if (lower.startsWith(BUILTIN_PACK) && covering.entry.origin !== 'generated') {
      problems.push({ path, problem: '内置素材包里的文件必须由生成脚本产出（origin: generated）' });
    }
  }
  return problems;
}

/** 记录本身是否有用：一条不覆盖任何文件的记录多半是笔误 */
export function findUnusedEntries(files: readonly string[], entries: readonly ProvenanceEntry[]): ProvenanceEntry[] {
  return entries.filter((e) => {
    const match = picomatch(e.path, { dot: true });
    return !files.some((f) => match(f.replace(/\\/g, '/')));
  });
}

/**
 * 重新生成并逐字节比对。generate(outDir) 运行生成器，把产物写进 outDir。
 */
export function verifyGenerated(
  root: string,
  files: readonly string[],
  entries: readonly ProvenanceEntry[],
  generate: (generator: string, outDir: string) => void,
): ProvenanceProblem[] {
  const problems: ProvenanceProblem[] = [];
  const generators = new Map<string, ProvenanceEntry[]>();
  for (const e of entries) {
    if (e.origin !== 'generated') continue;
    generators.set(e.generator, [...(generators.get(e.generator) ?? []), e]);
  }
  for (const [generator, group] of generators) {
    const covered = files.filter((f) => isBinaryAsset(f) && group.some((e) => picomatch(e.path, { dot: true })(f)));
    if (covered.length === 0) continue;
    const out = mkdtempSync(join(tmpdir(), 'allay-provenance-'));
    try {
      generate(generator, out);
      for (const file of covered) {
        const regenerated = join(out, file);
        if (!existsSync(regenerated)) {
          problems.push({ path: file, problem: `重新运行 ${generator} 没有产出这个文件` });
        } else if (!readFileSync(regenerated).equals(readFileSync(join(root, file)))) {
          problems.push({ path: file, problem: `与重新运行 ${generator} 的产物不一致` });
        }
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
  return problems;
}

/** git 跟踪的文件，加上未被忽略的新文件 */
export function listRepoFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return [...new Set(out.split('\0').filter(Boolean))].filter((f) => existsSync(join(root, f))).sort();
}

function runGenerator(root: string, generator: string, outDir: string): void {
  const env = { ...process.env, ALLAY_GEN_OUT: outDir };
  if (generator.startsWith('pnpm ')) {
    // generator 来自仓库里受版本控制的登记文件，只允许简单的脚本名
    if (!/^pnpm [\w:-]+$/.test(generator)) throw new Error(`unsupported generator command: ${generator}`);
    execSync(generator, { cwd: root, env, stdio: 'inherit' });
  } else {
    execFileSync(process.execPath, ['--import', 'tsx', generator], { cwd: root, env, stdio: 'inherit' });
  }
}

function main(): void {
  const root = process.cwd();
  const manifest = join(root, 'ASSETS_PROVENANCE.json');
  const entries = ProvenanceSchema.parse(JSON.parse(readFileSync(manifest, 'utf8')));
  const files = listRepoFiles(root);
  const problems = [
    ...checkFiles(files, entries),
    ...findUnusedEntries(files, entries).map((e) => ({ path: e.path, problem: 'ASSETS_PROVENANCE.json 里的这条记录不覆盖任何文件' })),
  ];
  if (problems.length === 0) {
    problems.push(...verifyGenerated(root, files, entries, (g, out) => runGenerator(root, g, out)));
  }
  const binaries = files.filter(isBinaryAsset).length;
  console.log(`check-provenance: ${files.length} 个文件，其中 ${binaries} 个二进制素材，${entries.length} 条登记`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ✗ ${p.path}: ${p.problem}`);
    process.exit(1);
  }
  console.log('check-provenance: 全部有来源登记');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
