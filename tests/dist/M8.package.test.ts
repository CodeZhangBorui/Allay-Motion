import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandMessages } from '../../packages/ui/src/brand/messages';

// M8（打包后）：安装包里有什么、没有什么；文件关联、快捷方式、欢迎页的声明写进了安装脚本。
// 由 pnpm dist 在 electron-builder 之后运行。安装包本身用 electron-builder 缓存里的 7-Zip 列出内容（只读，不安装）。

const ROOT = resolve(import.meta.dirname, '../..');
const RELEASE = join(ROOT, 'apps/desktop/release');
const UNPACKED = join(RELEASE, 'win-unpacked');
const BUILD = join(ROOT, 'apps/desktop/build');

function installer(): string {
  const name = readdirSync(RELEASE).find((f) => /-x64-setup\.exe$/.test(f));
  if (!name) throw new Error(`${RELEASE} 里没有安装包（pnpm dist 没跑完）`);
  return join(RELEASE, name);
}

/** electron-builder 打 NSIS 包时下载并缓存的 7za（有缓存时打包不联网，decisions.md M0） */
function sevenZip(): string {
  const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
  for (const dir of existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('7zip')) : []) {
    for (const sub of readdirSync(join(cache, dir))) {
      const exe = join(cache, dir, sub, 'bin', '7za.exe');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error(`在 ${cache} 里找不到 electron-builder 的 7za.exe`);
}

/** 安装包里打包的应用文件（相对安装目录，/ 分隔） */
function installerFiles(): string[] {
  const r = spawnSync(sevenZip(), ['l', '-slt', installer()], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`7za 失败：${r.stderr}`);
  // 第一条 Path 是安装包自己
  return [...r.stdout.matchAll(/^Path = (.+)$/gm)].slice(1).map((m) => m[1]!.trim().replace(/\\/g, '/'));
}

describe('M8 安装包的内容', () => {
  it('解包目录和安装包里都没有 Electron 自带的 default_app.asar', () => {
    expect(existsSync(join(UNPACKED, 'resources', 'app.asar'))).toBe(true);
    expect(existsSync(join(UNPACKED, 'resources', 'default_app.asar'))).toBe(false);
    const files = installerFiles();
    expect(files).toContain('resources/app.asar');
    expect(files.filter((f) => /default_app/i.test(f))).toEqual([]);
  });

  it('随包附带许可与声明：FFmpeg 的 LGPL 全文和构建来源、方舟像素字体的 OFL、Chromium 与 Electron 的许可、第三方许可清单', () => {
    const files = installerFiles();
    for (const f of [
      'THIRD_PARTY_NOTICES.txt',
      'LICENSES.chromium.html',
      'LICENSE.electron.txt',
      'resources/ffmpeg/win32-x64/ffmpeg.exe',
      'resources/ffmpeg/win32-x64/LICENSE.txt',
      'resources/ffmpeg/win32-x64/build.json',
      'resources/fonts/ark-pixel/OFL.txt',
    ])
      expect(files, f).toContain(f);
    // ffprobe 只给测试用
    expect(files.some((f) => /ffprobe/i.test(f))).toBe(false);
    const notices = readFileSync(join(UNPACKED, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    expect(notices).toContain(brandMessages.en.disclaimer);
    expect(notices).toContain('LGPL-3.0-or-later');
    expect(readFileSync(join(UNPACKED, 'resources/ffmpeg/win32-x64/LICENSE.txt'), 'utf8')).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
  });

  it('只带运行时需要的东西：没有源码映射、没有测试夹具、没有 node_modules', () => {
    const files = installerFiles();
    expect(files.filter((f) => /\.map$|node_modules|tests\/fixtures|\.ts$/.test(f))).toEqual([]);
  });

  it('安装包的大小记一笔（不设上限）', () => {
    const size = statSync(installer()).size;
    console.log(`安装包：${installer()}，${(size / 1024 / 1024).toFixed(1)} MiB（${size} 字节）`);
    expect(size).toBeGreaterThan(50 * 1024 * 1024);
  });
});

describe('M8 安装脚本（electron-builder 生成的 NSIS 脚本，记在 builder-debug.yml）', () => {
  const debug = () => readFileSync(join(RELEASE, 'builder-debug.yml'), 'utf8');

  // 按用户安装、快捷方式这些开关以 -D 传给 makensis，不在脚本里；它们的来源是 electron-builder.yml
  it('.allay 和 .allaytpl 关联到应用，双击时把路径作为参数交给它', () => {
    const text = debug();
    expect(text).toContain('!macro registerFileAssociations');
    expect(text).toMatch(/APP_ASSOCIATE "allay" "AllayMotion\.Project" .* "\$appExe \$\\"%1\$\\""/);
    expect(text).toMatch(/APP_ASSOCIATE "allaytpl" "AllayMotion\.Template" .* "\$appExe \$\\"%1\$\\""/);
  });

  it('欢迎页来自 build/installer.nsh，带完整的非官方声明（中英文）', () => {
    expect(debug()).toMatch(/!include ".*[\\/]apps[\\/]desktop[\\/]build[\\/]installer\.nsh"/);
    const nsh = readFileSync(join(BUILD, 'installer.nsh'), 'utf8');
    expect(nsh).toContain('!macro customWelcomePage');
    expect(nsh).toContain('NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.');
    expect(nsh).toContain('本软件不是 Minecraft 官方产品');
  });
});
