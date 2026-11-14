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
import { renderNotices, THIRD_PARTY_JSON, type ThirdPartyFile } from './third-party';

const BOM = String.fromCharCode(0xfeff);
const ROOT = resolve(import.meta.dirname, '..');
export const BUILD_DIR = join(ROOT, 'apps/desktop/build');

/** NSIS 字符串字面量里的转义：$ → $$，" → $\"，换行 → $\r$\n */
export function nsisString(text: string): string {
  return text.replace(/\$/g, '$$$$').replace(/"/g, '$\\"').replace(/\r?\n/g, '$\\r$\\n');
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
  return `${BOM}; 由 scripts/dist-extras.ts 生成，不要手改（docs/decisions.md M8）\r\n!macro customWelcomePage\r\n  !define MUI_WELCOMEPAGE_TITLE "${nsisString(title)}"\r\n  !define MUI_WELCOMEPAGE_TEXT "${nsisString(text)}"\r\n  !insertmacro MUI_PAGE_WELCOME\r\n!macroend\r\n`;
}

export function noticesText(file: ThirdPartyFile): string {
  return renderNotices(file, `${brandMessages.en.name} / ${brandMessages['zh-CN'].name}\n\n${brandMessages['zh-CN'].disclaimer}\n\n${brandMessages.en.mascotCredit}\n${brandMessages['zh-CN'].mascotCredit}`);
}

function main(): void {
  mkdirSync(BUILD_DIR, { recursive: true });
  writeFileSync(join(BUILD_DIR, 'installer.nsh'), installerScript(), 'utf8');
  const file = JSON.parse(readFileSync(THIRD_PARTY_JSON, 'utf8')) as ThirdPartyFile;
  writeFileSync(join(BUILD_DIR, 'THIRD_PARTY_NOTICES.txt'), noticesText(file), 'utf8');
  console.log(`dist-extras: 写入 ${join(BUILD_DIR, 'installer.nsh')} 和 THIRD_PARTY_NOTICES.txt（${file.entries.length} 项）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
