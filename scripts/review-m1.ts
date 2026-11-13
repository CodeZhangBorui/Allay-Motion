// pnpm review:m1：为人工确认 H-M1 准备材料（docs/review/M1/README.md）。需要先 pnpm build 和 pnpm ffmpeg:fetch。
//
// 1. 以后台方式（窗口不显示）启动应用，经真实的导出对话框把临时模板按 1080p60、标准画质导出成 ProRes 4444 MOV，
//    写到 docs/review/M1/out/（被 .gitignore 忽略，不提交）。
// 2. 取几个关键帧：左边是预览画布的截图（盖在棋盘格上），右边是导出的 MOV 解码回来、盖在同样棋盘格上的同一帧。
//    并排存成 docs/review/M1/m1-frame-<n>.png。
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const REVIEW = join(ROOT, 'docs/review/M1');
const OUT = join(REVIEW, 'out');
const FF = join(ROOT, 'resources/ffmpeg', `${process.platform}-${process.arch}`, 'ffmpeg.exe');
const FPS = 60;
/** 首帧、进入中途、剪辑点、退出中途、末帧前一帧 */
const FRAMES = [0, 14, 33, 50, 62];

function ff(args: string[]): void {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const userData = mkdtempSync(join(tmpdir(), 'allay-review-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { ALLAY_USER_DATA_DIR: userData, ALLAY_E2E_HIDDEN: '1', ALLAY_E2E_HOOKS: '1', ALLAY_E2E_EXPORT_TARGET: OUT, ALLAY_FFMPEG: FF });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForFunction(() => window.__allayTest?.status().kind === 'ready', undefined, { timeout: 20_000 });

    // 1. 导出
    await page.getByTestId('topbar-export').click();
    await page.getByTestId('export-start').click();
    await page.getByTestId('export-result').and(page.locator('[data-kind="done"]')).waitFor({ timeout: 60_000 });
    const mov = (await page.getByTestId('export-path').textContent())!;
    await page.getByTestId('export-close').click();
    console.log(`[review:m1] MOV：${mov}`);

    // 2. 关键帧：预览截图 vs 导出回读
    const stage = page.getByTestId('preview-stage');
    for (const n of FRAMES) {
      await page.evaluate((t) => window.__allayTest!.setTime(t), n / FPS);
      await page.waitForTimeout(300);
      const shot = join(OUT, `preview-${n}.png`);
      const box = (await stage.boundingBox())!;
      // 窗口不显示：用 capturePage 截页面（docs/decisions.md“测试在后台运行”）
      const png = await app.evaluate(async ({ BrowserWindow }, rect) => {
        const img = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(rect);
        return img.toPNG().toString('base64');
      }, { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
      writeFileSync(shot, Buffer.from(png, 'base64'));
      const probe = spawnSync(FF.replace(/ffmpeg\.exe$/, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', shot], { encoding: 'utf8', windowsHide: true });
      const [w, h] = probe.stdout.trim().split(',').map(Number) as [number, number];
      // 右半边：同样的棋盘格（#2a2a2a/#3a3a3a，16 px 格子按截图缩放）上叠导出的第 n 帧
      const cell = Math.max(1, Math.round((16 * w) / box.width));
      ff([
        '-i', shot,
        '-i', mov,
        '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h},format=gray`,
        '-filter_complex',
        `[2:v]geq=lum='if(mod(floor(X/${cell})+floor(Y/${cell}),2),58,42)',format=rgba[bg];` +
          `[1:v]select='eq(n,${n})',setpts=PTS-STARTPTS,scale=${w}:${h}:flags=bicubic,format=rgba[fg];` +
          `[bg][fg]overlay=format=auto,format=rgb24[exp];[0:v]format=rgb24[pre];[pre][exp]hstack=inputs=2`,
        '-frames:v', '1',
        join(REVIEW, `m1-frame-${String(n).padStart(2, '0')}.png`),
      ]);
      rmSync(shot);
    }
    console.log(`[review:m1] 截图在 ${REVIEW}`);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
