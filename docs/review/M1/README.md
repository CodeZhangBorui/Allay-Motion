# M1 评审说明

**做了什么**：引擎 Worker（Comlink、看门狗：load 10 s / 预览单帧 5 s / 导出单帧 30 s，超时终止并重建、界面显示“模板无响应”）；完整帧管线（RGBA16F + MSAA 4× 的子帧、加法累积、预览/透明/不透明三种 resolve）；舞台与相机、`ctx` 的 THREE/params/stage/random/noise2D/ease/math/time；装载前删除联网与存储全局、拒绝含 import 的源码；写死参数的临时方块擦除模板（贴图由桩 `resolveResource` 生成）；预览画布、播放/暂停/拖动；`pnpm ffmpeg:fetch`（FFmpeg-Builds n9.0.2 LGPL，固定标签和 SHA-256）；主进程导出任务和 ProRes 4444、PNG 序列两个预设；`test:engine`、`test:export` 成为真测试并进入 `pnpm check`。

截图 `m1-frame-NN.png`（第 0、14、33=剪辑点、50、62 帧）：**左边是预览画布**（N = 1，没有运动模糊），**右边是导出的 MOV 解码回来**、盖在同样的棋盘格上（标准画质 N = 8，所以有拖影）。用 `pnpm build && pnpm review:m1` 重新生成。

**H-M1 要人看的**：运行 `pnpm build`、`pnpm ffmpeg:fetch`、`pnpm review:m1`，得到 `docs/review/M1/out/未命名工程_方块擦除（临时）_1920x1080_60fps.mov`（约 100 MB，被 git 忽略）；或者在应用里点“导出”→ 透明 MOV、标准画质。把它放进剪辑软件（Premiere / Resolve / Final Cut / AE 任一），叠在一段素材上方，请看：
1. 半透明边缘（方块边缘、运动模糊的拖影）有没有黑边或白边；
2. 颜色和预览是否一致（方块的青色、亮边暗边）；
3. 片段首尾有没有突然出现或消失（首末帧应全透明，第 33 帧应完全盖住画面）。

**和规格不同的地方**（详见 `docs/decisions.md` M1）：T-ENG-4 对低 alpha 像素在预乘域比较；test:engine 用 Electron 自带的 Chromium（不显示的窗口）而不是 headless Chrome；ProRes 输出到 `.partial` 时加了 `-f mov`；`renderThumbnail`、`writeAudio`、`probeEncoders` 未做（属于后续里程碑）；**4.10 的 T1 公式在开了运动模糊时首末帧不全透明**，临时模板首尾各留了一帧余量，M3 要处理。

**没有验证的**：导出的 MOV 没有在真实剪辑软件里看过（等 H-M1）；只在本机一块显卡上跑过 WebGL（软件渲染的 CI 没跑过）；CI 工作流加了 `ffmpeg:fetch` 步骤但没在 GitHub 上跑；性能只有 T-EXP-7 的“导出 ≤ 20 s”断言（通过），没量 2.11 的单帧 8 ms 和 setParams 50 ms 预算；`pnpm dev` 开发模式下的预览没有试过。
