# M6b 评审说明

**做了什么**（细节见 `docs/decisions.md` 的“M6b”）

- 引擎替每个 cue 选定音效变体（`random('sound:'+事件+':'+序号)`），写进 `AudioCue.variant`；宿主经新的 `resources.soundVariants` 合并各层 `sounds.json`。
- `apps/desktop/src/renderer/audio/`：一份调度函数，预览（实时 `AudioContext`）和导出（`OfflineAudioContext`）共用；48 kHz 解码缓存；预览播放跟着播放、暂停、跳转、循环、静音、cue 变化重新调度；SoundField 的试听；缺失音效静音并提示一次。
- 导出：离线混音 → `export.writeAudio` → 主进程落盘后才启动 FFmpeg；ProRes 带 `pcm_s16le` 音轨，PNG 序列另存 `name.wav`；没有能出声的 cue 时不加音轨。
- 下载缓存的原版层：“下载原版资源”时一并取回音效选择器里 11 个事件用到的对象（经 `fetchObject`），之后不联网。下载说明文案加了 `resources.download.minecraft.net`。
- 引擎补强：公开接口 `BlockHandle.faceTexture(face)`，T3/T5 改用；着色器编译失败记成模板警告。

**和规格不同的地方**：音频样本数取“帧数 / 帧率 × 48000”（与视频严格等长；规格的 `ceil(duration × 48000)` 比视频短）；淡出、峰值处理在渲染后对样本做；试听不受静音开关影响；静音时不调度（而不是增益置零）；有音轨的导出在 `writeAudio` 之后才启动 FFmpeg；`allay:whoosh`（T3 默认）没有原版来源，默认静音并提示。

**没验证的**

- **没有人真的听过**任何一个声音：预览、试听、导出的音轨都只在静音的隐藏窗口和离线上下文里按调度状态、样本数据、ffprobe 核对过。声音好不好听、音量是否合适、预览与时间轴是否听感同步、停止时有没有爆音，都要人在可见窗口里听一遍。
- 带音轨的 ProRes 没在真实剪辑软件里打开过（只用 ffprobe 看了流）。
- 真实 Mojang 服务器上的音效对象下载没跑（`pnpm check` 不联网；只对本机假服务器测过）；“估计不到 2 MB”没核实。本机原版层（游戏的资源索引）里的音效没在这台机器上试：M2a 记过本机 `.minecraft` 没有 `assets/`。
- 实时预览里 rAF 时钟与 AudioContext 时钟的长时间偏差只按 0.2 s 容差处理，没有量过。
