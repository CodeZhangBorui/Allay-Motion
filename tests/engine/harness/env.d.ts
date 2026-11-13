/// <reference types="vite/client" />

declare module 'virtual:builtin-templates' {
  /** 内置模板：id → manifest（JSON）与打包好的源码 */
  const templates: Record<string, { manifest: unknown; code: string }>;
  export default templates;
}
