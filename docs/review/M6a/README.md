# M6a 评审：内置模板 T2 至 T6

**做了什么**：五个内置模板 `block-fall`、`item-stinger`、`loading-screen`、`pixel-dissolve`、`advancement-toast`，参数、分组、时间段、默认值照 `docs/04-templates.md` 4.10，各自打成 `.allaytpl`，只用公开的模板接口。T2、T3、T6 在 `setup` 里声明音频 cue（原版事件名）；播放和混音在 M6 后半。六个模板都过了 T-TPL-3、T-TPL-4、T-TPL-5。首末帧全透明、剪辑点完全不透明照 T1 的时间余量做法，逐个模板的论证在 `docs/decisions.md` 的 M6a 小节。

**关键帧**（纯色假资源栈，不含原版贴图；每张图三行是 16:9、9:16、1:1，五列是 0%、25%、剪辑点、75%、100%，棋盘格是透明）：`block-fall.png`、`item-stinger.png`、`loading-screen.png`、`pixel-dissolve.png`、`advancement-toast.png`。由 `make-sheets.ts` 从 T-TPL-5 的基准图拼成。用本机真实游戏截的同样画面在被忽略的 `out/`，不提交。

**和规格不同的地方**（详见 decisions）：

- T3、T5 的“方块填充”要取方块的面贴图，模板接口里没有这个能力；现在从 `block(id).single()` 的网格里找朝向相机那一面的材质贴图。**建议新增 `BlockHandle.faceTexture(face)`**，待主控决定。
- T3 前后沿是斜率 0.4 的斜线（`stairs` 是它量化成的阶梯），条纹在色带尾端之后；T5 的进度映射让停留阶段没有 accent 格；T6 文字放不下时面板加宽或加高，画幅放不下时缩小 `guiScale`；`headerColor` 保持默认值时按 `frame` 取色。
- T-TPL-3 的附加检查“一半以上的帧互不相同”对叠加层不计停留阶段的帧（T6 停留时本来就静止），转场类不变。

**没验证的**：真实原版资源下（本机 1.21.1）只在应用预览里截了几帧放在 `out/`（`out/real-shots.ts`，中文界面、预览画质 N = 1），实现会话看过、装载没有警告，但还没有人看过；音效没有播放过（不在本次范围）；没有导出到剪辑软件里看；没有在核显上量 2.11 的性能预算。
