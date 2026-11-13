// 精灵（docs/02-engine.md 2.8）：贴图四边形，支持九宫格拉伸，用于 GUI 面板。
// 九宫格的边框不随尺寸拉伸，中间和四边拉伸。setSize 只改顶点，不新建对象（update 里可以调用）。
import type { SpriteObject, SpriteOptions } from '@allay/template-sdk';
import * as THREE from 'three';
import { textureInfo } from './resources';

/** 以逻辑像素计的九宫格：边框，以及整张图的逻辑尺寸（.mcmeta 的 gui.scaling 可能和贴图实际像素不同，高清包是倍数） */
interface Slice {
  left: number;
  top: number;
  right: number;
  bottom: number;
  logicalWidth: number;
  logicalHeight: number;
}

export function createSprite(texture: THREE.Texture, opts: SpriteOptions | undefined): SpriteObject {
  if (!(texture instanceof THREE.Texture)) throw new TypeError('sprite.create() expects a texture from ctx.resources.texture()');
  const info = textureInfo(texture);
  const frameW = info?.frameWidth ?? 16;
  const frameH = info?.frameHeight ?? 16;
  const pixelSize = opts?.pixelSize !== undefined && Number.isFinite(opts.pixelSize) && opts.pixelSize > 0 ? opts.pixelSize : 1;

  let slice: Slice | null = null;
  if (opts?.nineSlice) {
    const [l, t, r, b] = opts.nineSlice.map((v) => Math.max(0, Number(v) || 0)) as [number, number, number, number];
    slice = { left: l, top: t, right: r, bottom: b, logicalWidth: frameW, logicalHeight: frameH };
  } else if (info?.nineSlice) {
    const n = info.nineSlice;
    slice = { ...n.border, logicalWidth: n.width, logicalHeight: n.height };
  }

  const cols = slice ? 3 : 1;
  const vertexCount = (cols + 1) * (cols + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const index: number[] = [];
  for (let j = 0; j < cols; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 2;
      const d = a + cols + 1;
      index.push(a, b, c, a, c, d);
    }
  // UV 的分割线（u 从左到右，v 从下到上）
  const us = slice ? [0, slice.left / slice.logicalWidth, 1 - slice.right / slice.logicalWidth, 1] : [0, 1];
  const vs = slice ? [0, slice.bottom / slice.logicalHeight, 1 - slice.top / slice.logicalHeight, 1] : [0, 1];
  for (let j = 0; j <= cols; j++)
    for (let i = 0; i <= cols; i++) {
      const k = j * (cols + 1) + i;
      uvs[k * 2] = us[i]!;
      uvs[k * 2 + 1] = vs[j]!;
    }
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const xs = new Float64Array(cols + 1);
  const ys = new Float64Array(cols + 1);
  const setSize = (width: number, height: number) => {
    const w = Math.max(0, Number.isFinite(width) ? width : 0);
    const h = Math.max(0, Number.isFinite(height) ? height : 0);
    xs[0] = -w / 2;
    ys[0] = -h / 2;
    if (slice) {
      // 边框按逻辑像素 × pixelSize；尺寸比两边边框还小时按比例压缩
      const bl = slice.left * pixelSize;
      const br = slice.right * pixelSize;
      const bb = slice.bottom * pixelSize;
      const bt = slice.top * pixelSize;
      const kx = bl + br > w && bl + br > 0 ? w / (bl + br) : 1;
      const ky = bb + bt > h && bb + bt > 0 ? h / (bb + bt) : 1;
      xs[1] = -w / 2 + bl * kx;
      xs[2] = w / 2 - br * kx;
      ys[1] = -h / 2 + bb * ky;
      ys[2] = h / 2 - bt * ky;
    }
    xs[cols] = w / 2;
    ys[cols] = h / 2;
    for (let j = 0; j <= cols; j++)
      for (let i = 0; i <= cols; i++) {
        const k = (j * (cols + 1) + i) * 3;
        positions[k] = xs[i]!;
        positions[k + 1] = ys[j]!;
        positions[k + 2] = 0;
      }
    posAttr.needsUpdate = true;
  };
  setSize((slice?.logicalWidth ?? frameW) * pixelSize, (slice?.logicalHeight ?? frameH) * pixelSize);
  geometry.computeBoundingSphere();

  return {
    object: mesh,
    setSize,
    setOpacity(a) {
      material.opacity = Math.min(1, Math.max(0, Number.isFinite(a) ? a : 0));
    },
  };
}
