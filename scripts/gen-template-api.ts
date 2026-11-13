// pnpm templates:api：从 template-sdk 生成模板接口的对外产物（docs/code-editing-and-mcp-plan.md H8）。
//
// - packages/template-sdk/generated/template-api.d.ts：单文件、自包含（不 import 任何包），放进用户的模板文件夹，
//   外部编辑器据此补全。内容是 packages/template-sdk/src/runtime.ts 的类型原文，把 three 的类型导入换成
//   scripts/template-api/three-surface.d.ts 里的最小类型面（取舍见那份文件的注释）。
// - packages/template-sdk/generated/template-api.json：ctx 各成员的签名与说明，以及相关类型的成员（供将来补全用）。
// - docs/template-authoring.md：模板编写指南，由 scripts/template-api/authoring.md 填入生成的部分。
//
// 产物逐字节确定（LF 换行），提交进仓库；T-DEV-3 核对重新生成后没有差异。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { DIAGNOSTIC_KINDS } from '../packages/template-sdk/src/protocol';
import { templateJsconfigText } from '../apps/desktop/src/shared/template-dev';
import { MEMBER_DOCS } from './template-api/member-docs';

const ROOT = resolve(import.meta.dirname, '..');
const RUNTIME = join(ROOT, 'packages/template-sdk/src/runtime.ts');
const THREE_SURFACE = join(ROOT, 'scripts/template-api/three-surface.d.ts');
const GUIDE_SOURCE = join(ROOT, 'scripts/template-api/authoring.md');
export const EXAMPLE_DIR = join(ROOT, 'scripts/template-api/example');

export const OUTPUTS = {
  dts: join(ROOT, 'packages/template-sdk/generated/template-api.d.ts'),
  json: join(ROOT, 'packages/template-sdk/generated/template-api.json'),
  guide: join(ROOT, 'docs/template-authoring.md'),
} as const;

const THREE_IMPORT = "import type * as THREE from 'three';";

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const rel = (file: string) => relative(ROOT, file).replace(/\\/g, '/');

/** 去掉文件开头连续的 // 注释行（和随后的空行） */
function stripLeadingComments(text: string): string {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i]!.startsWith('//') || lines[i]!.trim() === '')) i++;
  return lines.slice(i).join('\n');
}

/**
 * runtime.ts 的原文，给没写 JSDoc 的成员补上 member-docs.ts 里的说明。
 * member-docs.ts 里有、但 runtime.ts 里找不到（或已经有说明）的键报错，免得说明悄悄过时。
 */
function documentedRuntime(): string {
  const text = read(RUNTIME);
  const sf = ts.createSourceFile('runtime.ts', text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const inserts: { at: number; text: string }[] = [];
  const used = new Set<string>();
  const visit = (members: ts.NodeArray<ts.TypeElement>, path: string) => {
    for (const m of members) {
      if (!ts.isPropertySignature(m) && !ts.isMethodSignature(m)) continue;
      const key = `${path}.${m.name.getText(sf)}`;
      const doc = MEMBER_DOCS[key];
      if (doc !== undefined) {
        if (docOf(m)) throw new Error(`member-docs.ts: ${key} already has a JSDoc in runtime.ts`);
        used.add(key);
        const at = m.getStart(sf, false);
        const lineStart = text.lastIndexOf('\n', at - 1) + 1;
        const indent = text.slice(lineStart, at);
        // 成员独占一行时注释另起一行；和别的东西同在一行（如 `time: { segment(...) }`）时写在它前面
        inserts.push({ at, text: indent.trim() === '' ? `/** ${doc} */\n${indent}` : `/** ${doc} */ ` });
      }
      if (ts.isPropertySignature(m) && m.type && ts.isTypeLiteralNode(m.type)) visit(m.type.members, key);
    }
  };
  for (const st of sf.statements) if (ts.isInterfaceDeclaration(st)) visit(st.members, st.name.text);
  const unused = Object.keys(MEMBER_DOCS).filter((k) => !used.has(k));
  if (unused.length > 0) throw new Error(`member-docs.ts: no such member in runtime.ts: ${unused.join(', ')}`);
  let out = text;
  for (const ins of inserts.sort((a, b) => b.at - a.at)) out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
  return out;
}

export function generateDts(): string {
  const runtime = documentedRuntime();
  if (!runtime.includes(THREE_IMPORT)) throw new Error(`${rel(RUNTIME)}: expected "${THREE_IMPORT}"`);
  const body = stripLeadingComments(runtime.replace(THREE_IMPORT, '')).trimEnd();
  const surface = stripLeadingComments(read(THREE_SURFACE)).trimEnd();
  return [
    '// 模板接口的类型定义（自包含，不依赖任何包）。',
    `// 由 pnpm templates:api 从 ${rel(RUNTIME)} 和 ${rel(THREE_SURFACE)} 生成，不要直接改。`,
    '//',
    '// 用法：放在模板文件夹里，与 template.js 同级；在 template.js 的默认导出上加',
    "//   /** @type {import('./template-api').TemplateModule} */",
    '// 编辑器就能对 ctx 补全。ctx.THREE 只声明了模板常用的类和成员（与真实的 three.js 兼容），',
    '// 没列出的成员运行时照样可用，只是没有补全。',
    '',
    body,
    '',
    '// ---- ctx.THREE 的最小类型面 ----',
    '',
    surface,
    '',
  ].join('\n');
}

// ---- 接口 JSON ----

export interface ApiMember {
  name: string;
  kind: 'property' | 'method';
  optional: boolean;
  /** 成员声明的原文（不含注释），如 `texture(id: string): Promise<THREE.Texture>;` */
  signature: string;
  /** JSDoc 说明 */
  doc: string;
  /** 类型是对象字面量时（如 ctx.resources）的成员 */
  members?: ApiMember[];
}

export interface TemplateApiJson {
  formatVersion: 1;
  source: string;
  /** SetupContext 的成员 */
  ctx: ApiMember[];
  /** 其他接口（Rng、BlockHandle 等）的成员 */
  types: Record<string, { doc: string; members: ApiMember[] }>;
  /** 类型别名的原文（EasingName 等） */
  aliases: Record<string, { doc: string; text: string }>;
  easings: string[];
}

function docOf(node: ts.Node): string {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? [];
  const text = docs
    .map((d) => (typeof d.comment === 'string' ? d.comment : (d.comment ?? []).map((c) => c.text).join('')))
    .join('\n')
    .trim();
  if (text) return text;
  // 同一行里紧挨着成员的 /** … */（如 `time: { /** … */ segment(...) }`）解析器不挂成 JSDoc，自己从前导注释里取
  const sf = node.getSourceFile();
  // 同一行里的注释对编译器 API 来说是前一个记号的“尾随注释”
  const start = node.getStart(sf, false);
  const ranges = [...(ts.getTrailingCommentRanges(sf.text, node.pos) ?? []), ...(ts.getLeadingCommentRanges(sf.text, node.pos) ?? [])].filter((r) => r.end <= start);
  const last = ranges.sort((a, b) => a.pos - b.pos).at(-1);
  if (!last || !sf.text.startsWith('/**', last.pos)) return '';
  return sf.text.slice(last.pos + 3, last.end - 2).replace(/^\s*\*\s?/gm, '').trim();
}

function membersOf(members: ts.NodeArray<ts.TypeElement>, sf: ts.SourceFile): ApiMember[] {
  const out: ApiMember[] = [];
  for (const m of members) {
    if (!ts.isPropertySignature(m) && !ts.isMethodSignature(m)) continue;
    const name = m.name.getText(sf);
    // 对象字面量类型的成员另列在 members 里，签名只留一个占位
    const literal = ts.isPropertySignature(m) && m.type !== undefined && ts.isTypeLiteralNode(m.type);
    const signature = literal ? `${name}: { … };` : sf.text.slice(m.getStart(sf, false), m.end).replace(/\s+/g, ' ').trim();
    const member: ApiMember = { name, kind: ts.isMethodSignature(m) ? 'method' : 'property', optional: m.questionToken !== undefined, signature, doc: docOf(m) };
    if (ts.isPropertySignature(m) && m.type && ts.isTypeLiteralNode(m.type)) member.members = membersOf(m.type.members, sf);
    out.push(member);
  }
  return out;
}

export function generateJson(): TemplateApiJson {
  const sf = ts.createSourceFile('runtime.ts', documentedRuntime(), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const types: TemplateApiJson['types'] = {};
  const aliases: TemplateApiJson['aliases'] = {};
  let ctx: ApiMember[] | null = null;
  let easings: string[] = [];
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st)) {
      const members = membersOf(st.members, sf);
      if (st.name.text === 'SetupContext') ctx = members;
      else types[st.name.text] = { doc: docOf(st), members };
    } else if (ts.isTypeAliasDeclaration(st)) {
      aliases[st.name.text] = { doc: docOf(st), text: st.type.getText(sf).replace(/\s+/g, ' ').trim() };
      if (st.name.text === 'EasingName' && ts.isUnionTypeNode(st.type)) {
        easings = st.type.types.flatMap((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []));
      }
    }
  }
  if (!ctx) throw new Error(`${rel(RUNTIME)}: SetupContext not found`);
  if (easings.length === 0) throw new Error(`${rel(RUNTIME)}: EasingName not found`);
  return { formatVersion: 1, source: rel(RUNTIME), ctx, types, aliases, easings };
}

// ---- 指南 ----

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

function ctxTable(api: TemplateApiJson): string {
  const rows = ['| 成员 | 签名 | 说明 |', '|---|---|---|'];
  const walk = (members: ApiMember[], prefix: string) => {
    for (const m of members) {
      const path = `${prefix}${m.name}`;
      if (m.members) {
        rows.push(`| \`${path}\` | 对象 | ${cell(m.doc)} |`);
        walk(m.members, `${path}.`);
      } else {
        rows.push(`| \`${path}\` | \`${cell(m.signature.replace(/;$/, ''))}\` | ${cell(m.doc)} |`);
      }
    }
  };
  walk(api.ctx, 'ctx.');
  const handles = ['Rng', 'BlockHandle', 'BlockInstances', 'ItemHandle', 'TextObject', 'SpriteObject', 'EaseLibrary', 'MathHelpers']
    .filter((n) => api.types[n])
    .map((n) => {
      const t = api.types[n]!;
      const lines = [`**${n}**${t.doc ? `：${cell(t.doc)}` : ''}`, '', '| 成员 | 签名 | 说明 |', '|---|---|---|'];
      for (const m of t.members) lines.push(`| \`${m.name}\` | \`${cell(m.signature.replace(/;$/, ''))}\` | ${cell(m.doc)} |`);
      return lines.join('\n');
    });
  return [rows.join('\n'), '', 'ctx 交出来的对象：', '', handles.join('\n\n')].join('\n');
}

const DIAGNOSTIC_TEXT: Record<(typeof DIAGNOSTIC_KINDS)[number], string> = {
  compile: '装载前的预检：语法错误、出现 `import`、源码超过 1 MB。带位置',
  load: '模块求值时抛错（带位置），或默认导出不是带 `setup` 的对象',
  setup: '`setup` 抛错（带位置），或返回值不合契约（`duration` 越界等）',
  update: '`update(t)` 抛错，带出错的时刻 `t` 和位置',
  watchdog: '在时限内没有返回（比如死循环），Worker 已被终止。没有位置',
  determinism: '开发构建在 `update(t)` 里拦到 `Math.random` 等（带位置）；或同一帧穿插渲染后结果不同（没有位置）',
  rule: '静态检查的提示：代码里出现了会破坏确定性的调用。带位置',
};

function diagnosticKinds(): string {
  return ['| 种类 | 什么时候 |', '|---|---|', ...DIAGNOSTIC_KINDS.map((k) => `| \`${k}\` | ${DIAGNOSTIC_TEXT[k]} |`)].join('\n');
}

export function generateGuide(api: TemplateApiJson = generateJson()): string {
  const fill: Record<string, string> = {
    CTX_TABLE: ctxTable(api),
    EASINGS: api.easings.map((e) => `\`${e}\``).join('、'),
    DIAGNOSTIC_KINDS: diagnosticKinds(),
    JSCONFIG: templateJsconfigText().trimEnd(),
    EXAMPLE_MANIFEST: read(join(EXAMPLE_DIR, 'manifest.json')).trimEnd(),
    EXAMPLE_TEMPLATE: read(join(EXAMPLE_DIR, 'template.js')).trimEnd(),
  };
  return read(GUIDE_SOURCE).replace(/\{\{([A-Z_]+)\}\}/g, (m, name: string) => {
    const v = fill[name];
    if (v === undefined) throw new Error(`${rel(GUIDE_SOURCE)}: unknown placeholder ${m}`);
    return v;
  });
}

/** 三个产物的内容 */
export function generateAll(): Record<keyof typeof OUTPUTS, string> {
  const api = generateJson();
  return { dts: generateDts(), json: `${JSON.stringify(api, null, 2)}\n`, guide: generateGuide(api) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const all = generateAll();
  for (const key of Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[]) {
    mkdirSync(dirname(OUTPUTS[key]), { recursive: true });
    writeFileSync(OUTPUTS[key], all[key]);
    console.log(`[templates:api] ${rel(OUTPUTS[key])}（${Buffer.byteLength(all[key])} 字节）`);
  }
}
