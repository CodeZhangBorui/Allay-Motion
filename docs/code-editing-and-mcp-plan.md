# 代码编辑与 MCP：准备方案

状态：方案，尚未实现。2026-11-13 由主控根据三路调研汇总。调研里凡是没有读到一手出处的结论，本文都标了“未核实”。

## 1. 目标与约束

**目标**：让写模板的人能直接改模板代码并实时看到结果（“纯代码编辑动画”）；将来可能让 AI 助手通过 MCP 操作应用。

**用户提出的硬性要求**：这两项必须解耦。它们如果不好用、不实用，要能整块砍掉而不牵连主程序。

**不变的约束**：

- 画面是时间的纯函数（`AGENTS.md` 硬性规则 2）。代码编辑是在现有模板格式上加编辑体验，不换写动画的方式。
- 模板代码只在引擎 Worker 里运行（规则 3）；`docs/01-product-architecture.md` 1.6 的安全基线一条不放宽（规则 4）。
- 应用不联网（规则 10）。MCP 若启用，应用自身仍不开任何网络端口；但模板代码和渲染出的画面会经 AI 客户端到达云端模型，**启用前需要用户明确同意**，设置里的说明必须写清。
- 不引入 Theatre.js（规则 7）；本文只把它当结构上的参照。
- 依赖许可只允许 MIT、BSD、ISC、Apache-2.0。

## 2. 调研结论

### 2.1 代码驱动的动画工具

| 写法 | 代表 | 对我们 |
|---|---|---|
| 时间的纯函数 | Remotion、Shadertoy、After Effects 表达式 | 就是现有契约。任意顺序取帧、子帧、热重载都简单；排时间靠算术，物理要用闭式或预计算 |
| 生成器按顺序往下演 | Motion Canvas | 跳帧要从头重放，与任意顺序渲染子帧冲突，不采用 |
| 声明式关键帧 | Theatre.js、基岩版动画 | 可视化友好，过程化和逐实例运动弱 |
| 有状态的逐步推进 | Rive 脚本、Cavalry 的求解器 | 违反规则 2，不采用 |

要点：

- **最接近我们的两个工具（Remotion、Motion Canvas）都不带内嵌代码编辑器**，做法是外部编辑器加自动刷新的预览。
- 专业软件里附带的代码框普遍不受欢迎：After Effects 用户抱怨报错含糊、补全不准、窗口局促，要求外部文件和 VS Code；Blender 用户说内置编辑器只适合短脚本。没有找到使用率统计，这是用户讨论里的定性证据。
- Remotion 把界面改动写回源码只对最简单的写法有效，复杂一点就灰掉。结论：**界面不反写代码**。代码管行为，manifest 管参数声明和默认值，工程文件管取值。
- Remotion 的四条确定性规则（重复调用结果相同、不依赖帧序、暂停时不动、随机只用带种子的）与我们一致，它用 lint 拦 `Math.random`。
- 值得借的小设计：Motion Canvas 的“代码里声明命名时间点、时间轴上可拖”；Rive 的“脚手架约束脚本结构”；Blockbench 的“表达式里声明滑块”。Minecraft 圈熟悉的是“关键帧加一小段表达式”。
- 模块边界的范本是 Theatre.js：运行时和编辑界面是两个包，编辑界面只在开发时加载。

### 2.2 应用内编辑器的技术

- **CodeMirror 6 优于 Monaco**：
  - 体积：CodeMirror 基础约 373 KB（压缩后 119 KB）；Monaco 核心 2.47 MB，TypeScript worker 另加 7 MB。
  - 许可：Monaco 附带的图标字体是 CC-BY-4.0，不在允许列表里，而且是需要登记来源的二进制素材。CodeMirror 全部 MIT。
  - CodeMirror 不需要 worker，主题可直接读我们的 CSS 变量。
  - p5.js 编辑器、cables.gl 用的是 CodeMirror 6。
- **TypeScript 语言服务代价高且前景差**：TypeScript 7 是 Go 重写版，没有稳定的 JS 接口；浏览器里跑语言服务只能钉在 6.x（约 3.5 MB），`@valtown/codemirror-ts` 已进入维护模式。
- **便宜的替代**：构建时从 template-sdk 的类型定义生成一份接口 JSON，喂给 CodeMirror 的补全和悬停。几 KB，不需要 worker。
- **模板保持 JS 加 JSDoc，不改成 TS**。改 TS 会让转译成为主程序的职责，破坏可拆性。`esbuild-wasm` 和 `swc-wasm` 在我们的 CSP 下不能用（需要 `wasm-unsafe-eval`）。
- 两个编辑器在中文输入法下都有零星问题报告，CodeMirror 的集中在组合输入旁边有内嵌小部件时。做颜色块、数字拖动之前要用微软拼音和搜狗实测。
- 风险（未核实）：Windows 上对 `.js` 文件调用 `shell.openPath` 可能交给 Windows Script Host 执行。“在外部编辑器中打开”只能打开文件夹，或用参数数组启动用户配置的编辑器。

### 2.3 MCP

- 最新规范是 **2026-07-28**，相对 2025-11-25 是大改：取消会话握手，改为无状态请求加服务端签发的句柄；Roots、Sampling、Logging、HTTP+SSE 进入弃用期；长任务移到扩展里。**现在不实现是对的**，真做时按当时版本写。
- 同类软件的主流接法是“AI 客户端启动的桥接小进程”连到正在运行的应用（Blender、达芬奇、Ableton、Unity、After Effects）。
- 最常见的事故：应用里开一个不验证身份的本机端口，再提供“执行任意代码”的工具。MCP Inspector 的 CVE-2025-49596 就是网页经跨源请求打到本机端口（这条只读到二手报道）。
- 做得稳的共同点：默认关闭；少量带类型的组合工具（达芬奇默认 37 个，全量 390 个）；先给便宜的结构化读取，再给昂贵的；图像只在被请求时返回并限尺寸。
- Remotion 于 2026-10-26 关停了自己的 MCP 服务，改为提供 Agent Skills，理由是数据陈旧、占上下文、调用不稳。**MCP 未必是最终形态**，这进一步要求它可拆；同时说明“一份好的模板接口类型定义加编写指南”本身就有独立价值。

## 3. 解耦的架构

### 3.1 原则

1. **主程序不认识可选模块。** 任何包都不得引用可选模块；可选模块只能引用一个由主程序拥有的宿主接口包。
2. **只有两个接入口**：界面注册表（面板、标签页、菜单项、命令）和命令层（带输入输出校验的命令）。界面按钮、快捷键、命令面板、将来的 MCP，调的是同一套命令。
3. **不产生自己的数据。** 代码编辑读写的就是主程序已有的模板文件；MCP 不存任何专有格式，AI 写的模板就是普通用户模板，`.allay` 不加字段。
4. **默认关闭，关着就不加载。** 设置里一个通用的 `optionalModules` 开关表；没打开时模块的代码块不加载，MCP 的管道不创建。
5. **用测试证明能拆。** CI 加一项：删掉可选模块的目录后，`pnpm check` 和打包冒烟照常通过。

### 3.2 布局

```
packages/host-api/                 主程序拥有：宿主接口的类型（没有可选模块时也有用）
packages/optional/code-editor/     可选：内嵌编辑器（CodeMirror 等依赖都在这里）
packages/optional/mcp/             可选：管道监听、令牌、stdio 桥、MCP SDK、工具定义
```

- 主程序用按目录的惰性发现加载 `packages/optional/*/src/index.ts`，目录不存在就是空表，删目录不需要改主程序。（`import.meta.glob` 指向 Vite 根目录之外是否可行未核实，要先做小实验。）
- 每个可选模块只导出 `activate(host): Disposable`；它的测试、文案、依赖都在自己的目录里。
- 依赖方向规则（`docs/01` 1.4 的表）加两行，并各配一个故意违规的夹具，做法同 T-ARC-1。

### 3.3 宿主接口（草案）

```ts
export interface EditorHost {
  templates: {
    read(id: TemplateId): Promise<{ source: string; version: string }>;
    write(id: TemplateId, source: string, baseVersion: string): Promise<WriteResult>;
    onExternalChange(id: TemplateId, cb: (version: string) => void): Disposable;
  };
  engine: {
    onDiagnostics(id: TemplateId, cb: (d: TemplateDiagnostic[]) => void): Disposable;
    requestReload(id: TemplateId, source: string): Promise<ReloadResult>; // 不落盘的试载
  };
  playhead: { get(): number; subscribe(cb: (t: number) => void): Disposable };
  domain: { blockIds(): readonly string[]; easings(): readonly string[]; sdkApi(): SdkApiDoc };
  ui: {
    registerPanel(p: PanelContribution): Disposable;
    registerCommand(c: CommandContribution): Disposable;
    registerMessages(locale: 'zh-CN' | 'en', m: Record<string, string>): Disposable;
  };
}
```

## 4. 主程序侧的准备（不管最后做不做可选模块都值得做）

这是全部的“准备工作”。每一项对主程序自身都有用。

| # | 内容 | 现状 | 谁受益 |
|---|---|---|---|
| H1 | 界面注册表：面板、标签页、菜单项、命令由注册表驱动，核心功能也经它注册 | 界面重设计正在做 | 主界面、两个可选模块 |
| H2 | 命令带类型：`{ id, input, output, effect: read \| write \| destructive, undoLabel }`，输入输出用 zod | 现在的命令只有 `run()`，没有参数和返回值 | 命令面板、快捷键、e2e、MCP |
| H3 | 工程状态加修订号 | 状态已可序列化，没有修订号 | 并发保护、MCP、外部改动检测 |
| H4 | “渲染某一时刻为一张图”的统一接口，带尺寸上限 | 散在封面生成和试运行两处 | 封面、评审截图、MCP |
| H5 | 结构化诊断：`compile \| load \| setup \| update \| watchdog \| determinism`，带行号列号 | 试运行失败只返回一段文字 | 模板开发、错误卡片、编辑器、MCP |
| H6 | 撤销分组并标明来源 | 有撤销，没有来源标签 | 界面、MCP |
| H7 | 导出做成任务：编号、进度、取消 | 属于 M7 的范围 | 导出对话框、MCP |
| H8 | 模板接口的类型定义和编写指南自动生成（`template-api.d.ts`、接口 JSON、指南） | 类型在 template-sdk 里，没有对外产物 | 外部编辑器补全、内嵌编辑器、AI |
| H9 | 热重载管线：防抖 → 静态检查 → 在备用 Worker 里试载并试渲当前帧 → 成功才切换，失败保留旧 Worker 和上一帧；参数按键名和类型重新对上 | 现在换模板是整体重载 | 模板开发、编辑器 |
| H10 | 主进程监视模板目录，内容哈希去重，变更通知界面 | 没有 | 模板开发、编辑器 |
| H11 | 通用的“主进程到界面”的命令通道，两端 zod 校验 | 没有 | 文件关联、第二实例参数、MCP |
| H12 | 确定性 lint：拦 `Math.random`、`Date.now`、`performance.now`、`import` | 运行时有拦截和双渲比对，没有静态提示 | 模板开发 |

## 5. 分阶段

| 阶段 | 内容 | 增加的体积 | 耦合 |
|---|---|---|---|
| **P0 模板开发模式** | “打开模板文件夹”；监视并热重载（H9、H10）；保住播放位置和参数；错误浮层带行号列号并保留上一帧（H5）；往模板文件夹写 `template-api.d.ts` 和 `jsconfig.json`，让 VS Code 有完整补全（H8）；从内置模板复制出一份可改的 | 界面 0 KB | 无可选模块，全在主程序里，砍掉编辑器也留着 |
| P1 内嵌编辑器 | 可选模块：CodeMirror 6、JS 高亮、行内诊断、保存即重载、`ctx` 补全与悬停、确定性 lint | 约 480 KB，惰性加载（估计值） | 只经宿主接口 |
| P2 行内小部件 | 数字拖动、颜色块、方块 ID 补全、格式化 | 约 15 KB，格式化另加约 620 KB 惰性 | 同上 |
| P3 语言服务 | TypeScript 6 的语言服务 worker | 约 3.5 MB | 同上；前景差，放最后 |
| M 可选的 MCP | stdio 桥 → 命名管道（随机名、每次启动的令牌、一次一个客户端、界面上有“已连接”提示）→ 主进程 → 界面命令层；约 13 个组合工具，不提供执行代码和删除 | 应用内很小；桥是单独的脚本 | 只经命令层 |

**先后顺序的理由**：P0 几乎不增加耦合，而且就算功能最后被砍，留下的东西对写模板的人仍然有用。P0 用下来确实有人要内嵌编辑器，再做 P1。

### MCP 工具面（草案，届时按当时的规范调整）

`list_templates`、`get_template`、`get_template_api`、`validate_template`、`save_template`、`get_project`、`get_param_schema`、`set_params`、`open_template`、`render_frames`（最多 6 个时刻，最长边不超过 1024）、`list_blocks`、`save_preset`、`start_export` / `get_export` / `cancel_export`。

- 导出路径只用用户上次在对话框里选的目录或重新弹对话框，不接受路径字符串（`docs/01` 1.6 第 6 条）。
- 返回给模型的模板名、说明、资源包名、错误信息都当数据字段、限长，不拼进指令。
- 验证“不联网”仍成立：扩展 T-ARC-3，模块关闭或不存在时没有应用命名的管道、进程没有任何 TCP/UDP 监听；模块开启时仍然没有监听端口。

## 6. 拆除清单

- 删除：`packages/optional/code-editor` 或 `packages/optional/mcp`（含各自的测试、文案、依赖），刷新 lockfile。
- 保留：宿主接口、注册表、命令层、监视与热重载管线、诊断、类型定义生成、全部模板文件。
- 无需迁移任何数据；设置里残留的开关键无害。

## 7. 需要用户决定的事

| 编号 | 事项 | 默认 |
|---|---|---|
| H-CODE-SCOPE | P0（模板开发模式）是否纳入这次交付。它在 `docs/08-milestones.md` 里原是“之后的方向”第 1 条，不在 v1 范围内 | 只做第 4 节的准备，P0 待定 |
| H-CODE-EDITOR | 是否做 P1 内嵌编辑器 | 不做，等 P0 的使用反馈 |
| ★ H-MCP | 是否做 MCP，以及是否接受“启用后模板代码和画面会经 AI 客户端到达云端模型” | 不做；做之前必须确认 |

## 8. 不做的事

- 不在应用里开 HTTP 或 WebSocket 监听。
- 不提供执行任意代码的工具，不让任何东西够到主进程或 DOM。
- 不为这两项放宽 1.6 的任何一条，不打开 `RunAsNode`。
- 不让界面反写模板代码。
- 不把模板改成 TypeScript。
- 不向任何公开的 MCP 目录或注册表发布（规则 11）。
- 现在不写可选模块的任何代码，也不做占位界面。
