// @ts-check
// M1 的临时方块擦除模板：参数写死，只为打通“模板 → 预览 → 带透明通道的文件”这条链路。
// M3 会把它重写成正式的 T1（docs/04-templates.md 4.10）。
// 只用公开的模板接口：不含任何 import，THREE 和辅助函数都从 ctx 拿（02-engine.md 2.4）。

/** @type {import('@allay/template-sdk').TemplateModule} */
const template = {
  async setup(ctx) {
    const { THREE, stage, scene } = ctx;

    // 写死的参数（T1 的默认值）
    const cols = 12;
    const inDuration = 0.5;
    const hold = 0.1;
    const outDuration = 0.5;
    const overlap = 0.45;
    const jitter = 0.1;
    const ease = ctx.ease.backOut;

    // 透视相机（style = 3d，fov 30），z = 0 平面恰好填满舞台
    ctx.setCamera(ctx.createStageCamera({ fov: 30 }));

    // 网格：格子边长 s = stage.width / cols，行数 ceil(height / s) + 1，垂直居中
    const s = stage.width / cols;
    const rows = Math.ceil(stage.height / s) + 1;
    const count = cols * rows;

    // 顺序值 u：centerOut，加 jitter × 随机数后重新归一化到 [0, 1]
    const rng = ctx.random('order');
    const px = new Float32Array(count);
    const py = new Float32Array(count);
    const raw = new Float32Array(count);
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        px[i] = -stage.width / 2 + (c + 0.5) * s;
        py[i] = (r - (rows - 1) / 2) * s;
        const d = Math.hypot(px[i] / stage.width, py[i] / stage.height);
        raw[i] = d + jitter * rng.next();
        lo = Math.min(lo, raw[i]);
        hi = Math.max(hi, raw[i]);
      }
    }
    const uIn = new Float32Array(count);
    const uOut = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      uIn[i] = hi > lo ? (raw[i] - lo) / (hi - lo) : 0;
      uOut[i] = 1 - uIn[i]; // outPattern = reverse
    }

    // 方块：一个立方体，面的明暗烘进顶点色（顶 1.0、底 0.5、南北 0.8、东西 0.6）
    const texture = await ctx.resources.texture('minecraft:block/diamond_block');
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const faceShade = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8]; // BoxGeometry 的面顺序：+x −x +y −y +z −z
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let face = 0; face < 6; face++) {
      for (let v = 0; v < 4; v++) colors.fill(faceShade[face], (face * 4 + v) * 3, (face * 4 + v) * 3 + 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    scene.add(mesh);

    // update 里复用的对象（update 内不分配内存）
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0); // spin = flipY
    const outStart = inDuration + hold;
    // 首尾各留一帧全透明：开了运动模糊时，首帧的子帧会落在 (0, 0.5/fps]，末帧的落在 [duration − 0.5/fps, duration)，
    // 按 4.10 的公式这些时刻已经有方块露出来，首末帧就不再全透明（4.6 第 7 条）。见 docs/decisions.md M1。
    const pad = 1 / stage.fps;

    /** 单个方块的局部进度 @type {(phase: number, u: number) => number} */
    const local = (phase, u) => ctx.math.clamp((phase - u * (1 - overlap)) / overlap, 0, 1);

    return {
      duration: inDuration + hold + outDuration,
      cutTime: inDuration + hold / 2,
      update(t) {
        const a = ctx.time.segment(t, pad, inDuration - pad);
        const b = ctx.time.segment(t, outStart, outDuration - pad);
        for (let i = 0; i < count; i++) {
          let p;
          if (t < outStart) p = local(a, uIn[i]);
          else p = 1 - local(b, uOut[i]); // 退出阶段对称：缩放从 1 回到 0
          const e = p <= 0 ? 0 : ease(p);
          // 动画中的方块朝相机抬起，落定后回到 z = 0，避免过冲时与邻居的面重合闪烁
          const lift = p > 0 && p < 1 ? (1 - p) * s * 0.5 : 0;
          pos.set(px[i], py[i], lift);
          quat.setFromAxisAngle(axis, (1 - e) * (Math.PI / 2));
          const k = Math.max(0, e) * s;
          scl.set(k, k, k);
          m.compose(pos, quat, scl);
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
      dispose() {
        geometry.dispose();
        material.dispose();
        mesh.dispose();
      },
    };
  },
};

export default template;
