// @ts-check
// test:engine 用的测试模板（M6b）：按 params.scenario 摆出 faceTexture、坏着色器、音频 cue 的场景。
// 只用公开的模板接口（ctx），不含 import。

/** @type {import('@allay/template-sdk').TemplateModule} */
const template = {
  async setup(ctx) {
    const { THREE, scene, params, stage } = ctx;
    const scenario = String(params.scenario);

    if (scenario === 'faceTexture') {
      // 整个舞台铺一张方块某个面的贴图（不带明暗），测试读中心像素的颜色
      const handle = await ctx.resources.block(String(params.block), { shading: false });
      const face = /** @type {import('@allay/template-sdk').BlockFace} */ (String(params.face));
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(stage.width, stage.height), new THREE.MeshBasicMaterial({ map: handle.faceTexture(face) }));
      scene.add(quad);
    } else if (scenario === 'badShader') {
      // 片元着色器有语法错误：引擎要记一条警告，而不是只在控制台打印
      const material = new THREE.ShaderMaterial({
        vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'void main() { this is not glsl; }',
      });
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(100, 100), material));
    } else if (scenario === 'cues') {
      // 同一个多变体事件的 6 个 cue、一个单变体事件、一个资源栈里没有的事件、一个 null
      for (let i = 0; i < 6; i++) ctx.audio.cue('test:multi', i * 0.1, { gain: 0.5 });
      ctx.audio.cue('test:single', 0.2, { rate: 1.5, pan: -0.5 });
      ctx.audio.cue('minecraft:does_not_exist', 0.3);
      ctx.audio.cue(null, 0.4);
    }
    return { duration: 1, cutTime: null, update() {} };
  },
};
export default template;
