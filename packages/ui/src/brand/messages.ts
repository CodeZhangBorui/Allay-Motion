// 品牌文案：产品名、字标、非官方声明。全应用只有这里（和 packages/mascot）可以写产品名。
// 换品牌（docs/09-compliance.md 9.4 的方案 B、C）时只改这一处。
// 文案键以 brand. 开头，由 i18n 合并进各语言的资源。

export const brandMessages = {
  'zh-CN': {
    name: '悦灵动画',
    wordmark: 'Allay Motion',
    disclaimer:
      'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.\n本软件不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与它们无关。',
    // 吉祥物图像的来源（docs/decisions.md M5a：用原版贴图烘焙，用户决定并担责）；关于页显示（M8）
    mascotCredit: '应用里悦灵的图像派生自 Minecraft 原版的悦灵贴图，贴图的版权归 Mojang 所有；这种使用没有经过 Mojang 的许可或认可。',
  },
  en: {
    name: 'Allay Motion',
    wordmark: 'Allay Motion',
    disclaimer: 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.',
    mascotCredit: 'The Allay images in this app are derived from the original Minecraft Allay texture, which is copyright Mojang. This use is not licensed or endorsed by Mojang.',
  },
} as const satisfies Record<'zh-CN' | 'en', Record<'name' | 'wordmark' | 'disclaimer' | 'mascotCredit', string>>;

export type BrandMessageKey = keyof (typeof brandMessages)['en'];
