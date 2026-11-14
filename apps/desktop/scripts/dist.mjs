// pnpm --filter @allay/desktop dist 的打包一步：按当前机器选 electron-builder 的平台和架构（docs/decisions.md“macOS 构建”）。
//
//   Windows：--win --x64（与原来写死在 package.json 里的命令完全相同）
//   macOS：  --mac --arm64 或 --mac --x64（跟当前机器的架构；每个架构在自己的机器上构建，打包用的 Electron 是工作区里装的那一份）
//
// 其余参数固定：--publish never --config electron-builder.yml。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} platform @param {string} arch */
export function platformArgs(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return ['--win', '--x64'];
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return ['--mac', `--${arch}`];
  throw new Error(`不支持在 ${platform}-${arch} 上打包（只做 Windows x64 和 macOS arm64、x64）`);
}

function main() {
  const cli = createRequire(join(DESKTOP, 'package.json')).resolve('electron-builder/cli.js');
  const args = [...platformArgs(process.platform, process.arch), '--publish', 'never', '--config', 'electron-builder.yml'];
  process.stdout.write(`dist: electron-builder ${args.join(' ')}\n`);
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: DESKTOP, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
