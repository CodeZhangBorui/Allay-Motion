// 目录覆盖率（docs/03-assets.md 3.3 覆盖率检查的改版，见 decisions.md M2a）：
// v1 不再自制内置贴图，检查对象改为某一层（测试夹具、或本机真实 jar 的冒烟脚本）能提供目录里的多少贴图。
import { blockTextureIds, itemTextureIds } from './catalog';
import { GUI_TEXTURES } from './gui';
import { textureIdToPath } from './ids';

export interface RequiredResource {
  /** 资源 ID，用于报告 */
  id: string;
  /** 任一路径存在即算覆盖 */
  anyOf: string[];
  source: 'block' | 'item' | 'gui' | 'template';
}

/** 方块目录、物品目录、界面贴图（以及调用方给的模板默认值）引用到的全部贴图 */
export function requiredTextures(extraTextureIds: readonly string[] = []): RequiredResource[] {
  const out: RequiredResource[] = [];
  const tex = (id: string, source: RequiredResource['source']) => {
    const path = textureIdToPath(id);
    out.push({ id, anyOf: path ? [path] : [], source });
  };
  for (const id of blockTextureIds()) tex(id, 'block');
  for (const id of itemTextureIds()) tex(id, 'item');
  for (const g of GUI_TEXTURES) tex(g.id, 'gui');
  for (const id of extraTextureIds) tex(id, 'template');
  return out;
}

/** 缺了哪些：has 判断某一层（或整个资源栈）里有没有这个文件 */
export function findMissing(required: readonly RequiredResource[], has: (path: string) => boolean): RequiredResource[] {
  return required.filter((r) => !r.anyOf.some(has));
}
