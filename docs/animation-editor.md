# 动画编辑器：设计说明

状态：第一到第三期都已实现（2026-11）。这份说明按功能组织：第 3 节是文档格式，第 4 节是它怎么跑起来，第 5 节是它和工程、模板的关系，第 6 节是界面，第 7 节是命令，第 8 节是性能，第 9 节是“功能 → 验收测试 → 有没有在应用里看过”的总表，第 10 节是没验证的。每一轮做了什么、为什么那样做记在 `docs/decisions.md`（“动画编辑器第三轮”“动画编辑器的第二轮反馈”“2026-11 反馈：开发模式、代码编辑与动画编辑器”），这里只写现在是什么样。

相关：`docs/code-editing-and-mcp-plan.md`（解耦架构、H1–H12）、`docs/04-templates.md`（模板格式与运行时接口）、`docs/06-ui-design.md` 6.15（界面位置和样式）。

## 1. 目标与约束

**目标**：不写代码也能从零做一段转场或叠加动画——放方块、物品、文字、形状、图片，打关键帧、调曲线、实时预览、导出视频；任何时候都能直接改它的代码，两边改的是同一份东西。做好的动画能变成一个普通的模板，进模板库、能分享，之后还能回到编辑器里接着改。

**不变的约束**：

- 画面是时间的纯函数（硬性规则 2）。解释器只按 `t` 插值；随机都来自带种子的 `ctx.random`。
- 动画在引擎 Worker 里跑，和内置模板、用户模板走同一条装载路径（规则 3、5）：交给引擎的就是一份“manifest + template.js”，template.js 只用公开的 `ctx` 接口。
- 不引入 Theatre.js 和 GSAP（规则 7），下面借的只是概念。
- 界面风格与现有界面统一（`docs/design-direction.md`）。
- 内嵌代码编辑器是可选模块（`packages/optional/code-editor`），拆掉后动画编辑器仍然完整可用。
- 不放宽 `docs/01-product-architecture.md` 1.6 的任何一条安全设置。

## 2. 调研：各家的做法，我们借什么

| 软件 | 核心概念 | 借什么 | 不借什么 |
|---|---|---|---|
| After Effects | 合成、图层、属性关键帧、图表编辑器、表达式 | 图层列表 + 每层可展开的属性；属性行的菱形；有关键帧的属性改数值时自动落关键帧；定格关键帧（我们叫“保持”）；J / K 跳关键帧、B / N 设工作区；父子层级 | 表达式语言（我们的“表达式”就是模板代码本身） |
| Apple Motion | 行为、参数绑定、发布参数给 FCP 模板 | “发布参数”成模板：暴露为参数，转成模板后在属性面板里调 | 基于物理的行为（有状态，违反规则 2） |
| Blender | 动作、F 曲线、插值模式 | 每个关键帧决定“到下一个关键帧”的插值；常量插值 = 保持；曲线视图 | 节点式驱动器 |
| Rive | 状态机、时间线 | 编辑器与运行时分离、文件格式是唯一真相 | 状态机（交互式，转场用不到） |
| Lottie | 一份 JSON 描述全部图层和关键帧，播放器只解释它 | 声明式 JSON 文档 + 小解释器 | Lottie 格式本身 |
| Jitter | 浏览器里的轻量动效 | 缓动预设 + 贝塞尔自定义；时间轴上直接拖关键帧 | 协作、云端（规则 10） |
| Cavalry | 过程化、复制器 | 复制器（按网格、一条线、一圈复制，按名次错开） | 求解器（有状态） |
| Theatre.js | 对象 + 属性 + 序列；编辑界面与运行时分包 | 编辑界面与运行时分离 | 代码本身（规则 7） |

结论：**Lottie 式的声明式文档**（唯一真相、可读、能 diff、能被 agent 稳定地读写）+ **AE 式的编辑交互** + **Motion 式的“发布成模板”**。

## 3. 动画文档（格式第 2 版）

`apps/desktop/src/shared/animation/schema.ts`，zod 校验。两格缩进的 JSON，关键帧一条一行（`serializeAnimation`）。可视化编辑每次都重新序列化；代码编辑保留用户的原文，直到下一次可视化编辑。

### 3.1 顶层

```json
{
  "kind": "allay-animation",
  "formatVersion": 2,
  "name": "新动画",
  "category": "overlay",
  "duration": 2,
  "cutTime": null,
  "camera": { "type": "ortho" },
  "params": [],
  "layers": [ … ],
  "sounds": [],
  "markers": [{ "id": "marker-1", "t": 0.6, "label": "落地" }],
  "workArea": { "from": 0.2, "to": 1.4 }
}
```

- **坐标**：舞台设计单位（短边 1080，原点在画面中心，+y 向上，与 `ctx.stage` 一致）。旋转是度，缩放是倍数，不透明度 0–1。
- `category`：overlay / transition / title；转场必须有剪辑点 `cutTime`。
- `camera`：正交（默认，2D 排版），或透视（`fov` 是垂直视角，度；相机放在 z = 0 平面恰好填满舞台的位置，同 `ctx.createStageCamera`）。
- `markers`、`workArea` 只是编辑用的（3.9），画面不用。

### 3.2 图层

所有图层共有：`id`（小写字母、数字、连字符）、`name`、`type`、`props`（3.3）、`from` / `to`（可见区间 `[from, to)`）、`parent`（父图层的 id，4.3）、`hidden`、`solo`、`locked`（6.2）、`repeat`（复制器，3.6）、`path`（路径，3.7）。`doc.layers` 的顺序就是画的顺序（后面的画在前面）。

| 类型 | 内容字段 | 说明 |
|---|---|---|
| `block` | `block`、`size`（边长） | 方块目录里的方块，立方体；没有混合方式（用引擎的实例材质） |
| `item` | `item`、`size`（高） | 物品 |
| `text` | `text`、`size`（一个字体像素多少设计单位）、`color`、`shadow`、`align`、`font`、`chars`（逐字，3.8） | 引擎的文字；换行就是分行 |
| `rect` | `width`、`height`、`radius`（圆角）、`color` / `gradient`、`stroke` | 矩形 |
| `ellipse` | `width`、`height`、`color` / `gradient`、`stroke` | 椭圆 |
| `line` | `width`（长）、`height`（粗）、`color` / `gradient`、`cap`（round / butt） | 线段 |
| `image` | `image`（贴图 ID、`asset:`、`file:` 或空）、`width`、`height`、`nineSlice`、`pixelSize` | 原版贴图、GUI 精灵、模板包里的图片、本机图片；九宫格边框按贴图像素 |
| `group` | 无 | 只有变换，不画东西；子图层用 `parent` 指向它 |

- `gradient`：`{ type: linear | radial, from, to, angle }`，linear 沿 `angle`（0 是从左到右，90 是从下到上），radial 从中心到外框边缘。
- `stroke`：`{ color, width }`，画在形状里面（外框不变）。
- `blend`：normal / add / multiply / screen（4.6），除方块和组以外都有。

### 3.3 属性与关键帧

九个属性：`x`、`y`、`z`、`rotX`、`rotY`、`rotZ`、`scale`、`opacity`、`progress`（沿路径走到哪里，只在有路径时有意义）。每个属性是常量，或按时间排好序的关键帧 `{ t, v, ease? }`。`ease` 是**从这个关键帧到下一个**的缓动：模板接口的缓动名、三次贝塞尔四元组，或 `hold`（保持，到下一个关键帧再跳）；缺省线性。关键帧之前取第一个值，之后取最后一个值。

### 3.4 参数与绑定

- 值可以写成 `{"$param": 键}`，绑定到顶层 `params` 表里的参数（键 `animationSource` 保留给编辑时的预览，5.5）。能绑定的地方：图层的方块、物品、文字、颜色、字体、大小（宽、高、圆角）、图片，常量属性，某个关键帧的值，整段时长，音效。
- 参数类型：number、duration、block、item、text、color、font、sound、texture，与 manifest 的参数类型一一对应；转成模板后 texture 参数允许用户选本机图片（`allowFile`）。
- **时长参数**：整段时长绑定到 duration 参数时，所有时刻（关键帧、可见区间、音效、剪辑点）按“取值 ÷ 默认值”等比伸缩，转成模板后时间轴上画成一段可拖。
- **字体**：引擎只在 setup 之前载入 font 参数里出现的字体，所以用了非默认字体、又没暴露成参数的文字图层，生成 manifest 时每种字体自动加一个 font 参数（`autoFont1`…，在收起的“字体”分组里）。
- **求值的两份实现**：编辑器用 `resolve.ts` 的 `resolveDoc`，Worker 用 `runtime.template.js` 的 `resolveAnimation`，规则相同（T-ANIM-11 用同一组输入核对）。

### 3.5 音效

`{ id, at, sound, gain, rate, position? }`，在 setup 里经 `ctx.audio.cue` 声明。`position` 是空间音效的声源位置（单位是格，同 `ctx.audio.cue`）。

### 3.6 复制器

`repeat`：网格（`cols × rows`、`spacing`，最多 256 份）、一条线（`count`，每份相对上一份位移 `spacing`）、一圈（`count`、`radius`、`arc`、`orient` 朝外转）。每一份按名次晚 `stagger` 秒播放图层自己的动画（可见区间也跟着晚）；名次：按序号、倒序、从中心向外（同样远的同一名次）、随机。随机抖动（位置、旋转、缩放）和随机名次来自 `ctx.random('repeat:<图层 id>:<seed>')`。方块图层还可以给方块列表和“方块排列”，规则与方块擦除、方块坠落模板相同。组不能复制。

### 3.7 路径

`path`：`{ points: [{ x, y, in?, out? }], closed, orient }`，点和每个点的入、出贝塞尔手柄（相对点的位置）。`progress` 按长度匀速（每段分 32 小段估长度建表），图层的 x、y 是相对路径的偏移，`orient` 时 rotZ 加上切线方向。路径几何写了两份：编辑器的 `path.ts` 和 Worker 里的运行时（T-ANIM-28 核对）。

### 3.8 逐字动画

文字图层的 `chars`：`{ stagger, order, seed }`。每个字（空格除外）一份，摆在它在整段里的位置，按名次晚 `stagger` 秒播放这个图层自己的动画，位置、旋转、缩放以每个字自己的中心为准。不能和复制器同时用，最多 256 个字。字的位置用 `ctx.text.create` 量（字宽、两字之间的间隔、空格的步长、行距；居中时每行的偏移取整到字体像素，同引擎的位图文字），与整段文字逐像素一致（T-ANIM-31 用位图字体和 unihex 字形核对）。

### 3.9 标记与工作区

- `markers`：`{ id, t, label? }`，最多 64 个。是吸附点，可以跳过去（6.7）。
- `workArea`：`{ from, to }`。预览在这一段里循环播放；**画面和导出不受影响**。

### 3.10 限制与版本

64 个图层、每条轨道 256 个关键帧、32 个参数、文本 512 KB、时长 0.1–30 秒。不认识的字段、重复的 id、成环的父级、转场缺剪辑点、绑定到类型不对的参数都拒绝，错误带路径（JSON 语法错误带行列）。第 1 版的文档读入时迁移（版本号改成 2，音效补上 id）；更高的版本拒绝。

## 4. 运行：生成的模板与解释器

### 4.1 两份模板代码

```
// @allay-animation
const ANIMATION = {…文档…};                         // 转为模板时：文档嵌在代码里
async function createAnimation(ctx, doc) { … }       // 解释器（runtime.template.js 原文）
export default { setup(ctx) { return createAnimation(ctx, ANIMATION); } };
```

- **转为模板**（`animationTemplateCode`）：文档以 JSON 字面量嵌入（JSON 是 JS 表达式的子集，文字内容里的引号、换行改变不了代码结构，T-ANIM-1 有专门的测试）。
- **编辑时的预览**（`draftTemplateCode`）：代码对每份文档都一样，文档从隐藏的 text 参数 `animationSource` 里读。改文档只是改参数值，预览走 `setParams`（只重跑 setup，不重新分析、装载代码，5.5、第 8 节）。
- 两份都过 `analyzeTemplateCode`（语法、import、确定性规则 H12）。解释器只用 `ctx`，`update(t)` 不分配内存。
- manifest：`name`、`category` 取自文档，`params` 是参数表（加上自动的字体参数），时长绑定到参数时有 `timeline.segments`。

### 4.2 求值

先 `resolveAnimation(doc, ctx.params)` 把绑定换成取值（3.4），再建图层。每个图层：一份或多份（复制器、逐字），每份是一个画法（`apply(可见, 不透明度, 矩阵)`）。

### 4.3 层级

按拓扑顺序算：世界 = 父级的世界 · 复制器偏移 · 自己的平移旋转缩放 · 大小。父级的“大小”只用在父级自己身上，不传给子图层；不透明度沿父级相乘；父级隐藏或不在可见区间时子图层也不画；独显传给子孙。子图层接在父级本身（第 0 份、不晚开始）后面，不跟着复制。

### 4.4 复制器与逐字

每一份 `tt = t − delay`，在 `tt` 处取图层自己的动画。方块的各份按方块种类分组成实例网格，不可见的份缩成一个点，整组都不可见时不画。

### 4.5 路径

路径的长度表在 setup 里建好，`update` 时按 `progress` 二分查找，写进预先分配的对象。

### 4.6 形状与混合

形状是 `THREE.ShapeGeometry`（圆角用圆弧，16 段）；描边是一个带洞的环，画在填充上面。渐变是一张 64 × 64 的 sRGB 贴图按外框铺（不用自定义着色器，色彩管理与别的材质相同）。混合方式按预乘 alpha 设混合因子（画面缓冲是线性、预乘的）：相加 src + dst，正片叠底 src·dst + dst·(1 − a)，滤色 src·(1 − dst) + dst；alpha 一律按普通叠加。所以**在透明背景上**，正片叠底会发黑——导出透明视频时这几种模式要在剪辑软件里叠到画面上才是想要的效果。

### 4.7 图片

`ctx.resources.texture(id)` + `ctx.sprite.create`（九宫格时带 `nineSlice` 和 `pixelSize`），`setSize(width, height)`。空图片不画。本机图片的 `file:` 引用在工程和转为模板时的处理见 5.2、5.3。

## 5. 与工程、模板的关系

```
动画文档（唯一真相） ──▶ 预览模板（文档在参数里） ──▶ 引擎 Worker（和任何模板一样）
       ▲                                         
       │ 可视化编辑 / 代码编辑 / 代码窗口 / 外部编辑器
       └──“转为模板”──▶ userData/templates/<id>/1.0.0/ manifest.json · template.js · animation.json · assets/
                ◀──“在动画编辑器里打开”、“更新原模板”──
```

### 5.1 工程文件

编辑中的动画存在工程文件里：`.allay` 多一个可选字段 `animation`（完整的文档）。有它时 `template` 只是这个动画的标识（`user.<随机>.animation@0.0.0`），打开时从文档生成模板。旧工程没有这个字段，照旧按 `template` 去模板库里找。保存的是**最后一份合法的文档**；代码视图里解析不过的文本不进工程文件。

### 5.2 本机图片

`file:` 引用只在这次运行有效。保存工程时图片图层的 `file:` 在文档里存成空，路径记进 `animationFiles`（图层 id → 本机路径）；打开时重新签发引用，找不到的报告图层名。规则和信任模型与 texture 参数的 `files` 相同。

### 5.3 转为模板

主进程自己再解析一遍文档，生成 manifest.json、template.js、animation.json，写成新的用户模板（`user.<6 位十六进制>.<名字>`，版本 1.0.0），写好 `template-api.d.ts` 和 `jsconfig.json`。图片图层的本机图片复制进 `assets/`（`image-<图层 id>.<扩展名>`，只认 PNG、JPEG、WebP 的文件头），文档里换成 `asset:` 引用；读不出的拒绝转换。它出现在模板库的“我的模板”里，能用“导出模板包”分享。

### 5.4 重新打开、更新原模板

- “在动画编辑器里打开”（开发页、命令面板）：读用户模板的 animation.json，新开一个动画，记下它来自哪个模板（`origin`，不存进工程文件）。template.js 在外部编辑器里被改过（与 animation.json 生成的不一样）时先问：之后“更新原模板”会覆盖那些改动。
- 来自模板的动画，检查器的“整段动画”里有“更新原模板”（id、版本不变，重写三份文件和图片，模板库刷新、正在用它的预览热重载）和“另存为新模板”。
- 主进程的两个 IPC 只收 id 和版本、不收路径，按用户模板目录校验。

### 5.5 预览的快速路径

编辑时的预览模板（4.1）的 manifest 只取决于名称、分类和参数表；`projectStore` 总是按 `template.animation.doc` 填文档参数。改文档时 manifest 没变就只改参数（`setAnimationSource`，不加 `structureRevision`），预览走 `setParams`；改了名称、分类、参数表才重新装载。撤销重做同样判断。保存的工程里不存文档参数。

## 6. 界面

位置和样式见 `docs/06-ui-design.md` 6.15。入口：文件菜单“新建动画”、命令面板、开发页。

### 6.1 原地变形

当前模板是自建动画时界面在原地变：只服务模板的东西（左栏“模板”“预设”、右栏“属性”、阶段时间轴）淡出（120 ms，错开 60 ms），换成“图层”、“动画”检查器和关键帧时间轴（高度从 236 平滑长到 280），再淡入。预览、“输出”、“开发”、顶栏、状态栏不动。只改透明度和尺寸；“减少动效”时直接切换。

### 6.2 图层面板

按树显示（子图层缩进），每行有隐藏、独显、锁定三个开关，双击改名；拖动排序（放在某行的上半、下半，或放进组里）；Shift 连选、Ctrl 加选。底部：成组（Ctrl+G）、解组（Ctrl+Shift+G）、复制（Ctrl+D）、删除。解组时组自己有变换就拒绝（准确保持画面要把组的变换乘进子图层的每个关键帧，旋转加不等缩放时表示不了）。锁定的图层不能在预览里选中拖动，检查器只读。

### 6.3 检查器

- 没选图层：整段动画（名称、分类、时长、剪辑点、相机）、参数表、转为模板 / 更新原模板。
- 选了图层：内容（随类型：方块、物品、文字和逐字、形状的大小圆角填充描边线端、图片和九宫格）、混合方式、父级、可见区间；变换（九个属性，左边的菱形：实心 = 当前时刻有关键帧，空心 = 有动画，暗 = 常量）；复制器；路径；选中的关键帧（时刻、数值、保持、缓动）。
- 能绑定参数的行右边一个链接按钮：暴露为新参数、绑定到已有参数、解除绑定。
- 改动都经类型化命令（第 7 节）。

### 6.4 时间轴

上面是播放条、撤销历史（6.8）、缩放（6.7）、“关键帧 / 曲线”切换和吸附开关；下面左侧图层名（可展开成各属性），右侧刻度（标记、工作区、剪辑点）、可见区间条（两端可拖）、关键帧菱形、音效轨和播放头。

### 6.5 曲线视图

左边列出有关键帧的属性（点一下显示或隐藏），右边把显示的属性叠在一张图上，每条一种颜色。拖关键帧改时刻和数值（Shift 只改数值、Alt 只改时刻）；选中的关键帧两侧画出它所在段的缓动的贝塞尔手柄，拖手柄改这一段的缓动（预设缓动先换成近似贝塞尔，差不到 0.02）。“数值 / 速度”切换；“各自的纵轴”让每条曲线用自己的范围。

### 6.6 多个关键帧

点选、Shift / Ctrl 加选、框选（碰到就算）；拖选中的任意一个整组一起挪（被拖的那个对齐到帧，再吸附到播放头、别的关键帧、标记、工作区两端、音效、剪辑点，Alt 临时不吸附）；选中两个以上时刻度上的范围条两端是缩放时间的手柄；方向键按一帧挪（Shift 十帧）；Ctrl+C / Ctrl+V（跨图层、跨属性）、Delete、Ctrl+A；对齐到播放头、对齐到帧。

### 6.7 缩放、标记、工作区

- 缩放：放大、缩小、显示整段三个按钮；Ctrl+滚轮在指针处缩放，Shift+滚轮（或横向滚轮）左右滚；缩放后刻度下面一条缩略条，拖它滚动；播放头跑出可见范围时翻页。最多放大到 0.1 秒。关键帧视图和曲线视图共用一个范围（`time-view.ts`）。
- 标记：Shift+M 在播放头处加；拖动改时刻（吸附），点一下跳过去；右键重命名、删除。
- 工作区：B / N 把开头 / 结尾设在播放头；刻度上一条强调色的带子，两端可拖；预览在工作区里循环播放（导出不受影响）。

### 6.8 撤销历史、右键菜单

- 撤销历史：时间轴标题行的按钮，列出这次编辑的每一步（名字同撤销菜单），点哪一步回到哪一步，之后还能重做。
- 右键菜单按点中的东西给条目：关键帧（复制、粘贴、对齐到播放头、六种缓动、删除）、图层名（复制、成组、解组、隐藏、独显、锁定、删除）、标记（跳过去、重命名、删除）、刻度和空白处（跳到这里、在这里加标记、工作区从这里开始 / 到这里结束、清除工作区、把关键帧粘贴到这里）。条目都经命令执行，右侧显示快捷键。

### 6.9 快捷键

空格播放、Home / End、←→ 一帧（Shift 十帧）、J / K 上一个 / 下一个关键帧（选中的图层的，没选时全部）、Shift+J / Shift+K 标记、Shift+M 加标记、B / N 工作区、Ctrl+C / V / A / D / G、Ctrl+Shift+G、Delete、Ctrl+Z / Ctrl+Shift+Z。都是命令的快捷键，可以在设置里改键；文本框里、弹层里单键不生效。

### 6.10 在预览里直接变换

预览上盖一层（`StageOverlay`）：点画面选中图层（画在最前面的、可见、没锁定的），Shift / Ctrl 加选；主选中的有四角缩放手柄（等比）和上方的旋转手柄（Shift 按 15° 吸附）；拖框内移动，图层中心吸附到舞台中线、四边和别的图层的中心，吸住时画参考线，Alt 不吸附。改的是当前时刻的 x、y、scale、rotZ（有关键帧的落关键帧，绑定的改参数默认值），一次拖动一步撤销。有路径时画出路径，拖点、拖手柄改路径，Alt 从点上拖出一对对称的手柄。

几何是编辑器自己算的（`stage-geometry.ts`），不问引擎：平面变换沿父级相乘；透视相机下按图层原点的深度整体缩放 D / (D − z)（T-ANIM-41 与 three.js 的投影核对）；方块、物品按 rotX、rotY 算投影的外框；文字的宽高按字数估。图层自己的厚度和 rotX / rotY 造成的透视变形不算。

### 6.11 代码：面板、代码窗口、实时预览

- “动画代码”停靠面板：开发模式开着时用内嵌的 CodeMirror（JSON 高亮、错误行内标出、Ctrl+S 立即生效），关着或模块被拆掉时是文本框。改完停 400 ms 解析，过了就换文档；不过就列出原因，预览保持上一份。
- **代码窗口**：第二个窗口，和主窗口实时双向同步；文档的主人仍是主窗口的工程状态，代码窗口的编辑交回主窗口执行 `animSetText`，进同一份撤销历史，Ctrl+Z 也让主窗口撤销。安全：同一份 webPreferences 和 preload、同一个 `app://` 协议和 CSP；IPC 来源白名单按创建时登记的 `webContents.id` 认它，它只能调 `codeWindow:send` 一个通道，消息都经主进程转发、两端按 `shared/code-window.ts` 的 zod schema 校验。
- **实时预览**：开着时代码窗口标出这一刻在生效的代码——每个可见图层的开头一行、每条有关键帧的属性所处的区间（保持的区间用标记色）、绑定到参数的值、复制器、路径和逐字动画整段（标签写份数、点数、字数）；点代码里的某处，主窗口跳到它生效的时刻。映射完全从文档结构推出来（`source-map.ts`），不在 Worker 里埋探针。

### 6.12 外部编辑器

设置“开发”页的“代码编辑器”：应用自带（默认）/ 系统默认 / 指定程序（经主进程的文件对话框选）。外部编辑器打开的是 `userData/animations/<动画的标识>.json`（文件名由主进程按标识决定）；系统默认用 `shell.openPath`（只会是 .json），指定程序用 `spawn(程序, [文件], { shell: false })`。外部保存了 → 推给主窗口 → `setAnimationText`；主窗口改了 → 改写文件（防抖 300 ms，自己写的不回推）。

### 6.13 拖动的实现

一次拖动一步撤销：按下时记下文档，每次移动都从按下时的那份重新算，提交时是一次手势。拖动的指针监听挂在 window 上（`pointer.ts`）：关键帧按时刻作 React 的 key，拖动中元素会被换掉。

## 7. 命令

全部经注册表的 `dispatch`，入参、返回值都有 zod schema，write 命令进撤销历史并标明来源。这就是将来内置 agent 或 MCP 的工具面（这次不做 MCP，H-MCP 未批准）。

| 类别 | 命令 |
|---|---|
| 文档 | `animNew`、`animGet`、`animSetText { text, baseRevision? }`（修订号对不上就拒绝）、`animUpdateDoc { name?, category?, duration?, cutTime?, camera? }` |
| 图层 | `animAddLayer { type }`、`animRemoveLayer`、`animUpdateLayer { layer, fields }`（内容字段，null 去掉；id、type、props、parent 不能改）、`animSetLayerFlags`、`animRenameLayer`、`animDuplicateLayers`、`animGroupLayers`、`animUngroup`、`animSetParent`、`animMoveLayer`、`animMoveLayerRelative`、`animSetLayerInterval`、`animSetRepeat`、`animSetPath` |
| 属性和关键帧 | `animSetPropValues { layer, values, t? }`（同预览里的拖动）、`animSetKeyframe`、`animRemoveKeyframe`、`animMoveKeyframe`、`animMoveKeys`、`animScaleKeys`、`animAlignKeys`、`animDeleteKeys`、`animCopyKeys`、`animPasteKeys`、`animSetSegmentCurve`、`animSetKeysEase` |
| 参数和音效 | `animAddParam`、`animUpdateParam`、`animRemoveParam`、`animExposeParam`、`animBindParam`、`animUnbindParam`、`animAddSound`、`animUpdateSound`、`animRemoveSound` |
| 时间轴 | `animAddMarker`、`animMoveMarker`、`animRenameMarker`、`animRemoveMarker`、`animSetWorkArea`、`animWorkAreaStart`、`animWorkAreaEnd`、`animClearWorkArea`、`animPrevKey`、`animNextKey`、`animPrevMarker`、`animNextMarker`、`animStepBack`、`animStepForward` |
| 作用于当前选择（带快捷键） | `animCopySelection`、`animPasteSelection`、`animDeleteSelection`、`animSelectAllKeys`、`animAlignSelectionToPlayhead`、`animSnapSelectionToFrames`、`animDuplicateSelection`、`animGroupSelection`、`animUngroupSelection`、`animToggleSnap`、`animToggleGraph` |
| 模板 | `animConvertToTemplate`、`animEditTemplate { id?, version? }`、`animUpdateTemplate` |
| 代码 | `animEditCode`、`animOpenCodeWindow`、`animOpenExternal`、`animToggleCode` |

绑定的目标、关键帧都按“图层 id + 字段 / 属性 + 时刻”寻址，不按数组下标。

## 8. 性能

用 T-ANIM-32（`tests/e2e/anim-perf.spec.ts`）量：64 个图层（一个方块图层带 16 × 16 = 256 份复制器，21 个文字、42 个形状），每层 4 条属性各 4 个关键帧。“拖动”是每个动画帧改一次（拖动时每次指针移动就是一次改动），连续 120 帧。2026-11 在开发机（Windows，硬件加速的 WebGL）上：

| 情形 | 界面帧间隔（中位数 / p95） | 预览每秒更新 | 单次改动 → 画好（中位数） |
|---|---|---|---|
| 优化前（每次改动重新装载） | — | — | 约 70 ms |
| 拖关键帧的值 | 17 / 25 ms | 39 次 | 53 ms |
| 挪关键帧 | 17 / 35 ms | 29 次 | 53 ms |

- 瓶颈先量出来再改：渲染进程每次改动约 14 ms（校验、序列化、React），Worker 里一次 setParams 约 22 ms，其中模板的 setup 13 ms——**几乎全是文字栅格化**（每个文字约 0.6 ms，21 个文字；没有文字时 setup 1 ms）。
- 做的两件事：预览模板从参数读文档，改文档走 setParams（5.5）；引擎按输入缓存栅格化过的文字（`fonts.ts`，同样的字体、文字、样式、大小画出同样的像素，随资源栈清空，最多 512 项；只是省时间，画面不变，引擎测试 T-ANIM-32 核对缓存前后逐字节相同）。
- 没有降画质、没有跳过子帧。界面一直是 60 帧；预览在拖动时每秒更新 30–40 次（预览本来就是“每个动画帧最多装载一次”，再加一次 setup 和一次渲染）。挪关键帧时偶尔掉一帧（时间轴上那个菱形按时刻作 key，要重新挂载）。

## 9. 功能与验收测试总表

“应用里自动走过”是端到端测试在真实的 Electron 应用里用 Playwright 操作过（点、拖、按键，看画面哈希和文档）；“人看过”是有人用眼睛看过界面和画面的观感。这次所有的验证都是自动的，没有人看过的写“没有”。

| 功能 | 验收测试 | 应用里自动走过 | 人看过 |
|---|---|---|---|
| 文档格式、序列化、错误定位、注入安全、工程兼容 | T-ANIM-1、T-ANIM-11 | — | — |
| 解释器：插值、缓动、保持、可见区间、乱序取帧 | T-ANIM-2（在 T-ANIM-1 里） | — | — |
| 新建、加图层、关键帧、预览、撤销、代码双向 | T-ANIM-3、T-ANIM-5 | 是 | 没有记录 |
| 转为模板 | T-ANIM-4 | 是 | 没有记录 |
| 实时预览的映射 | T-ANIM-6 | 是（T-ANIM-10） | 没有 |
| 代码窗口的安全与同步 | T-ANIM-7、T-ANIM-10 | 是 | 没有 |
| 外部编辑器 | T-ANIM-8 | 没有（单元测试模拟了外部保存） | 没有 |
| 界面原地变形 | T-ANIM-9 | 是（只看终态和高度） | 没有（过渡的观感） |
| 暴露为参数、时长参数、自动字体参数 | T-ANIM-11、T-ANIM-12、T-ANIM-16 | 是 | 没有 |
| 音效轨 | T-ANIM-13、T-ANIM-17 | 是 | 没有 |
| 多个关键帧 | T-ANIM-14、T-ANIM-18 | 是 | 没有 |
| 曲线视图、贝塞尔手柄、各自的纵轴 | T-ANIM-15、T-ANIM-19、T-ANIM-20 | 是 | 没有 |
| 图层：层级、组、复制、开关、排序、区间 | T-ANIM-21、T-ANIM-22、T-ANIM-23 | 是 | 没有 |
| 预览里直接变换 | T-ANIM-24、T-ANIM-25 | 是 | 没有 |
| 透视相机、带 z 的图层的选择框 | T-ANIM-41 | 是 | 没有 |
| 复制器 | T-ANIM-26、T-ANIM-27 | 是 | 没有 |
| 路径动画 | T-ANIM-28 | 是 | 没有 |
| 形状、渐变、描边、混合方式 | T-ANIM-29 | 是 | 没有 |
| 图片图层、本机图片的保存与转为模板 | T-ANIM-30 | 是（贴图 ID；本机图片只在单元测试里走过） | 没有 |
| 逐字动画（含真实位图字体、unihex 中文字形的排版） | T-ANIM-31（单元、引擎） | 是 | 没有 |
| 改文档走 setParams、文字缓存、拖动的帧时间 | T-ANIM-32（单元、引擎、端到端） | 是 | 没有 |
| 重新打开转出来的模板、更新原模板 | T-ANIM-33 | 是 | 没有 |
| 缩放和滚动、标记、工作区、撤销历史、右键菜单 | T-ANIM-34、T-ANIM-35、T-ANIM-36、T-ANIM-38、T-ANIM-39 | 是 | 没有 |
| 跳转快捷键、帧步进 | T-ANIM-37 | 是 | 没有 |
| 类型化命令、实时标记覆盖复制器 / 路径 / 逐字 | T-ANIM-40 | 是（界面改动都走这些命令） | 没有 |

测试文件：单元 `tests/unit/T-ANIM-*.test.ts`（另有 `project-service.test.ts`、`template-dev.test.ts` 里的 T-ANIM-30、T-ANIM-33），引擎 `tests/engine/m2.spec.ts`（T-ANIM-31、T-ANIM-32），端到端 `tests/e2e/anim.spec.ts`、`anim-r3.spec.ts`、`anim-perf.spec.ts`。

## 10. 没验证的

- **人眼**：第二轮以后的界面都没有人看过（变形过渡、曲线视图、预览上的手柄、路径、右键菜单、缩放后的刻度）；只有自动测试看过终态。
- **导出**：动画工程的导出走现有的导出任务（代码路径与模板相同），这几轮没有在真实剪辑软件里看过导出的视频；混合方式在透明背景上的表现（4.6）、渐变在 10 bit 导出里的色带都没看过。
- **素材**：图片图层、九宫格、逐字动画只用测试生成的假素材（纯色贴图、拼出来的位图字体和 unihex 字形）验证过，没有在本机的原版素材上看过；本机图片的选择对话框没有自动化（端到端测试经代码写贴图 ID）。
- **几何**：预览的选择框是平面近似（6.10），图层自己的厚度和 rotX / rotY 的透视变形不算；文字的框按字数估。
- **输入法**：中文输入法下在代码编辑器、参数名称、文字内容里打字。
- **外部编辑器**：没有真的启动 VS Code；“系统默认”在没有给 .json 关联程序的机器上会弹“选择打开方式”。
- **性能**：第 8 节的数字只在开发机上量过；没有量更慢的机器、软件渲染。
- **遮罩**：没有做（`docs/decisions.md`“第二批”）：引擎的渲染器没有开模板缓冲，做遮罩要改引擎的渲染设置和帧管线。

## 11. 来历

- 第一期（2026-11-15 的反馈）：文档、四种图层、八个属性、关键帧、预览、代码双向、转为模板、命令。
- 第二轮反馈（2026-11-19）：界面原地变形、代码窗口、实时预览、外部编辑器（6.1、6.11、6.12）。用户原话（经主控转达）：“动画编辑器我先要的效果是启动逐渐变样成专业的软件界面，部分模板的便携功能隐藏消失，被专业的功能出现替代，然后代码编辑器是另开个窗口实时双向同步查看，允许开启实时预览功能（动画在哪一帧使用了哪段代码，自动跳转标记）（允许使用别的编辑器打开，如 vs code。默认打开应用自带的）”。
- 第三轮（2026-11-19 起，三批，12 项；用户的要求是“完善动画编辑器内容”，把第一期时列的第二期、第三期全部做完）：第一批暴露为参数、音效轨、曲线视图、多个关键帧；第二批图层、预览里直接变换、复制器、路径、新图层类型；第三批性能、模板往返、时间轴、命令和收尾。
