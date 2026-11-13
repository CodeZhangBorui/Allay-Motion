// 模板内的小工具（只用 ctx 给的东西）。T3 和 T5 的目录里各有一份相同的：内置模板只能导入本目录内的文件（4.9）。
import type { SetupContext } from '@allay/template-sdk';

type Three = SetupContext['THREE'];
type Texture = InstanceType<Three['Texture']>;

/** '#RRGGBB' 或 '#RRGGBBAA' → sRGB 的 [r, g, b, a]（0–1） */
export function parseColor(hex: string): [number, number, number, number] {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return [1, 1, 1, 1];
  const v = parseInt(m[1]!, 16);
  const a = m[2] === undefined ? 255 : parseInt(m[2], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a / 255];
}

/**
 * 方块朝向相机（+z，南面）那一面的贴图，供着色器平铺。用公开接口 BlockHandle.faceTexture（docs/decisions.md M6b）；
 * 返回的是引擎缓存里的贴图，模板不释放、不改它的属性。
 */
export async function blockFaceTexture(ctx: SetupContext, blockId: string): Promise<Texture> {
  const handle = await ctx.resources.block(blockId, { shading: false });
  return handle.faceTexture('south');
}
