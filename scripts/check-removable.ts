// “可拆除”检查（docs/code-editing-and-mcp-plan.md 3.1 第 5 条；T-DEV-4）：把 packages/optional 整个挪走
// （--mode=empty 时换成一个空目录），在这个状态下跑完整的 pnpm check，证明主程序不依赖任何可选模块。
// 跑完（无论成败、包括 Ctrl+C）把目录和 lockfile 原样放回。CI 在 pnpm check 之后跑它。
//
// 目录里有模块时，挪走后先用 pnpm install --offline 刷新依赖（不联网：包都已经在本机的 store 里），
// 放回后再按原来的 lockfile 装一次。现在 packages/optional 下没有模块，这两步都是空操作。
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OPTIONAL = join(ROOT, 'packages', 'optional');
const LOCKFILE = join(ROOT, 'pnpm-lock.yaml');

export type RemovableMode = 'missing' | 'empty';

/** packages/optional 下的模块目录（README 之类的文件不算） */
export function optionalModuleDirs(dir = OPTIONAL): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function move(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    // 跨盘时 rename 不行：复制再删
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function run(cmd: string, args: string[]): number {
  console.log(`[check:removable] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
  return r.status ?? 1;
}

export function main(argv: string[]): number {
  const mode: RemovableMode = argv.includes('--mode=empty') ? 'empty' : 'missing';
  const modules = optionalModuleDirs();
  const stash = mkdtempSync(join(tmpdir(), 'allay-optional-'));
  const saved = join(stash, 'optional');
  const lock = readFileSync(LOCKFILE);
  const had = existsSync(OPTIONAL);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    rmSync(OPTIONAL, { recursive: true, force: true });
    if (had) move(saved, OPTIONAL);
    writeFileSync(LOCKFILE, lock);
    rmSync(stash, { recursive: true, force: true });
    console.log('[check:removable] packages/optional 已放回');
  };
  const onSignal = () => {
    restore();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    if (had) move(OPTIONAL, saved);
    if (mode === 'empty') mkdirSync(OPTIONAL);
    console.log(`[check:removable] packages/optional ${mode === 'empty' ? '换成空目录' : '已移走'}（原有模块：${modules.length > 0 ? modules.join('、') : '无'}）`);
    if (modules.length > 0 && run('pnpm', ['install', '--offline', '--no-frozen-lockfile']) !== 0) return 1;
    const code = run('pnpm', ['check']);
    console.log(`[check:removable] packages/optional ${mode === 'empty' ? '为空' : '不存在'}时 pnpm check ${code === 0 ? '通过' : `失败（${code}）`}`);
    return code;
  } finally {
    restore();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (modules.length > 0) run('pnpm', ['install', '--offline', '--frozen-lockfile']);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
