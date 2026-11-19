# 04 模板系统

包：`packages/template-sdk`（类型、manifest 校验、参数校验）、`packages/templates`（内置模板）。

## 4.1 四个概念

| 概念 | 是什么 | 谁来做 | 扩展名 |
|---|---|---|---|
| **模板** | 一段运行在引擎里的脚本，加一份参数定义 | 内置，或会写 JS 的用户 | `.allaytpl` |
| **预设** | 某个模板的一组参数值 | 所有用户，一键保存 | `.allaypreset` |
| **派生模板** | 以某个模板为基础，改默认值、隐藏部分参数、带上自己的图片素材 | 所有用户，“另存为模板” | `.allaytpl` |
| **工程** | 当前正在编辑的模板 + 参数 + 输出设置 + 资源栈 | 所有用户 | `.allay` |

v1 的“用户自定义模板”由预设、派生模板、脚本模板三级组成。关键帧时间轴和可视化模板编辑器不在 v1 范围内，但模板格式要为它留出版本号（`formatVersion`）。

**内置模板必须用和用户模板完全相同的格式和接口来写，不走任何内部通道。**

## 4.2 模板包格式

`.allaytpl` 是一个 zip：

```
manifest.json        必需
template.js          脚本模板必需；派生模板没有
assets/              可选：模板自带的图片、音效
README.md            可选
```

## 4.3 manifest

```ts
type LocalizedString = string | { 'zh-CN'?: string; en?: string };

interface TemplateManifest {
  formatVersion: 1;
  id: string;                 // 小写反向域名，如 "allay.builtin.block-wipe"；用户模板不得以 "allay." 开头
  version: string;            // semver
  name: LocalizedString;
  description?: LocalizedString;
  author?: string;
  license?: string;
  category: 'transition' | 'overlay' | 'title';
  tags?: string[];
  groups?: { key: string; label: LocalizedString; collapsed?: boolean }[];
  params?: ParamDef[];        // 脚本模板必需
  timeline?: { segments: { param: string; label?: LocalizedString }[] };   // 把几个 duration 参数声明成首尾相接的时间段
  extends?: { id: string; version: string };                               // 派生模板必需
  overrides?: { defaults?: Record<string, ParamValue>; hidden?: string[] }; // 派生模板用
  defaultOutput?: { width: number; height: number; fps: number };
  minAppVersion?: string;
}
```

- `id` 的格式：`^[a-z0-9]+(\.[a-z0-9-]+)+$`。
- `timeline.segments` 按顺序列出若干 `duration` 参数。播放条把它们画成首尾相接的色段，用户拖动两段之间的分界线，就是在改左边那一段对应的参数（受该参数的 `min`/`max` 限制）。各段之和应等于模板的 `duration`，不等时播放条只画总时长。
- 用 zod 定义 schema，TS 类型从 schema 推出。未知字段保留但忽略。
- 读到更高的 `formatVersion` 时拒绝并提示升级应用；读到更低的版本走迁移函数链。

## 4.4 参数类型

所有类型共有的字段：

```ts
interface ParamBase {
  key: string;                       // 模板内唯一，^[a-z][a-zA-Z0-9]*$
  label: LocalizedString;
  hint?: LocalizedString;            // 鼠标悬停时的说明
  group?: string;
  visibleWhen?: { key: string; equals?: ParamValue; in?: ParamValue[]; not?: ParamValue };
}
```

| `type` | 值 | 专有字段 | 界面控件 |
|---|---|---|---|
| `number` | 数字 | `default` `min` `max` `step?` `unit?` `ui?: 'slider' \| 'field'` | 可拖拽数字框，可带滑块 |
| `integer` | 整数 | `default` `min` `max` `ui?` | 同上 |
| `boolean` | 布尔 | `default` | 开关 |
| `enum` | 字符串 | `default` `options: { value, label, pattern? }[]`，可选 `ui: 'pattern'` | 声明了 `ui: 'pattern'` 时用图案小格选择器（见下）；否则 4 项以内用分段控件，否则下拉 |
| `color` | `#RRGGBB` 或 `#RRGGBBAA` | `default` `alpha?` `palette?: 'dye' \| 'chat'` | 色块 + 取色弹层 |
| `text` | 字符串 | `default: LocalizedString` `maxLength?` `multiline?` | 文本框 |
| `block` | 方块 ID | `default` | 方块选择器 |
| `blockList` | `{ id, weight }[]` | `default` `max?` | 多选方块 + 权重 |
| `item` | 物品 ID | `default` | 物品选择器 |
| `texture` | 资源 ID、`asset:路径` 或 `file:路径` | `default` `allowFile?` | 贴图选择器，可导入图片 |
| `sound` | 音效事件 ID 或 `null` | `default` | 下拉 + 试听 |
| `easing` | 预设名或 `[x1, y1, x2, y2]` | `default` | 缓动选择器 |
| `duration` | 秒 | `default` `min` `max` | 数字框，同时显示帧数，吸附到帧 |
| `angle` | 度 | `default` `snap?` | 方向盘 |
| `seed` | 整数 | `default` | 数字框 + 骰子按钮 |
| `font` | `{ family, bold, italic, underline, strikethrough, shadow, outline }` | `default`（至少给 `family`） | 字体族下拉（游戏字体、内置字体、导入的字体、“导入字体…”）+ 样式开关 + 描边颜色 |

**enum 的图案选择器**（可选的界面提示，只影响属性面板的画法，不影响参数的值和校验）：在 enum 参数上写 `ui: 'pattern'`，并给每个选项一个 `pattern`——16 个 0–1 之间的数，按行从左上到右下对应一个 4×4 的小格，表示这一格出现的先后（0 最先）。控件把每个选项画成一个小方格图，越早出现越亮，当前项的名称显示在右上。`pattern` 必须正好 16 个、每个在 0–1 之间；声明了 `ui: 'pattern'` 却有选项缺 `pattern` 时 manifest 不合法（T-TPL-1 有夹具）。适合“顺序”“图案”这类能画成一张小图的选项；没声明的照旧走分段控件或下拉。

规则：

- 参数值校验：类型不对的回到默认值，越界的钳制，多余的键丢弃。校验函数是 `template-sdk` 的公开导出，引擎和界面共用。
- `text` 的 `default` 是多语言时，新建工程按界面语言取一次，之后值就是普通字符串。
- `visibleWhen` 只做界面显隐，不影响值。
- 模板有 `seed` 参数时，`ctx.random` 以它为种子。
- `font`（2026-11 加入）：`family` 是资源栈里的字体 ID（`minecraft:default`、`minecraft:uniform`、`minecraft:alt`、`minecraft:illageralt` 或资源包自己的字体）、`system:sans`（系统字体；旧工程里的 `allay:fallback` 读成它）或 `user:<sha256 前 32 位>`（用户导入、复制在 `userData/fonts/` 的字体文件）。清洗时逐个字段检查，坏的字段取默认值的那一项；`outline` 是 `#RRGGBB` 或 `null`。值原样交给 `ctx.text.create({ font })`。属性面板里的字体名不用该字体预览（应用自己的界面不用游戏字体，`09-compliance.md` 9.3）。

## 4.5 运行时契约

```ts
// 模板文件的默认导出
export interface TemplateModule {
  setup(ctx: SetupContext): TemplateInstance | Promise<TemplateInstance>;
}

export interface TemplateInstance {
  duration: number;                 // 秒
  cutTime?: number | null;          // 转场类必填
  update(t: number): void;
  dispose?(): void;
}

export interface SetupContext {
  THREE: typeof import('three');
  params: Readonly<Record<string, ParamValue>>;
  stage: Readonly<{ width: number; height: number; aspect: number; fps: number; pixelScale: number }>;
  scene: THREE.Scene;
  camera: THREE.Camera;
  setCamera(camera: THREE.Camera): void;
  createStageCamera(opts: { fov: number }): THREE.PerspectiveCamera;

  resources: {
    texture(id: string): Promise<THREE.Texture>;                           // 已设好过滤和色彩空间
    texture(id: string, opts: { optional: true }): Promise<THREE.Texture | null>;   // 没有时是 null、不记警告（按版本依次试路径）
    block(id: string, opts?: { shading?: boolean }): Promise<BlockHandle>;
    item(id: string): Promise<ItemHandle>;
  };
  text: { create(opts: TextOptions): TextObject };
  sprite: { create(texture: THREE.Texture, opts?: SpriteOptions): SpriteObject };

  random(key?: string): Rng;        // next() range(a,b) int(a,b) pick(arr) shuffle(arr)
  noise2D(x: number, y: number, key?: string): number;
  ease: EaseLibrary;
  math: MathHelpers;
  time: { segment(t: number, start: number, duration: number): number };
  audio: { cue(sound: string | null, at: number, opts?: { gain?: number; rate?: number; pan?: number }): void };
  warn(message: string): void;
}

export interface BlockHandle {
  single(): THREE.Object3D;                    // 边长为 1 的方块，模板自己缩放
  instanced(count: number): BlockInstances;
  faceTexture(face: 'up' | 'down' | 'north' | 'south' | 'east' | 'west'): THREE.Texture;
                                               // 这个面的贴图（不含叠加层、不带着色），引擎缓存里的，模板不释放
}
export interface BlockInstances {
  object: THREE.Object3D;                      // 加到场景里
  count: number;
  setMatrix(index: number, matrix: THREE.Matrix4): void;
  setOpacity(index: number, opacity: number): void;
  setTint(index: number, color: THREE.ColorRepresentation): void;
  commit(): void;                              // 一帧里改完所有实例后调用一次
}
export interface ItemHandle { single(): THREE.Object3D }   // 高度为 1，厚度为 1/16

export interface TextOptions {
  text: string; size: number;                  // size 是一个字体像素对应多少设计单位
  color?: string; shadow?: boolean; align?: 'left' | 'center' | 'right'; maxWidth?: number;
  font?: string | FontStyle;                   // 字体族 ID 或 font 参数的值；对象里写了的样式优先
  bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; outline?: string | null;
}
export interface FontStyle { family: string; bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; shadow?: boolean; outline?: string | null }
export interface TextObject { object: THREE.Object3D; width: number; height: number; setOpacity(a: number): void }
export interface SpriteOptions { nineSlice?: [number, number, number, number]; pixelSize?: number }
export interface SpriteObject { object: THREE.Object3D; setSize(w: number, h: number): void; setOpacity(a: number): void }
```

贴图 ID 的三种写法：`minecraft:block/stone` 走资源栈；`asset:logo.png` 取模板包 `assets/` 里的文件；`file:...` 是用户通过 `texture` 参数选的图片。`texture` 参数的值可以原样传给 `resources.texture()`。

### 最小示例

```js
// 一个纯色推入推出的转场
export default {
  async setup(ctx) {
    const { THREE, params, stage, scene } = ctx;
    const material = new THREE.MeshBasicMaterial({ color: params.color });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(stage.width, stage.height), material);
    scene.add(quad);

    const ease = ctx.ease.from(params.easing);
    const outStart = params.inDuration + params.hold;

    return {
      duration: outStart + params.outDuration,
      cutTime: params.inDuration + params.hold / 2,
      update(t) {
        const a = ease(ctx.time.segment(t, 0, params.inDuration));
        const b = ease(ctx.time.segment(t, outStart, params.outDuration));
        quad.position.x = -stage.width * (1 - a) + stage.width * b;   // 从左推入，向右推出
      },
      dispose() { quad.geometry.dispose(); material.dispose(); },
    };
  },
};
```

## 4.6 模板必须遵守的规则

1. `update(t)` 只能依赖 `t` 和 `setup` 时建立的状态。不读真实时间，不用 `Math.random`，不依赖上一次调用留下的东西。
2. 所有资源在 `setup` 里 `await` 完。`update` 里没有异步操作。
3. `update` 里不创建几何体、材质、贴图。
4. `ctx.audio.cue` 只在 `setup` 里调用。
5. 布局由 `ctx.stage` 推出，三种画幅（16:9、9:16、1:1）都要成立。
6. `0.1 ≤ duration ≤ 30`。
7. **首帧和末帧必须全透明**，也就是 `t = 0` 和 `t = duration` 这两个时刻（帧的定义见 `02-engine.md` 2.6）。这样片段盖到素材上时不会突然出现或消失。
8. **转场类模板在 `cutTime` 这一刻必须完全不透明**，用户在这一帧切换前后素材。
9. `dispose` 释放自己创建的 GPU 资源。引擎给的句柄由引擎回收。

**参数变了怎么办**：引擎销毁旧实例，用新参数重新 `setup`。模板作者不写增量更新。引擎负责缓存贴图和几何体，保证这样做足够快。

## 4.7 预设与派生模板

**预设**（存于 `userData/presets/`）：

```json
{ "formatVersion": 1, "template": { "id": "allay.builtin.block-wipe", "version": "1.0.0" },
  "name": "蓝钻中心扩散", "params": { "cols": 16, "inPattern": "centerOut" }, "createdAt": "2026-11-13T08:00:00Z" }
```

- 只存与默认值不同的参数。加载时缺的用默认值补，多的丢弃。
- 模板升级后预设照常可用，参数经校验函数清洗。
- 模板可以在 manifest 的 `presets` 里自带预设（`[{ key, name, params }]`，最多 32 个，params 只能引用本模板的参数）。界面的预设菜单里排在用户预设前面，套用方式相同，不能导出（2026-11，见 `decisions.md`“方块排列顺序”）。

**派生模板**：

```json
{ "formatVersion": 1, "id": "user.k3f9.blue-diamond-wipe", "version": "1.0.0",
  "name": "蓝钻擦除", "category": "transition",
  "extends": { "id": "allay.builtin.block-wipe", "version": "^1.0.0" },
  "overrides": { "defaults": { "blocks": [{ "id": "minecraft:diamond_block", "weight": 1 }], "cols": 16 },
                 "hidden": ["placeSound", "breakSound"] } }
```

- 装载时取基模板的代码和参数定义，套上 `overrides`。被隐藏的参数不显示，取（覆盖后的）默认值。
- 派生模板可以带 `assets/`，在 `defaults` 里用 `asset:` 引用，比如把频道 logo 设成默认图片。
- 界面入口：属性面板底部的“另存为模板”，弹窗里填名称、勾选要保留的参数。
- 只允许派生一层：`extends` 指向的必须是脚本模板。

## 4.8 安装与校验

导入 `.allaytpl` 时按顺序做，任何一步失败都给出对应的错误码和中文说明：

1. 包大小 ≤ 50 MB；条目路径不含 `..`、不是绝对路径；扩展名在白名单内（`.json .js .png .webp .jpg .ogg .wav .md .txt`）。
2. `manifest.json` 通过 schema 校验；用户包的 `id` 不以 `allay.` 开头；派生模板的基模板已安装且版本匹配。
3. `template.js` ≤ 1 MB；用 `es-module-lexer` 检查，出现任何静态或动态 `import` 就拒绝。
4. 在杂务 Worker 里试运行：用默认参数 `load`，以 320×180 渲染首帧、`cutTime` 帧、末帧，全部在看门狗时限内完成。同时做确定性自检和规则 7、8 的检查，不通过的给出警告但仍允许安装。
5. 生成封面和悬停预览（见 `06-ui-design.md` 的模板卡片）。
6. 解压到 `userData/templates/<id>/<version>/`。

删除模板时，依赖它的预设和派生模板保留但标记为“基模板缺失”。

## 4.9 内置模板的开发方式

```
packages/templates/<name>/
  manifest.json
  src/index.ts        只允许从 @allay/template-sdk 做类型导入，以及导入本目录和 _lib 里的文件
  assets/
packages/templates/_lib/
  src/                内置模板共用的源码（时间余量、界面像素布局、闭式粒子），不是模板
```

- `scripts/build-templates.ts` 用 esbuild 把每个模板打成单文件 ESM（不留任何 import），连同 manifest 和 assets 打成 `.allaytpl`，输出到 `resources/templates/`。
- 应用启动时把 `resources/templates/` 当作只读的模板来源。内置模板走和用户模板相同的装载路径，只跳过 4.8 的第 1、3 步（体积和导入检查已经在构建时保证）。
- 用 lint 规则禁止内置模板导入 `three` 的运行时或引擎内部模块。
- 共用的源码放在 `packages/templates/_lib/`（2026-11，`docs/template-catalog.md` P1）：模板用相对路径导入，esbuild 把用到的函数并进那个模板的单文件产物，产物里仍然没有任何 import。它只是源码层面的复用，不是新的运行时接口：`_lib` 和模板一样只能用 `ctx` 给的东西，用户模板想要同样的函数可以照抄。名字以 `_` 开头的目录不打包；模板之间不能互相导入（lint 和构建脚本各拦一次）。

## 4.10 六个内置模板

所有时长参数的类型都是 `duration`。未特别说明的转场类模板：`duration = inDuration + hold + outDuration`，`cutTime = inDuration + hold / 2`。六个模板都在 manifest 里把 `inDuration`、`hold`、`outDuration` 声明为 `timeline.segments`。

### T1 方块擦除 `allay.builtin.block-wipe`（转场，旗舰模板）

方块按某种顺序一个个弹出来铺满画面，停留，再按某种顺序缩回去。

- 网格：`cols` 列，格子边长 `s = stage.width / cols`，行数取 `ceil(stage.height / s) + 1` 并垂直居中，保证上下都盖过画面边缘。
- 每个方块有一个顺序值 `u ∈ [0, 1]`，由图案函数给出，再加 `jitter × 随机数` 后重新归一化。
- 进入阶段：方块 `i` 的局部进度 `p = clamp((t / inDuration − u × (1 − overlap)) / overlap)`。缩放为 `ease(p)`，旋转为 `(1 − ease(p)) × 90°`（轴由 `spin` 决定）。动画中的方块沿 z 轴朝相机抬起 `(1 − p) × s × 0.5`，落定后回到 z = 0，避免过冲时与邻居的面重合闪烁。
- 退出阶段对称，缩放从 1 回到 0。
- 音效：进入阶段在最多 12 个均匀抽样的方块起始时刻放 `placeSound`，退出阶段同理放 `breakSound`。

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `blocks` | blockList | `diamond_block` ×1 | 最多 8 种 |
| `cols` | integer | 12 | 4–40 |
| `style` | enum | `3d` | `flat`（正交、只见正面）/ `3d`（透视 fov 30，可见侧面和面明暗） |
| `inPattern` | enum | `centerOut` | `leftToRight` `rightToLeft` `topToBottom` `bottomToTop` `centerOut` `edgesIn` `diagonal` `random` `noise` |
| `outPattern` | enum | `reverse` | `same` `reverse`，以及上面 9 种 |
| `inDuration` | duration | 0.5 | 0.15–2 |
| `hold` | duration | 0.1 | 0–2 |
| `outDuration` | duration | 0.5 | 0.15–2 |
| `overlap` | number | 0.45 | 0.1–1；单个方块的动画占整个阶段的比例 |
| `easing` | easing | `backOut` | — |
| `spin` | enum | `flipY` | `none` `flipX` `flipY` `twist` |
| `jitter` | number | 0.1 | 0–0.5 |
| `placeSound` | sound | `minecraft:block.stone.place` | 可为空 |
| `breakSound` | sound | `minecraft:block.stone.break` | 可为空 |
| `volume` | number | 0.6 | 0–1 |
| `seed` | seed | 1 | — |

### T2 方块坠落 `allay.builtin.block-fall`（转场）

方块从画面上方一列列掉下来垒成一面墙，停留，然后整面墙散落。

- 网格同 T1。下落顺序：同一列里下面的行先落；列与列之间的先后由 `columnOrder` 决定。
- 下落用解析式：位置 `y = y终 + H × (1 − q²)`，`q` 是该方块的局部进度；落地后叠加一个衰减的回弹 `bounce × s × e^(−6τ) × |sin(3πτ)|`。全部是时间的闭式函数，不做逐帧积分。
- 退出 `outMode`：`fall`（每块带随机水平初速度和角速度的抛物线，上面的行先走）、`explode`（从画面中心向外的抛物线加自转）、`shrink`（同 T1 的缩回）。

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `blocks` | blockList | `stone` ×3、`cobblestone` ×1 | 最多 8 种 |
| `cols` | integer | 10 | 4–32 |
| `columnOrder` | enum | `random` | `leftToRight` `rightToLeft` `centerOut` `random` |
| `bounce` | number | 0.25 | 0–1 |
| `outMode` | enum | `fall` | `fall` `explode` `shrink` |
| `inDuration` / `hold` / `outDuration` | duration | 0.7 / 0.1 / 0.6 | 0.2–2 / 0–2 / 0.2–2 |
| `placeSound` / `breakSound` / `volume` / `seed` | 同 T1 | | |

### T3 物品飞掠 `allay.builtin.item-stinger`（转场）

一个大号物品沿某个方向掠过画面，身后拖着一条色带把画面完全盖住，色带尾端随后扫过，露出下一段素材。

- 运动方向由 `angle` 决定（0° 为从左到右）。色带是一个沿运动方向足够长的矩形，宽度盖过画面对角线。
- 色带前沿在 `inDuration` 内从画面外移动到完全盖住画面；后沿在 `outDuration` 内扫过。
- `edge = stairs` 时前后沿是像素阶梯：把边界量化到 `pixelSize` 的格子上。
- 后沿之前可以有两条细的装饰条纹（`stripeA`、`stripeB`），宽度为 `pixelSize`。
- 物品走在前沿前方 `itemLead × stage.height` 处，尺寸 `itemScale × stage.height`，以 `spin` 圈每秒自转。`image` 非空时用这张图片代替物品。

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `item` | item | `minecraft:diamond_sword` | — |
| `image` | texture（`allowFile`） | 空 | 用自己的图片代替物品 |
| `angle` | angle | 0 | 吸附 15° |
| `fill` | enum | `color` | `color` / `block` |
| `fillColor` | color | `#2072D5` | `fill = color` 时显示 |
| `fillBlock` | block | `minecraft:lapis_block` | `fill = block` 时显示，贴图平铺 |
| `tileSize` | number | 120 | 40–360，平铺贴图的边长 |
| `edge` | enum | `stairs` | `straight` / `stairs` |
| `pixelSize` | integer | 60 | 12–180 |
| `stripeA` / `stripeB` | color | `#52CFF3` / `#F2F4F6` | 带 alpha，全透明即不显示 |
| `itemScale` | number | 0.6 | 0.2–1.4 |
| `itemLead` | number | 0.15 | 0–0.6 |
| `spin` | number | 1 | −4–4 圈/秒 |
| `inDuration` / `hold` / `outDuration` | duration | 0.45 / 0.08 / 0.45 | 0.15–2 / 0–2 / 0.15–2 |
| `easing` | easing | `cubicInOut` | — |
| `sound` | sound | `allay:whoosh` | 在 `t = 0` 播放 |
| `volume` | number | 0.7 | 0–1 |

### T4 加载界面 `allay.builtin.loading-screen`（转场）

按游戏里的样子还原加载画面（2026-11 反馈），`style` 选版本样式；`custom` 保留最初的自由排版。除 `custom` 外，布局以界面像素计：一个界面像素 = `guiScale` 个设计单位，界面宽高 = 舞台宽高 / `guiScale`，坐标的整数截断照游戏代码。进度（进度条、百分比、区块图）在停留阶段从 0 走到 100%。`cutTime = inDuration + hold × cutAt`。

“依据”一栏里，“凭记忆”是实现者对反编译游戏代码的记忆，开发时没能联网核对；“经搜索摘要确认”是开发时用网络搜索查到的 Minecraft Wiki 摘要。都没有和游戏的实际画面逐帧对照过（docs/decisions.md“2026-11 反馈：原版动画还原与字体”）。

| `style` | 对应的游戏版本 | 画面 | 依据 |
|---|---|---|---|
| `javaClassic` | Java 版 Beta–1.13（进度条只到 1.2.5） | 泥土背景（32 界面像素一格、0x404040）；标题在 `h/2 − 4 − 16`，副标题在 `h/2 − 4 + 8`，白字带阴影居中；进度条 100 × 2，在 `h/2 + 16`，底 0x808080、进度 0x80FF80 | `LoadingScreenRenderer`（凭记忆）；1.3.1 之前有进度条、12w25a 起只剩文字（经搜索摘要确认） |
| `javaChunks` | Java 版 1.14–1.20.4 | 泥土背景；百分比在 `h/2 − 4 − 30`；区块状态图 35 × 35、每块 2 × 2，以 `(w/2, h/2 + 30)` 为中心，带 1 像素黑边 | `LevelLoadingScreen`（凭记忆）；35 × 35 和部分阶段颜色（空 #545454、结构起点 #999999、结构引用 #5F6191、生物群系 #80B252、噪声 #D1D1D1、地表 #726809、雕刻 #303572）、黑边在 24w19a 去掉（经搜索摘要确认）；其余阶段颜色凭记忆 |
| `javaChunksModern` | Java 版 1.20.5–1.21.8（24w09a–1.21.8） | 模糊的全景图（`gui/title/background/panorama_0–5`）加 `gui/menu_background`；区块图没有黑边 | 24w09a 起背景换成模糊、压暗的标题画面全景图，24w19a 去掉黑边（经搜索摘要确认）；模糊是近似（高一级 mipmap 加 9 点平均），不是游戏的高斯模糊 |
| `javaTerrain` | Java 版“正在加载地形……”（进服务器、换维度） | 文字在 `h/2 − 50`；`background` 可选方块平铺、全景图、下界传送门（贴图拉伸铺满）、末地传送门（天空加 15 层传送门图案） | 穿过下界、末地传送门时用对应的动画贴图做背景（经搜索摘要确认，具体从哪个版本开始没查到）；末地传送门的层颜色和变换照 `rendertype_end_portal` 着色器（凭记忆） |
| `javaSplash` | Java 版 1.16 起的资源加载画面；`monochrome` 是 1.17（21w13a）起的“单色标志” | 底色 0xEF323D（单色为黑）；标志按 `LoadingOverlay` 的尺寸分左右两半画（`gui/title/mojangstudios`）；白色进度条在 `h × 0.8325`；退出时先淡出进度条、再淡出背景和标志（游戏里各 1 秒，这里把 `outDuration` 对半分） | `LoadingOverlay`（凭记忆）；单色标志的版本（经搜索摘要确认）；游戏里标志是加法混合，这里按亮度当覆盖率普通混合，红底上结果相同 |
| `bedrock` | 基岩版的世界加载（**近似**） | 全景图背景，中间深色框里“正在构建地形”，经验条样式的进度条（`hud/experience_bar_*`），下面一行提示 | 基岩版用菜单全景图、经验条样式的进度条、加载提示，“Building terrain”框里带标志（经搜索摘要确认）；框和条的尺寸、位置、颜色是估的，框里没有画标志；基岩版的界面贴图不在 Java 版的游戏文件里，用 Java 版的经验条贴图代替 |
| `custom` | — | 最初的样子：`tileSize`、`dim`、`textScale` 自由调 | — |

区块图的动画是按“离中心越远越晚、外圈停在较低阶段”合成的，不是游戏的真实生成顺序（那取决于世界）。

没有做的：Java 版 1.21.9（25w31a）起区块图下面新加的进度条（没查到它的样子）；基岩版更精确的版式；1.14–1.15 的白底旧标志（新版本的游戏文件里没有那张贴图）。

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `style` | enum | `javaClassic` | 见上表 |
| `guiScale` | number | 4 | 1–8，`custom` 以外的样式用 |
| `background` | enum | `auto` | `auto`（按样式）`dirt` `panorama` `netherPortal` `endPortal` |
| `monochrome` | boolean | false | `javaSplash` 用 |
| `block` | block | `minecraft:dirt` | 方块平铺背景用 |
| `dim` / `tileSize` | number | 0.25 / 128 | 0.05–1 / 32–360，`custom` 用 |
| `title` | text | “正在加载世界” / “Loading world” | 最长 40 字；保持某个样式的默认文字时换成当前样式的那一句 |
| `subtitle` | text | “正在生成地形…” / “Building terrain…” | 最长 60 字，可为空；同上 |
| `titleFont` / `subtitleFont` | font | `minecraft:default`，带阴影 | — |
| `textColor` | color | `#FFFFFF` | 色板 `chat` |
| `textScale` | number | 5 | 2–12，`custom` 用 |
| `showBar` | boolean | true | — |
| `barColor` | color | `#55FF55` | `custom` 用 |
| `inStyle` / `outStyle` | enum | `fade` / `fade` | `fade` `slideUp` `dissolve`（溶解只对方块平铺背景）；`javaSplash` 固定照游戏淡出 |
| `inDuration` / `hold` / `outDuration` | duration | 0.3 / 0.9 / 0.3 | 0.1–2 / 0.2–5 / 0.1–2 |
| `cutAt` | number | 0.5 | 0–1 |
| `seed` | seed | 1 | 仅 `dissolve` 用 |

### T5 像素溶解 `allay.builtin.pixel-dissolve`（转场）

画面被一格格像素块按阈值图案盖住，再一格格消失。整个模板是一个全屏着色器。

- 把舞台按 `cellSize` 分格，每格有一个阈值 `h ∈ [0, 1]`，由 `pattern` 给出：`noise`（simplex）、`random`、`sweep`（沿 `angle` 的线性渐变加 `spread × 噪声`）、`radial`（到中心的距离加噪声）。
- 进入阶段的进度为 `a`，格子在 `h < a` 时可见；退出阶段的进度为 `b`，格子在 `h < b` 时消失（`outReverse` 为真时改用 `1 − h`）。
- 刚出现或即将消失的格子（阈值与进度相差不到 `accentWidth`）显示为 `accentColor`。
- 填充 `fill`：`color` 或 `block`（每格贴一张方块贴图）。
- 着色器里的噪声和随机必须是坐标和种子的函数，不得用时间。

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `cellSize` | integer | 60 | 8–240 |
| `pattern` | enum | `noise` | `noise` `random` `sweep` `radial` |
| `angle` | angle | 0 | `pattern = sweep` 时显示 |
| `spread` | number | 0.3 | 0–1 |
| `fill` | enum | `color` | `color` / `block` |
| `color` | color | `#0B0F13` | — |
| `block` | block | `minecraft:obsidian` | — |
| `accentColor` | color | `#52CFF3` | — |
| `accentWidth` | number | 0.06 | 0–0.3 |
| `outReverse` | boolean | false | — |
| `inDuration` / `hold` / `outDuration` | duration | 0.4 / 0.1 / 0.4 | 0.1–2 / 0–2 / 0.1–2 |
| `easing` | easing | `quadInOut` | — |
| `seed` | seed | 1 | — |

### T6 进度提示 `allay.builtin.advancement-toast`（叠加层）

屏幕一角滑入一个提示框：左边一个物品图标，右边两行字。停留后滑出。没有剪辑点，`cutTime` 为 `null`。2026-11 起按游戏还原（“依据”的含义同 T4）：

| `style` / `kind` | 对应的游戏版本 | 画面与动画 | 依据 |
|---|---|---|---|
| `java` + `advancement` | Java 版 1.12 起 | 面板 `gui/sprites/toast/advancement`（160 × 32，1.20.2 起的路径），图标在 (8, 8)，文字在 x = 30，两行在 y = 7、18，不带阴影；类型行颜色：进度、目标 0xFFFF00，挑战 0xFF88FF；标题超过 125 界面像素时换行：前 1.5 秒只显示类型行（1.2–1.5 秒淡出），之后标题各行在 0.3 秒里淡入、竖直居中、行距 9 | `AdvancementToast`（凭记忆）；三种类型的文字和颜色、挑战音效（经搜索摘要确认） |
| `java` + `recipe` | Java 版 1.12 起 | `toast/recipe`；“新配方已解锁！”0x500050、“查看你的配方书”黑色 | `RecipeToast`（凭记忆） |
| `java` + `system` | Java 版 1.12 起 | `toast/system`，没有图标，文字从 x = 18 开始，类型行 0xFFFF00、正文白色，面板按文字加宽 | `SystemToast`（凭记忆） |
| `java` 的动画 | 同上 | 从右边缘水平滑入，在画面上的比例 = (经过时间 / 0.6 s)²；滑出是 1 − (经过时间 / 0.6 s)²；进度提示从出现起 5 秒后开始滑出（默认 `inDuration` 0.6、`hold` 4.4、`outDuration` 0.6）；贴着右上角，没有边距；滑入放 `ui.toast.in`，开始滑出放 `ui.toast.out`，挑战另在开头放 `ui.toast.challenge_complete` | `ToastManager` / `ToastComponent`（凭记忆） |
| `javaAchievement` | Java 版 1.11 及更早（成就） | “获得成就！”黄字（0xFFFF00）、成就名白字；从顶上落下：共 3 秒，进出各 1/8（0.375 s），位移 36 × (1 − 进度)⁴ 界面像素；游戏里没有音效 | `GuiAchievement`（凭记忆）；成就框贴图 `achievement_background.png` 新版本的游戏文件里没有，用同尺寸的进度提示框代替 |

没有做的：基岩版的提示（只查到支持 Xbox 通知的设备上用系统通知，没查到游戏内提示框的版式）；教程提示（`toast/tutorial`，带进度条和按键图标）。

| 参数 | 类型 | 默认 | 范围 / 选项 |
|---|---|---|---|
| `style` | enum | `java` | `java` `javaAchievement` |
| `kind` | enum | `advancement` | `advancement` `recipe` `system`（`java` 样式） |
| `frame` | enum | `task` | `task` `goal` `challenge` |
| `icon` | item | `minecraft:diamond` | — |
| `header` | text | “进度已达成！” / “Advancement Made!” | 最长 40 字；保持游戏里的某一句默认文字时按类型换成对应的那一句 |
| `title` | text | “钻石！” / “Diamonds!” | 最长 60 字 |
| `headerColor` / `titleColor` | color | `#FFFF00` / `#FFFFFF` | 保持默认值时按类型取游戏里的颜色 |
| `headerFont` / `titleFont` | font | `minecraft:default`，不带阴影 | — |
| `anchor` | enum | `topRight` | `topRight` `topLeft` `bottomRight` `bottomLeft` |
| `guiScale` | integer | 4 | 2–10 |
| `margin` | number | 0 | 0–120 |
| `inDuration` / `hold` / `outDuration` | duration | 0.6 / 4.4 / 0.6 | 0.1–1 / 0.5–10 / 0.1–1 |
| `sound` / `outSound` / `challengeSound` | sound | `minecraft:ui.toast.in` / `minecraft:ui.toast.out` / `minecraft:ui.toast.challenge_complete` | — |
| `volume` | number | 0.8 | 0–1 |

### 其余内置模板

内置模板计划做到 100 个（`docs/template-catalog.md`）。上面六个之外的不在这里逐个写：每个模板的画面、参数表、依据和没做的写在 `docs/templates/<名字>.md`，各批次的决定和偏差写在 `docs/templates/batch-<批号>.md`。4.3–4.9 的规则对它们同样适用。

## 4.11 验收测试

| 编号 | 内容 | 判定 |
|---|---|---|
| T-TPL-1 | manifest 的合法和非法夹具各 10 个以上 | 合法的通过；非法的给出指向具体字段的错误 |
| T-TPL-2 | 每种参数类型：默认值、越界值、错类型、缺失 | 行为符合 4.4 |
| T-TPL-3 | 每个内置模板，三种画幅（1920×1080、1080×1920、1080×1080），默认参数 | 无警告；通过 T-ENG-1；首末帧最大 alpha 为 0；转场类在 `cutTime` 的最小 alpha 为 255 |
| T-TPL-4 | 每个内置模板，每个模板 50 组随机合法参数 | 不抛错；T-TPL-3 的三条断言仍成立；`duration` 在规定范围内 |
| T-TPL-5 | 每个内置模板取 0%、25%、`cutTime`、75%、100% 五帧与仓库里的基准图比较 | 平均绝对误差 ≤ 1.5/255。基准图在真实显卡上生成；软件渲染的 CI 上放宽到 4/255 |
| T-TPL-6 | 安装校验：带 import 的脚本、路径穿越、超大包、冒用 `allay.` 前缀、基模板缺失 | 各自被拒绝并返回对应错误码 |
| T-TPL-7 | 派生模板：覆盖默认值、隐藏参数、引用自带图片 | 装载结果符合 4.7 |
| T-TPL-8 | 预设保存后再加载；模板升级增删参数后加载旧预设 | 参数一致；多余的丢弃、缺的补默认值 |
| T-FNT-1 | 字体定义里的 unihex 提供器和 filter | unihex 记下 zip 路径和 size_overrides；要求 uniform / jp 打开的提供器和 reference 跳过 |
| T-FNT-2 | Unifont 的 .hex 解析 | 宽度按墨迹（或覆盖），前进宽度 floor(列数 / 2) + 1 个字体像素，同一码位先出现的胜出 |
| T-FNT-3 | 主进程从资源栈的 zip 里读 unihex 字形表 | 读出全部 .hex；条目名不安全的 zip 整个拒绝 |
| T-FNT-4 | 用户导入字体 | 按文件头认格式，复制进 `userData/fonts/` 并按内容哈希命名；认不出的文件、目录外的 ID 被拒绝 |
