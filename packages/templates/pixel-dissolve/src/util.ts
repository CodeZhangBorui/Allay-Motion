// 模板内的小工具（只用 ctx 给的东西）。T3 和 T5 的目录里各有一份相同的：内置模板只能导入本目录内的文件（4.9）。
import type { SetupContext } from '@allay/template-sdk';

type Three = SetupContext['THREE'];
type Texture = InstanceType<Three['Texture']>;
type Object3D = InstanceType<Three['Object3D']>;
type Mesh = InstanceType<Three['Mesh']>;
type Material = InstanceType<Three['Material']>;

/** '#RRGGBB' 或 '#RRGGBBAA' → sRGB 的 [r, g, b, a]（0–1） */
export function parseColor(hex: string): [number, number, number, number] {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return [1, 1, 1, 1];
  const v = parseInt(m[1]!, 16);
  const a = m[2] === undefined ? 255 : parseInt(m[2], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, a / 255];
}

/**
 * 方块朝向相机（+z，南面）那一面的贴图，供着色器平铺。
 * 模板接口里没有“取方块某个面的贴图”（方块到贴图的对应在应用的方块目录里，模板拿不到），
 * 这里用公开的 ctx.resources.block(id).single()：在它的几何里找所有顶点 z = +0.5 的材质组，取该组材质的 map。
 * 只读 Three 的公开属性；找不到时退回同名的 block/ 贴图。见 docs/decisions.md M6a。
 */
export async function blockFaceTexture(ctx: SetupContext, blockId: string): Promise<Texture> {
  const handle = await ctx.resources.block(blockId, { shading: false });
  const obj = handle.single();
  const box: { found: Texture | null } = { found: null };
  obj.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (box.found || !mesh.isMesh) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    if (!pos || !index) return;
    const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const g of geo.groups) {
      let front = g.count > 0;
      for (let k = g.start; k < g.start + g.count && front; k++) if (pos.getZ(index.getX(k)) < 0.5 - 1e-6) front = false;
      const mat = mats[g.materialIndex ?? 0] as (Material & { map?: Texture | null }) | undefined;
      // 跳过侧面叠加层（抠图的那一层）
      if (front && mat && mat.map && mat.alphaTest === 0) {
        box.found = mat.map;
        return;
      }
    }
  });
  // single() 没有加进场景，自己释放（贴图属于引擎的缓存，不释放）
  obj.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  });
  if (box.found) return box.found;
  const colon = blockId.indexOf(':');
  return ctx.resources.texture(colon < 0 ? `minecraft:block/${blockId}` : `${blockId.slice(0, colon)}:block/${blockId.slice(colon + 1)}`);
}
