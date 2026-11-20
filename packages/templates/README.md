# 内置模板

每个内置模板一个目录（`packages/templates/<name>/`），各自是一个 workspace 包：

```
<name>/
  manifest.json
  src/index.ts     只允许从 @allay/template-sdk 做类型导入，以及导入本目录和 _lib 里的文件（lint 和构建脚本强制）
  assets/          可选
```

`pnpm templates:build`（`scripts/build-templates.ts`）用 esbuild 把 `src/index.ts` 打成不含任何 import 的单文件 ESM，
用 es-module-lexer 确认没有残留的 import，连同 manifest 和 assets 打成 `.allaytpl`，输出到 `resources/templates/`（不提交）。
应用从那里装载内置模板，走的是和用户模板相同的装载路径（docs/04-templates.md 4.9）。
