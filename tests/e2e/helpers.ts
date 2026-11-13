import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const ROOT = resolve(import.meta.dirname, '../..');
export const DESKTOP_DIR = join(ROOT, 'apps/desktop');

const requireFromDesktop = createRequire(join(DESKTOP_DIR, 'package.json'));
/** electron 包导出的是可执行文件路径 */
export const ELECTRON_PATH = requireFromDesktop('electron') as string;

export function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'allay-e2e-'));
}

/** Electron 的子进程退出得比 app.close() 晚一点，删除时重试；实在删不掉就留在临时目录 */
export function removeUserDataDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch {
    // 临时目录，系统会清理
  }
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
}

/** 启动构建好的应用（apps/desktop/out），用独立的数据目录 */
export async function launchApp(userDataDir: string, extraEnv: Record<string, string> = {}): Promise<Launched> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  }
  env.ALLAY_USER_DATA_DIR = userDataDir;
  // 窗口不显示、不抢焦点：测试不能影响用户的前台操作
  env.ALLAY_E2E_HIDDEN = '1';
  // 渲染进程装上测试钩子（只在未打包时生效）
  env.ALLAY_E2E_HOOKS = '1';
  Object.assign(env, extraEnv);
  const app = await electron.launch({ executablePath: ELECTRON_PATH, args: [DESKTOP_DIR], env, cwd: DESKTOP_DIR });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar"]');
  return { app, page };
}

export function readMainLog(userDataDir: string): string {
  try {
    return readFileSync(join(userDataDir, 'logs', 'main.log'), 'utf8');
  } catch {
    return '';
  }
}


/** 固定版本的 FFmpeg（pnpm ffmpeg:fetch）；不在就明确失败 */
export const PINNED_FFMPEG = join(ROOT, 'resources', 'ffmpeg', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
export function requirePinnedFfmpeg(): string {
  if (!existsSync(PINNED_FFMPEG)) throw new Error(`找不到 ${PINNED_FFMPEG}。先运行 pnpm ffmpeg:fetch。`);
  return PINNED_FFMPEG;
}

export function readFixture(name: string): string {
  return readFileSync(join(ROOT, 'tests', 'fixtures', 'templates', name), 'utf8');
}
