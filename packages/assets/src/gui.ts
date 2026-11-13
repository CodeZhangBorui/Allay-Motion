// 模板会用到的界面贴图（提示框面板、进度条）及其原版尺寸。
// 路径用 1.20.2 起的 gui/sprites 约定；九宫格在原版里写在同名 .mcmeta 的 gui.scaling 里，这里的值作为缺省。
import type { NineSlice } from './mcmeta';

export interface GuiTextureDef {
  id: string;
  width: number;
  height: number;
  nineSlice?: NineSlice;
}

export const GUI_TEXTURES: readonly GuiTextureDef[] = [
  { id: 'minecraft:gui/sprites/toast/advancement', width: 160, height: 32, nineSlice: { width: 160, height: 32, border: { left: 4, top: 4, right: 4, bottom: 4 } } },
  { id: 'minecraft:gui/sprites/toast/system', width: 160, height: 32, nineSlice: { width: 160, height: 32, border: { left: 4, top: 4, right: 4, bottom: 4 } } },
  { id: 'minecraft:gui/sprites/boss_bar/white_background', width: 182, height: 5 },
  { id: 'minecraft:gui/sprites/boss_bar/white_progress', width: 182, height: 5 },
  { id: 'minecraft:gui/sprites/hud/experience_bar_background', width: 182, height: 5 },
  { id: 'minecraft:gui/sprites/hud/experience_bar_progress', width: 182, height: 5 },
];
