// 缩略图的场景（docs/03-assets.md 3.10）：方块用正交相机、绕 X 轴 30°、绕 Y 轴 225°，带面明暗；物品正面平视。
import * as THREE from 'three';
import { createBlockHandle } from './blocks';
import { createItemHandle } from './items';
import type { EngineResources, Warn } from './resources';

const DEG = Math.PI / 180;

/** 立方体在这个视角下的投影刚好放进 [-k, k] 的方框：宽 √2，高 cos30° + √2·sin30° ≈ 1.573 */
const BLOCK_EXTENT = 0.82;
const ITEM_EXTENT = 0.5;

export async function buildThumbScene(resources: EngineResources, kind: 'block' | 'item', id: string, warn: Warn): Promise<{ scene: THREE.Scene; camera: THREE.Camera }> {
  const scene = new THREE.Scene();
  let extent: number;
  if (kind === 'block') {
    const obj = (await createBlockHandle(resources, id, { shading: true }, warn)).single();
    obj.rotation.set(30 * DEG, 225 * DEG, 0, 'XYZ');
    scene.add(obj);
    extent = BLOCK_EXTENT;
  } else {
    scene.add((await createItemHandle(resources, id, warn)).single());
    extent = ITEM_EXTENT;
  }
  const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.1, 10);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { scene, camera };
}
