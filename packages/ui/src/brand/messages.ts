// 品牌文案：产品名、字标、非官方声明。全应用只有这里（和 packages/mascot）可以写产品名。
// 换品牌（docs/09-compliance.md 9.4 的方案 B、C）时只改这一处。
// 文案键以 brand. 开头，由 i18n 合并进各语言的资源。

export const brandMessages = {
  'zh-CN': {
    name: '悦灵动画',
    wordmark: 'Allay Motion',
    disclaimer:
      'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.\n本软件不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与它们无关。',
  },
  en: {
    name: 'Allay Motion',
    wordmark: 'Allay Motion',
    disclaimer: 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.',
  },
} as const satisfies Record<'zh-CN' | 'en', Record<'name' | 'wordmark' | 'disclaimer', string>>;

export type BrandMessageKey = keyof (typeof brandMessages)['en'];
