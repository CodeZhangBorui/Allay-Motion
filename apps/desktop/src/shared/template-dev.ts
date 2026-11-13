// 模板开发模式（docs/08-milestones.md MD）里主进程和构建脚本共用的常量。
// 写进用户模板文件夹的两个文件：template-api.d.ts（由 pnpm templates:api 生成）和下面的 jsconfig.json，
// 让外部编辑器（VS Code 等）对 template.js 有补全和类型检查。

/** 写进模板文件夹的类型定义的文件名 */
export const TEMPLATE_API_DTS_NAME = 'template-api.d.ts';
export const TEMPLATE_JSCONFIG_NAME = 'jsconfig.json';

/**
 * jsconfig.json 的内容。strict 关着：从内置模板复制出来的 template.js 是打包产物，没有类型注解，
 * 开着会满屏红线；checkJs 照样检查 ctx 的成员和参数类型。不带 DOM：模板跑在 Worker 里，拿不到 DOM。
 */
export const TEMPLATE_JSCONFIG = {
  compilerOptions: {
    checkJs: true,
    target: 'ES2023',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2023'],
    types: [],
    strict: false,
    noEmit: true,
  },
  include: ['template.js', TEMPLATE_API_DTS_NAME],
} as const;

/** jsconfig.json 的文本（LF 换行，末尾一个换行） */
export function templateJsconfigText(): string {
  return `${JSON.stringify(TEMPLATE_JSCONFIG, null, 2)}\n`;
}

/** 模板文件夹里与模板本身有关的文件：只有它们变了才算模板变了（监视服务据此算内容哈希） */
export function isTemplateContentPath(rel: string): boolean {
  return rel === 'manifest.json' || rel === 'template.js' || rel.startsWith('assets/');
}
