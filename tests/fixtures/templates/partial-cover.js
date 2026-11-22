// @ts-check
// T-ENG-1 的回归场景（docs/decisions.md“Intel 核显上快速清除的渲染目标偶发写坏像素”）：铺满画面的小提示框，静止不动。
// 每个框是两张盖在一起的九宫格贴图，上面五行矢量字（系统字体，线性过滤），最后一行的下沿紧挨框的下沿，
// 和物品提示框（045）出问题的那一组参数（135×135、界面缩放 1）是同一种结构、同一种像素对齐：
// 135×135 时 1 设计单位是超采样缓冲的 1/4 个像素，框的上沿 y ≡ 13（mod 16）、左沿 x ≡ 5（mod 8）。
// 一个框的底、框、各行文字连着画（每个框占自己的一段 z，透明物体按远近排序）。只用公开的模板接口和假资源栈的贴图。

const LINES = ['Diamond Sword', 'Sharpness V', 'Unbreaking III', 'When in Main Hand:', '8 Attack Damage'];
/** 各行文字的上沿，相对框内文字原点（设计单位） */
const LINE_TOP = [0, 12, 22, 42, 52];

/** @type {import('@allay/template-sdk').TemplateModule} */
const template = {
  async setup(ctx) {
    const { scene } = ctx;
    const background = await ctx.resources.texture('test:tooltip/background');
    const frame = await ctx.resources.texture('test:tooltip/frame');
    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 8; col++) {
        // 框的左上角
        const x = -539 + col * 128;
        const y = 525 - row * 96;
        const z0 = (row * 8 + col) * 3;
        for (const [texture, border, z] of /** @type {const} */ ([
          [background, 9, 0],
          [frame, 10, 0.5],
        ])) {
          const sprite = ctx.sprite.create(texture, { nineSlice: [border, border, border, border], pixelSize: 1 });
          sprite.setSize(124, 84);
          sprite.object.position.set(x + 62, y - 42, z0 + z);
          scene.add(sprite.object);
        }
        LINES.forEach((text, i) => {
          const t = ctx.text.create({ text, size: 1, color: i === 0 ? '#55FFFF' : '#AAAAAA', align: 'left', font: { family: 'system:sans', bold: i > 0, italic: true, shadow: i === 0 } });
          t.object.position.set(x + 12 + (i === 4 ? 4 : 0), y - 12 - LINE_TOP[i] - t.height / 2, z0 + 2);
          scene.add(t.object);
        });
      }
    }
    return { duration: 0.5, cutTime: null, update() {} };
  },
};

export default template;
