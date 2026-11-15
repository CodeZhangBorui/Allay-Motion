// pnpm dist 的前置步骤（docs/08-milestones.md M8）：生成两份随安装包走、但不提交的文件，放进 electron-builder 的 buildResources。
//
//   apps/desktop/build/installer.nsh            安装程序欢迎页（09-compliance.md 9.5：安装程序的欢迎页带非官方声明）
//   apps/desktop/build/THIRD_PARTY_NOTICES.txt  第三方许可的纯文本版（9.7：署名和许可全文随安装包附带）
//
// 两份都从唯一的来源生成：产品名和声明来自 packages/ui/src/brand（品牌资产只放在那里，硬性规则 9），
// 许可清单来自提交的 third-party-licenses.json（scripts/third-party.ts）。两处都被 git 忽略，每次重写。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brandMessages } from '../packages/ui/src/brand/messages';
import { INSTALL_TEMP_SPACE_MB } from '../apps/desktop/src/shared/updates';
import { renderNotices, THIRD_PARTY_JSON, type NoticesTarget, type ThirdPartyFile } from './third-party';

const BOM = String.fromCharCode(0xfeff);
const ROOT = resolve(import.meta.dirname, '..');
export const BUILD_DIR = join(ROOT, 'apps/desktop/build');

/** NSIS 字符串字面量里的转义：$ → $$，" → $\"，换行 → $\r$\n */
export function nsisString(text: string): string {
  return text.replace(/\$/g, '$$$$').replace(/"/g, '$\\"').replace(/\r?\n/g, '$\\r$\\n');
}

/**
 * 安装前要的临时空间（MB）。electron-builder 的安装程序先把整个应用（约 180 MB 的 7z 和解开后约 510 MB 的文件）
 * 放进临时文件夹，再复制进安装目录；临时文件夹所在的磁盘空间不够时，解压在中途停下、安装程序照样报告成功，
 * 旧版本已经被卸掉，留下一个打不开的半截安装（2026-11-14 实测，docs/decisions.md“安装时临时空间不足”）。
 */
export const TEMP_SPACE_REQUIRED_MB = INSTALL_TEMP_SPACE_MB;

/**
 * 安装程序启动时（.onInit 里的 customInit，早于卸载旧版本）检查临时文件夹所在磁盘的剩余空间，不够就提示并退出（退出码 2），
 * 原来装着的版本保持不变。静默安装（/S，应用内更新用）时不弹窗，直接退出
 */
export function spaceCheckMacro(): string {
  const text = [
    `临时文件夹所在的磁盘（{ROOT}）只剩 {FREE} MB，安装至少需要 ${TEMP_SPACE_REQUIRED_MB} MB。`,
    '空间不够会装出一个打不开的半截应用，所以这次没有安装，原来的版本保持不变。请清理这个磁盘后重新运行安装程序。',
    '',
    `The drive with the temporary folder ({ROOT}) has only {FREE} MB free; setup needs at least ${TEMP_SPACE_REQUIRED_MB} MB.`,
    'Nothing was changed. Free up space on that drive and run setup again.',
  ].join('\n');
  // 先转义成 NSIS 字面量，再把占位换成变量（变量里的 $ 不能被转义）
  const message = nsisString(text).replaceAll('{ROOT}', '$R9').replaceAll('{FREE}', '$R8');
  return [
    '!macro customInit',
    '  ${GetRoot} "$TEMP" $R9',
    '  ${DriveSpace} "$R9\\" "/D=F /S=M" $R8',
    `  \${If} $R8 < ${TEMP_SPACE_REQUIRED_MB}`,
    `    MessageBox MB_OK|MB_ICONSTOP "${message}" /SD IDOK`,
    '    SetErrorLevel 2',
    '    Quit',
    '  ${EndIf}',
    '!macroend',
  ].join('\r\n');
}

/** 欢迎页：两种语言都写上（安装程序不跟应用的语言设置走），声明照 9.5 完整给出 */
export function installerScript(): string {
  const zh = brandMessages['zh-CN'];
  const en = brandMessages.en;
  const title = `${en.name}  ·  ${zh.name}`;
  const text = [
    `Setup will install ${en.name} for the current user.`,
    `安装程序将为当前用户安装${zh.name}。`,
    '',
    zh.disclaimer,
    '',
    'Third-party licenses: THIRD_PARTY_NOTICES.txt in the install folder.',
    '第三方许可见安装目录的 THIRD_PARTY_NOTICES.txt。',
  ].join('\n');
  // UTF-8 带 BOM：makensis 按 Unicode 读脚本
  return `${BOM}; 由 scripts/dist-extras.ts 生成，不要手改（docs/decisions.md M8）\r\n!macro customWelcomePage\r\n  !define MUI_WELCOMEPAGE_TITLE "${nsisString(title)}"\r\n  !define MUI_WELCOMEPAGE_TEXT "${nsisString(text)}"\r\n  !insertmacro MUI_PAGE_WELCOME\r\n!macroend\r\n${spaceCheckMacro()}\r\n`;
}

/** 本项目自己的许可（用户决定，2026-11-14，docs/decisions.md M8） */
export const PROJECT_LICENSE = [
  'This software is licensed under the GNU General Public License v3.0 only (GPL-3.0-only); see LICENSE in the source repository.',
  'Commercial licenses for uses not permitted by the GPL are available from the copyright holder: https://github.com/Mystic-Stars/Allay-Motion/issues',
  '本软件以 GNU 通用公共许可证第 3 版（GPL-3.0-only）授权；需要不受 GPL 约束地使用（例如闭源），请通过仓库的 Issues 联系版权人取得商业授权。',
].join('\n');

export function noticesText(file: ThirdPartyFile, target: NoticesTarget = 'win32-x64'): string {
  return renderNotices(
    file,
    `${brandMessages.en.name} / ${brandMessages['zh-CN'].name}\n\n${brandMessages['zh-CN'].disclaimer}\n\n${PROJECT_LICENSE}\n\n${brandMessages.en.licenseScope}\n\n${brandMessages['zh-CN'].licenseScope}`,
    target,
  );
}

/** 当前机器打的包（scripts/dist.mjs 按当前机器选平台和架构） */
export function currentTarget(): NoticesTarget {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  return 'win32-x64';
}

function main(): void {
  mkdirSync(BUILD_DIR, { recursive: true });
  writeFileSync(join(BUILD_DIR, 'installer.nsh'), installerScript(), 'utf8');
  const file = JSON.parse(readFileSync(THIRD_PARTY_JSON, 'utf8')) as ThirdPartyFile;
  writeFileSync(join(BUILD_DIR, 'THIRD_PARTY_NOTICES.txt'), noticesText(file, currentTarget()), 'utf8');
  console.log(`dist-extras: 写入 ${join(BUILD_DIR, 'installer.nsh')} 和 THIRD_PARTY_NOTICES.txt（${file.entries.length} 项）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
