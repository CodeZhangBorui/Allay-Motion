import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
export async function launchApp(userDataDir: string): Promise<Launched> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  }
  env.ALLAY_USER_DATA_DIR = userDataDir;
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

