// 最小示例：纯色从左推入、停留、向右推出的转场。docs/template-authoring.md 原样引用这份文件，
// T-DEV-3 用生成的 template-api.d.ts 对它做 checkJs 类型检查。

/** @type {import('./template-api').TemplateModule} */
export default {
  async setup(ctx) {
    const { THREE, params, stage, scene } = ctx;
    /** @param {string} key @param {number} fallback */
    const num = (key, fallback) => {
      const v = params[key];
      return typeof v === 'number' ? v : fallback;
    };
    const inDuration = num('inDuration', 0.4);
    const hold = num('hold', 0.2);
    const outDuration = num('outDuration', 0.4);
    const duration = inDuration + hold + outDuration;
    const cutTime = inDuration + hold / 2;

    // 时间余量：首末帧全透明、剪辑点完全不透明，在开了运动模糊时也要成立（规则 7、8）
    const pad = 1 / stage.fps;
    const inStart = pad;
    const inEnd = Math.max(inStart + 1e-6, Math.min(inDuration, cutTime - pad));
    const outStart = Math.max(inDuration + hold, cutTime + pad);
    const outEnd = Math.max(outStart + 1e-6, duration - pad);

    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(String(params.color ?? '#2072D5')) });
    const geometry = new THREE.PlaneGeometry(stage.width, stage.height);
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);
    const ease = ctx.ease.from(params.easing);

    return {
      duration,
      cutTime,
      update(t) {
        // 只依赖 t：不读真实时间、不用 Math.random、不改跨帧的状态
        const a = ease(ctx.math.clamp((t - inStart) / (inEnd - inStart), 0, 1));
        const b = ease(ctx.math.clamp((t - outStart) / (outEnd - outStart), 0, 1));
        quad.position.x = -stage.width * (1 - a) + stage.width * b;
      },
      dispose() {
        geometry.dispose();
        material.dispose();
      },
    };
  },
};
