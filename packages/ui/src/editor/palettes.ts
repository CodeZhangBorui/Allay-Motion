// ColorField 的两个色板（6.5）：dye（16 种染料色）和 chat（16 种聊天格式色）。
// 色值是 Minecraft Java 版的公开数值（染料的 DyeColor 颜色、聊天格式码的前景色）。
// 核对情况见 docs/decisions.md M4：写入时按记忆填写，联网核对没有成功，需要人复核。

export interface PaletteColor {
  key: string;
  hex: string;
}

export const DYE_PALETTE: readonly PaletteColor[] = [
  { key: 'white', hex: '#F9FFFE' },
  { key: 'orange', hex: '#F9801D' },
  { key: 'magenta', hex: '#C74EBD' },
  { key: 'light_blue', hex: '#3AB3DA' },
  { key: 'yellow', hex: '#FED83D' },
  { key: 'lime', hex: '#80C71F' },
  { key: 'pink', hex: '#F38BAA' },
  { key: 'gray', hex: '#474F52' },
  { key: 'light_gray', hex: '#9D9D97' },
  { key: 'cyan', hex: '#169C9C' },
  { key: 'purple', hex: '#8932B8' },
  { key: 'blue', hex: '#3C44AA' },
  { key: 'brown', hex: '#835432' },
  { key: 'green', hex: '#5E7C16' },
  { key: 'red', hex: '#B02E26' },
  { key: 'black', hex: '#1D1D21' },
];

export const CHAT_PALETTE: readonly PaletteColor[] = [
  { key: 'black', hex: '#000000' },
  { key: 'dark_blue', hex: '#0000AA' },
  { key: 'dark_green', hex: '#00AA00' },
  { key: 'dark_aqua', hex: '#00AAAA' },
  { key: 'dark_red', hex: '#AA0000' },
  { key: 'dark_purple', hex: '#AA00AA' },
  { key: 'gold', hex: '#FFAA00' },
  { key: 'gray', hex: '#AAAAAA' },
  { key: 'dark_gray', hex: '#555555' },
  { key: 'blue', hex: '#5555FF' },
  { key: 'green', hex: '#55FF55' },
  { key: 'aqua', hex: '#55FFFF' },
  { key: 'red', hex: '#FF5555' },
  { key: 'light_purple', hex: '#FF55FF' },
  { key: 'yellow', hex: '#FFFF55' },
  { key: 'white', hex: '#FFFFFF' },
];

export const PALETTES = { dye: DYE_PALETTE, chat: CHAT_PALETTE } as const;
