# 界面增强的评审截图

`pnpm build && pnpm review:ux-wave` 生成（`scripts/review-ux-wave.ts`）。隐藏窗口、1440 × 900、`capturePage`；素材只有测试脚本生成的纯色假原版层和本机假 Mojang 服务器给的假 jar，悦灵是 CSS 占位（烘焙产物目录指向空目录）。截图里没有原版贴图。

规格：`docs/06-ui-design.md` 6.10（首次启动引导）、6.11（设置与快捷键）、6.12（下载进度）、6.14（新手引导）。决定和没验证的：`docs/decisions.md`“界面增强”“新手引导”。首次启动引导的十张在“新手引导”那次按两栏版面重新生成。

| 文件 | 内容 |
|---|---|
| `onboarding-language-*` | 引导第 1 步：语言（深色中文、浅色英文） |
| `onboarding-appearance-*` | 第 2 步：主题缩略图、减少动效 |
| `onboarding-assets-found-dark-zh` | 第 3 步：本机找到假游戏时 |
| `onboarding-download-running-*` | 第 3 步：下载中（假服务器把 jar 发了一半停住），五个阶段、读数、悦灵占位 |
| `onboarding-download-failed-dark-en` | 下载失败：停在 jar，可以重试 |
| `onboarding-folders-light-zh` | 第 4 步：工程文件夹已选（测试开关代替文件夹对话框） |
| `onboarding-done-dark-zh` | 第 5 步：摘要 |
| `settings-*` | 设置的七个分类；`folders-light-zh` 是导出文件夹不存在时的提示，`shortcuts-conflict-light-en` 是冲突时的询问 |
| `tour-*` | 新手引导：开场、模板库、模板和预设的区别（两个口，深浅各一张）、预览、属性面板、时间轴、导出、帮助菜单 |
| `resources-download-dark-zh` | 资源栈弹层里的紧凑版下载进度 |

截图只看静态画面：换步的滑入、悦灵的漂浮和挪位、聚光口的移动、悦灵的进度编排都没有在可见窗口里看过。
