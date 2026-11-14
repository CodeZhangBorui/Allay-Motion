declare module 'virtual:allay-builtin-templates' {
  /** packages/templates/* 的 manifest（未校验的 JSON）和打包好的单文件 ESM 源码 */
  const templates: { manifest: unknown; code: string }[];
  export default templates;
}
