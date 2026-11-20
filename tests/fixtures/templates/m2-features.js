// @ts-check
// test:engine 用的测试模板：按 params.scenario 摆出方块、物品、文字、精灵、动画贴图、缺失资源的场景。
// 只用公开的模板接口（ctx），不含 import。1920×1080 时 1 设计单位 = 1 像素。

/** @type {import('@allay/template-sdk').TemplateModule} */
const template = {
  async setup(ctx) {
    const { THREE, scene, params } = ctx;
    const scenario = String(params.scenario);
    /** @type {(t: number) => void} */
    let update = () => undefined;

    if (scenario === 'block') {
      // 正交相机看南面（+z）：面明暗 0.8
      const stone = (await ctx.resources.block('minecraft:stone')).single();
      stone.scale.setScalar(200);
      stone.position.set(-600, 0, 0);
      scene.add(stone);
      // shading: false：南面不变暗
      const flat = (await ctx.resources.block('minecraft:stone', { shading: false })).single();
      flat.scale.setScalar(200);
      flat.position.set(-300, 0, 0);
      scene.add(flat);
      // 草方块顶面带着色：转过来看顶面
      const grass = (await ctx.resources.block('minecraft:grass_block')).single();
      grass.scale.setScalar(200);
      grass.rotation.x = Math.PI / 2;
      grass.position.set(0, 0, 0);
      scene.add(grass);
      // 实例化：第 0 个半透明，第 1 个染成红色
      const inst = (await ctx.resources.block('minecraft:white_wool')).instanced(2);
      const m = new THREE.Matrix4();
      inst.setMatrix(0, m.makeScale(200, 200, 200).setPosition(300, 0, 0));
      inst.setMatrix(1, m.makeScale(200, 200, 200).setPosition(600, 0, 0));
      inst.setOpacity(0, 0.5);
      inst.setTint(1, '#ff0000');
      inst.commit();
      scene.add(inst.object);
    } else if (scenario === 'item') {
      const item = (await ctx.resources.item('minecraft:diamond')).single();
      item.scale.setScalar(320);
      scene.add(item);
    } else if (scenario === 'text') {
      // 只取 font 参数的字体族（样式仍用这里写的阴影），让同一个场景能换字体测
      const a = ctx.text.create({ text: String(params.text ?? 'AB'), size: 10, color: '#ffffff', shadow: true, align: 'left', font: params.font?.family ?? 'minecraft:default' });
      a.object.position.set(-900, 300, 0);
      scene.add(a.object);
      ctx.warn(`text-size:${a.width}x${a.height}`);
    } else if (scenario === 'sprite') {
      const tex = await ctx.resources.texture('test:panel');
      const s = ctx.sprite.create(tex, { nineSlice: [4, 4, 4, 4], pixelSize: 10 });
      s.setSize(800, 400);
      scene.add(s.object);
    } else if (scenario === 'anim') {
      const tex = await ctx.resources.texture('test:anim');
      const s = ctx.sprite.create(tex, { pixelSize: 10 });
      scene.add(s.object);
    } else if (scenario === 'missing') {
      const tex = await ctx.resources.texture('minecraft:block/does_not_exist');
      const s = ctx.sprite.create(tex, { pixelSize: 10 });
      scene.add(s.object);
      await ctx.resources.block('minecraft:not_a_block');
      await ctx.resources.item('minecraft:not_an_item');
    } else if (scenario === 'optional') {
      // 可选贴图：没有时是 null、不记警告，模板退回另一个路径
      const first = await ctx.resources.texture('minecraft:gui/does_not_exist', { optional: true });
      if (first !== null) ctx.warn('optional texture should be null when missing');
      const tex = first ?? (await ctx.resources.texture('minecraft:block/stone', { optional: true }));
      if (tex === null) ctx.warn('optional texture should resolve when present');
      else scene.add(ctx.sprite.create(tex, { pixelSize: 10 }).object);
    }
    return { duration: 1, cutTime: 0.5, update };
  },
};

export default template;
