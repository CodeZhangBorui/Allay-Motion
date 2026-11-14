// 品牌文案：产品名、字标、非官方声明。全应用只有这里（和 packages/mascot）可以写产品名。
// 换品牌（docs/09-compliance.md 9.4 的方案 B、C）时只改这一处。
// 文案键以 brand. 开头，由 i18n 合并进各语言的资源。

export const brandMessages = {
  'zh-CN': {
    name: '悦灵动画',
    wordmark: 'Allay Motion',
    disclaimer:
      'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.\n本软件不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与它们无关。',
    // 许可范围（用户决定，2026-11-14，docs/decisions.md M8）：GPL-3.0 和商业授权都不包含 Minecraft 的内容，
    // 包括照原版做的悦灵模型和由原版贴图派生的悦灵图像。提到悦灵，所以放在品牌目录里。关于页和 THIRD_PARTY_NOTICES.txt 显示
    licenseScope:
      'GPL-3.0 和商业授权只覆盖本软件自己的代码和原创素材，都不包含 Minecraft 的任何内容：Minecraft 的名称与商标；应用在运行时从 Mojang 下载或从本机游戏读取的原版资源（贴图、模型、音效、字体、语言文件等）；你自己添加的第三方资源包；以及由它们派生的内容，包括照原版悦灵制作的模型数据和由原版贴图渲染的悦灵图像。这些内容的权利属于 Mojang 或各资源包的作者，本软件未获授权、不分发原版资源，也不对它们授予任何权利；请自行遵守 Minecraft 最终用户许可协议和各资源包的许可。',
  },
  en: {
    name: 'Allay Motion',
    wordmark: 'Allay Motion',
    disclaimer: 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.',
    licenseScope:
      'The GPL-3.0 license and the commercial license cover only this software’s own code and original assets. Neither includes any Minecraft content: the Minecraft name and trademarks; the vanilla resources the app downloads from Mojang at runtime or reads from your installed game (textures, models, sounds, fonts, language files and so on); third-party resource packs you add; and anything derived from them, including the Allay model data made after the original and the Allay images rendered from the original texture. Those rights belong to Mojang or to the resource pack authors. This software is not licensed by them, does not distribute vanilla resources and grants no rights to them; follow the Minecraft EULA and each resource pack’s license yourself.',
  },
} as const satisfies Record<'zh-CN' | 'en', Record<'name' | 'wordmark' | 'disclaimer' | 'licenseScope', string>>;

export type BrandMessageKey = keyof (typeof brandMessages)['en'];
