import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-ARC-7（打包后）：启动画面 0.5 秒内出现；3 秒内主界面可交互（docs/01-product-architecture.md 1.11）。
//
// 怎么量（docs/decisions.md M8“冷启动的测量”）：
// - 打包后的应用不认任何测试开关，窗口照常显示。为了不在用户正在用的桌面上弹窗、抢焦点，用 scripts/hidden-desktop.ps1
//   在同一个窗口站里另建一个桌面，把 exe 放到那里启动（窗口、显卡照常工作，只是不在当前桌面上）。
// - 有任何 AllayMotion.exe 在运行时拒绝测量（会变成它的第二实例，数据目录也正被它占着）。
// - 打包后的应用写的是真正的 %APPDATA%\AllayMotion。原来有的话先改名放到一边，量完删掉测试写的、再改回来；
//   上次没能改回来（留着备份）时拒绝运行，不碰它。
// - 时间都从“测试调用 CreateProcess 的那一刻”算起，到应用日志里的 [startup] 记录（主进程按 performance.timeOrigin 记，
//   换算成墙上时间）：splash-shown 是启动画面的第一帧画出来（ready-to-show），可交互是界面就绪（renderer-ready：
//   首屏画完、初始模板装好）和主窗口显示（window-shown）两者中较晚的那个。
// - 预算怎么判（偏离，docs/decisions.md M8）：可交互按 CreateProcess 算，每次都要在 3 秒内；启动画面按“进程启动”
//   （Node 的 timeOrigin）算，取中位数和 0.5 秒比。CreateProcess 到进程启动之间是系统装载 250 MB 的 exe（安装后第一次
//   还有杀毒扫描），不是应用能改的；两种算法的数字都打印出来，写进记录。
// - 跑 RUNS 次。第一次是全新的数据目录（第一次启动）；文件缓存只能是热的（没法在测试里重启机器），这一点照实写进记录。

const ROOT = resolve(import.meta.dirname, '../..');
const EXE = join(ROOT, 'apps/desktop/release/win-unpacked/AllayMotion.exe');
const HIDDEN_DESKTOP = join(ROOT, 'scripts/hidden-desktop.ps1');
const RUNS = 5;
const SPLASH_BUDGET_MS = 500;
/**
 * 只记数字、不按预算判定（docs/decisions.md M8）：发版工作流在 GitHub 的共享 Windows 机器上跑，它不是规格说的参考机器，
 * 速度也不稳定。只有那里设这个变量；本机或参考机器上跑 pnpm dist 时照常按预算判定。
 */
const REPORT_ONLY = process.env.ALLAY_T_ARC_7_REPORT_ONLY === '1';
const INTERACTIVE_BUDGET_MS = 3000;

const APPDATA = process.env.APPDATA ?? '';
const USER_DATA = join(APPDATA, 'AllayMotion');
const BACKUP = `${USER_DATA}.t-arc-7-backup`;

interface Run {
  splashMs: number;
  /** 从进程启动算的启动画面时间 */
  splashFromStartMs: number;
  interactiveMs: number;
  /** 进程启动（Node 的 timeOrigin）距 CreateProcess 的时间：系统装载 exe 的部分 */
  loaderMs: number;
  marks: Record<string, number>;
}

function launchOnce(): Run {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', HIDDEN_DESKTOP, '-Exe', EXE, '-Seconds', '6'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`hidden-desktop.ps1 失败：${r.stderr || r.stdout}`);
  const started = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1)!) as { startedAt: string };
  const spawnedAt = Date.parse(started.startedAt);
  const log = readFileSync(join(USER_DATA, 'logs', 'main.log'), 'utf8');
  const processStart = /\[startup\] process started \{"at":"([^"]+)"\}/.exec(log);
  if (!processStart) throw new Error(`日志里没有启动记录：\n${log.slice(0, 2000)}`);
  const origin = Date.parse(processStart[1]!);
  const marks: Record<string, number> = {};
  for (const m of log.matchAll(/\[startup\] ([a-z-]+) \{"ms":(\d+)\}/g)) marks[m[1]!] = origin + Number(m[2]) - spawnedAt;
  for (const k of ['splash-shown', 'renderer-ready', 'window-shown']) if (marks[k] === undefined) throw new Error(`日志里没有 ${k}：\n${log.slice(0, 2000)}`);
  return { splashMs: marks['splash-shown']!, splashFromStartMs: marks['splash-shown']! - (origin - spawnedAt), interactiveMs: Math.max(marks['renderer-ready']!, marks['window-shown']!), loaderMs: origin - spawnedAt, marks };
}

/** 正在运行的本应用（任何位置的 AllayMotion.exe）：测量会成为它的第二实例、去碰用户的窗口和数据，所以这时不量 */
function runningInstances(): number {
  const r = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq AllayMotion.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  return (r.stdout.match(/"AllayMotion\.exe"/gi) ?? []).length;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe.runIf(process.platform === 'win32')('T-ARC-7 打包后的冷启动', () => {
  it(`启动画面 ${SPLASH_BUDGET_MS} ms 内出现，${INTERACTIVE_BUDGET_MS} ms 内主界面可交互`, () => {
    expect(existsSync(EXE), EXE).toBe(true);
    expect(APPDATA).not.toBe('');
    if (runningInstances() > 0) throw new Error('AllayMotion.exe 正在运行。关掉它再运行 T-ARC-7：测量会变成它的第二实例，并且要临时挪开它正在用的数据目录。');
    if (existsSync(BACKUP)) throw new Error(`上次测量留下了 ${BACKUP}（原来的用户数据）。请先确认并手动改回 ${USER_DATA}，再运行。`);
    const hadUserData = existsSync(USER_DATA);
    if (hadUserData) renameSync(USER_DATA, BACKUP);
    const runs: Run[] = [];
    try {
      for (let i = 0; i < RUNS; i++) {
        runs.push(launchOnce());
        rmSync(join(USER_DATA, 'logs'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      }
    } finally {
      rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      if (hadUserData) renameSync(BACKUP, USER_DATA);
    }
    const table = runs.map((r, i) => `  #${i + 1}${i === 0 ? '（第一次启动）' : ''}：系统装载 ${r.loaderMs} ms，启动画面 ${r.splashMs} ms（进程启动后 ${r.splashFromStartMs} ms），可交互 ${r.interactiveMs} ms`).join('\n');
    console.log(`T-ARC-7 冷启动（从 CreateProcess 算起）：\n${table}\n  中位数：启动画面 ${median(runs.map((r) => r.splashMs))} ms（进程启动后 ${median(runs.map((r) => r.splashFromStartMs))} ms），可交互 ${median(runs.map((r) => r.interactiveMs))} ms`);
    // 每次都要量出完整的时间线（启动画面、界面就绪、主窗口显示），量不出来就是应用没起来，照样失败
    expect(runs).toHaveLength(RUNS);
    if (REPORT_ONLY) {
      console.log('T-ARC-7：ALLAY_T_ARC_7_REPORT_ONLY=1（CI 的共享机器不是参考机器），只记数字，不按预算判定');
      return;
    }
    for (const r of runs) expect(r.interactiveMs, table).toBeLessThan(INTERACTIVE_BUDGET_MS);
    expect(median(runs.map((r) => r.splashFromStartMs)), table).toBeLessThan(SPLASH_BUDGET_MS);
  }, 180_000);
});
