# 02 渲染引擎

包：`packages/engine`。只依赖 `three` 和 `packages/template-sdk`。不得引用 React、Electron、Node API、DOM，只用 Worker 里可用的 Web API。

## 2.1 三条不可破坏的原则

1. **画面是时间的纯函数。** 对同一组（模板、参数、资源栈、输出设置），`render(t)` 永远产出同一帧，与调用顺序、真实时钟、之前渲染过什么无关。
2. **预览和导出是同一份代码。** 区别只有分辨率、子帧数、像素去向。
3. **模板代码只在引擎 Worker 里运行。** 它接触不到 DOM、IPC、文件系统和网络。

任何让这三条变弱的改动都要先停下来问人。

## 2.2 运行位置

- 引擎跑在 Dedicated Worker（module worker）里。
- **预览 Worker** 常驻：主线程把 `<canvas>` 用 `transferControlToOffscreen()` 交给它。
- **导出 Worker** 每次导出新建，用 `new OffscreenCanvas(w, h)`，导出结束即销毁。取消导出就是 `terminate()`。
- **杂务 Worker** 懒创建：生成缩略图、安装模板时的试运行。空闲 30 秒后销毁。
- 三者是同一份 Worker 代码的不同实例。

## 2.3 宿主协议

宿主（渲染进程主线程）用 Comlink 调用下面的接口。像素缓冲用 `Comlink.transfer` 零拷贝传回。

```ts
interface EngineApi {
  init(opts: { canvas?: OffscreenCanvas; mode: 'preview' | 'export' | 'utility' }, host: HostCallbacks): Promise<void>;
  load(req: LoadRequest): Promise<LoadResult>;            // 装载模板并完成 setup
  setParams(params: ParamValues): Promise<LoadResult>;    // 销毁旧实例，用新参数重新 setup
  resize(width: number, height: number): void;            // 仅预览，单位是设备像素
  render(t: number, quality?: FrameQuality): Promise<FrameStats>;            // 预览：画到 canvas
  renderFrame(index: number, quality: FrameQuality, opaque?: { key: string }): Promise<ArrayBuffer>; // 导出
  renderThumbnail(req: ThumbRequest): Promise<ImageBitmap>;
  dispose(): void;
}

interface HostCallbacks {            // 宿主实现，经 Comlink.proxy 传入
  resolveResource(kind: 'texture' | 'sound-meta' | 'font' | 'raw', id: string): Promise<ResourcePayload | null>;
  log(level: 'debug' | 'warn' | 'error', message: string): void;
}

interface LoadRequest {
  manifest: TemplateManifest;
  code: string;                      // 模板的 ESM 源码文本
  params: ParamValues;
  output: { width: number; height: number; fps: number };
  resourceStamp: string;             // 资源栈指纹；变了就清空引擎内的资源缓存
}

interface LoadResult {
  duration: number;                  // 秒
  cutTime: number | null;            // 转场类模板的剪辑点
  audioCues: AudioCue[];
  warnings: string[];                // 比如“贴图 minecraft:block/xxx 缺失，已用占位图”
}

interface FrameQuality { subframes: number; shutterAngle: number }   // subframes = 1 表示没有运动模糊
interface FrameStats { t: number; ms: number }
interface AudioCue { sound: string; at: number; gain: number; rate: number; pan: number }
```

约定：

- `renderFrame` 返回**直通 alpha** 的 RGBA8，第一行是画面顶部，长度 `width * height * 4`。传了 `opaque.key` 时返回盖在该底色上的不透明画面（alpha 全 255）。
- 预览请求只保留最新的：宿主同一时刻最多一个在途 `render`，新的 `t` 覆盖排队中的旧请求。
- 宿主设看门狗：`load` 10 秒，预览单帧 5 秒，导出单帧 30 秒。超时就 `terminate()` 并重建 Worker，界面提示“模板无响应”。

## 2.4 模板装载与隔离

- 模板是**不含任何 import 的单文件 ESM**。装载方式：`URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))`，再 `await import(url)`，默认导出必须满足 `TemplateModule`（见 `04-templates.md`）。
- 模板需要的 `THREE` 和所有辅助函数都从 `ctx` 拿，不自带。
- Worker 启动后、装载第一个模板前，删除这些全局：`fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`indexedDB`、`caches`、`importScripts`、`BroadcastChannel`、`navigator.sendBeacon`。这是纵深防御；真正的边界是会话级网络拦截和 Worker 拿不到 IPC（见 `01-product-architecture.md` 的安全基线）。
- **开发构建**里，引擎在调用模板 `update(t)` 期间把 `Math.random`、`Date.now`、`performance.now` 换成会抛错的版本，用来尽早抓出不确定性。生产构建不拦截。
- 安装模板时做一次**确定性自检**：同一帧渲染两次，中间穿插渲染别的帧，两次像素不一致就在模板卡片上标注“预览与导出可能不一致”。

## 2.5 舞台坐标

- 设计单位：**画面短边恒为 1080**。16:9 的舞台是 1920×1080，9:16 是 1080×1920，1:1 是 1080×1080。
- 原点在画面中心，+x 向右，+y 向上，相机看向 −z。
- `ctx.stage = { width, height, aspect, fps, pixelScale }`，其中 `pixelScale = 输出短边像素 / 1080`。
- 默认相机是正交相机，刚好覆盖整个舞台。模板可以用 `ctx.setCamera(camera)` 换掉；`ctx.createStageCamera({ fov })` 返回一个透视相机，位置已经算好，使 z = 0 平面恰好填满舞台。
- 模板的布局必须由 `ctx.stage` 推出，不得写死 1920。竖屏和方屏是一等公民。

## 2.6 帧管线

**帧的定义**：时长为 `duration` 的模板共有 `lastIndex + 1` 帧，其中 `lastIndex = ceil(duration × fps − 10⁻⁶)`。第 `i` 帧的时间是 `t_i = min(i / fps, duration)`。也就是说首帧在 `t = 0`，末帧恰好在 `t = duration`，两端都渲染。这样“首末帧全透明”的规则（`04-templates.md` 4.6）才成立。引擎导出一个 `frameCount(duration, fps)` 函数，播放条和导出都用它，不各算各的。

对输出帧 `i`，画质为 `N` 个子帧、快门角 `A` 度时：

1. 子帧时间 `t_k = t_i + ((k + 0.5) / N − 0.5) × (A / 360) / fps`，并钳制到 `[0, duration]`。
2. 对每个子帧：调用 `instance.update(t_k)`，把场景渲染进 `sceneRT`。`sceneRT` 是 RGBA16F、线性色彩、MSAA 4×，每次清成 `(0, 0, 0, 0)`。此时缓冲里是**预乘 alpha**。
3. 把 `sceneRT × (1 / N)` 加法累积进 `accumRT`（RGBA16F）。`N = 1` 时跳过累积。
4. 全屏 resolve 着色器输出到 8 位目标，三种模式：
   - **预览**：反预乘，线性转 sRGB，再预乘，画到 canvas。canvas 的上下文用 `alpha: true, premultipliedAlpha: true` 创建，由浏览器合成到棋盘格或示例素材上。
   - **导出（透明）**：反预乘 `rgb / max(a, 1e-5)`，线性转 sRGB，输出直通 alpha。
   - **导出（不透明）**：在线性空间盖到底色上，转 sRGB，alpha 写 1。

   8 位的量化由着色器自己做，不交给驱动：直通的 sRGB 和 alpha 先四舍五入成整数 `s`、`a`，预览的预乘值用同一组整数算 `round(s × a / 255)`，写出时用 `(q + 0.25) / 255`（浮点转 8 位时无论驱动就近取整还是截断，存下来的都是 `q`）。这样预览和导出的 8 位值在任何显卡上都只差预乘本身的取整（见 `docs/decisions.md`“8 位量化由引擎自己做”）。
5. 导出时从 8 位目标 `readPixels`。上下翻转放在 resolve 着色器里做（采样时翻 v），CPU 不再翻。

Three.js 设置：`ColorManagement.enabled = true`；颜色贴图 `colorSpace = SRGBColorSpace`；`toneMapping = NoToneMapping`；渲染到 RT 时不做输出转换，由 resolve 着色器统一编码。材质保持 Three 默认的 `NormalBlending`，不要改混合函数，否则缓冲里的 alpha 会错。

resolve 着色器里可以加 ±0.5 LSB 的有序抖动，减轻辉光的色带。

### 帧管线的验收测试

| 编号 | 内容 | 判定 |
|---|---|---|
| T-ENG-1 | 确定性：同一模板的全部帧，顺序渲染一遍、乱序渲染一遍 | 逐字节相同 |
| T-ENG-2 | alpha：透明底上画一个 50% 不透明的纯白矩形、一个不透明的纯红矩形 | 导出像素分别为 `(255,255,255,128±1)` 和 `(255,0,0,255)`，矩形外为 `(·,·,·,0)` |
| T-ENG-3 | 运动模糊守恒：不透明白色矩形每帧平移 200 设计单位，`N = 16`、`A = 180` | 该行 alpha 之和等于矩形宽度 × 255，误差 ≤ 1%；两端 alpha 单调过渡 |
| T-ENG-4 | 预览与导出一致：同一 `t`、同一分辨率、`N = 1` | 预览 canvas 读回后换算成直通 alpha，与 `renderFrame` 每通道相差 ≤ 1 |
| T-ENG-5 | 分辨率无关：同一帧分别按 1080p 和 2160p 渲染，把后者缩小一半 | 与前者的平均绝对误差 ≤ 2/255 |

## 2.7 画质档位

| 场景 | 分辨率 | 子帧 N | 快门角 A |
|---|---|---|---|
| 预览播放 | 视口的设备像素，不超过输出分辨率 | 1 | — |
| 预览暂停且开了“高质量预览” | 同上 | 8 | 导出设置里的值 |
| 导出：草稿 | 输出分辨率 | 1 | — |
| 导出：标准（默认） | 输出分辨率 | 8 | 180 |
| 导出：高 | 输出分辨率 | 16 | 180 |
| 导出：极致 | 输出分辨率 | 32 | 180 |

快门角可在导出设置里调，范围 0–360，默认 180。

## 2.8 引擎提供给模板的内建能力

这些能力通过 `ctx` 暴露，接口定义在 `04-templates.md`。实现要点：

**方块**

- 方块形状来自应用自带的方块目录（见 `03-assets.md`），贴图经资源栈解析。
- 每种（几何，材质）组合一个 `InstancedMesh`。单个方块最多 6 个材质组，不做图集。
- 贴图过滤：放大用 `NearestFilter`，缩小用 `LinearMipmapLinearFilter` 并生成 mipmap。
- 面的明暗用固定系数烘进顶点色，不用动态光：顶面 1.0，底面 0.5，南北面 0.8，东西面 0.6。模板可以用 `shading: false` 关掉。
- 逐实例的不透明度和染色由引擎用 `InstancedBufferAttribute` 加 `onBeforeCompile` 实现一次，模板只调接口。
- 渲染类型：`opaque`、`cutout`（`alphaTest = 0.5`）、`translucent`（尽力排序）。
- 草、树叶、水的着色用固定常量（见 `03-assets.md`）。

**物品**

- 物品是把 16×16 贴图按不透明像素挤出 1 像素厚度的网格。正反面各一层，四周补侧壁。相邻同色面要合并。

**文字**

- 位图字渲染：每个字形一个四边形，像素对齐，不做平滑。
- 支持 Minecraft 式阴影：偏移 1 个字体像素，颜色是正文颜色各通道 × 0.25。
- 字体来源见 `03-assets.md`。

**精灵**

- 贴图四边形，支持九宫格拉伸，用于 GUI 面板。

**动画贴图**

- `.mcmeta` 动画贴图的当前帧是 `t` 的函数：`frame = sequence[floor(t × 20 / frametime) mod length]`。引擎在每个子帧更新 UV 偏移。v1 忽略 `interpolate`。

## 2.9 随机、噪声、缓动

- `ctx.random(key)` 返回一个独立的确定性随机流。实现：对 `"${seed}:${key}"` 做 cyrb128 哈希，用结果初始化 sfc32。`seed` 取 `params.seed`，模板没有这个参数时取 0。
- `ctx.noise2D(x, y, key?)`：带种子的 simplex 噪声，返回 `[−1, 1]`。
- `ctx.ease`：`linear`，`quad`/`cubic`/`quart`/`quint`/`expo`/`circ` 各有 `In`/`Out`/`InOut`，再加 `backIn`/`backOut`/`backInOut`、`elasticOut`、`bounceOut`；`ctx.ease.bezier(x1, y1, x2, y2)`；`ctx.ease.from(value)` 把缓动参数的值变成函数。
- `ctx.math`：`clamp`、`lerp`、`invLerp`、`remap`、`smoothstep`。
- `ctx.time.segment(t, start, duration)`：返回钳制到 `[0, 1]` 的进度。

需要模拟的效果（碰撞、堆叠）一律在 `setup` 里用固定步长预计算成查找表，`update` 只做查表和插值。

## 2.10 音频提示

- 模板在 `setup` 里调用 `ctx.audio.cue(soundId, at, opts)` 声明“某时刻播放某音效”。`update` 里不能声明。
- 引擎把全部 cue 放进 `LoadResult.audioCues` 交给宿主。预览时宿主用 Web Audio 实时调度，导出时用 `OfflineAudioContext` 走同一段调度代码离线混音（见 `05-export.md`）。
- 一个音效事件有多个变体时，引擎用 `ctx.random('sound:' + id + ':' + 序号)` 选定，并把结果写进 cue，保证预览和导出选到同一个。

## 2.11 性能预算

| 指标 | 预算 |
|---|---|
| 内置模板在 1080p、`N = 1` 时的 `update + render` | 核显级别（Iris Xe）≤ 8 ms |
| `setParams` 到新画面出现 | 内置模板 ≤ 50 ms |
| 单个模板的实例数 | ≤ 5000 |
| `update` 内的内存分配 | 零（不 new 对象、不建几何体或材质） |
| 1080p60、2 秒、标准画质的导出 | ≤ 20 秒 |

宿主把连续的参数变更节流到每个动画帧最多一次 `setParams`。
