// 方块（docs/02-engine.md 2.8）：形状来自应用自带的方块目录（03-assets.md 3.7），贴图经资源栈解析。
// 每种（几何，材质）组合一个 InstancedMesh，单个方块最多 6 个材质组（有侧面叠加层时另加一组），不做图集。
// 面的明暗用固定系数烘进顶点色：顶 1.0、底 0.5、南北 0.8、东西 0.6。
// 逐实例的不透明度和染色：InstancedBufferAttribute + onBeforeCompile，在这里实现一次。
import { FACES, getBlock, resolveBlockFaces, tintRgb, type Face, type FaceTexture, type RenderType, type ResolvedBlockFaces } from '@allay/assets';
import type { BlockHandle, BlockInstances } from '@allay/template-sdk';
import * as THREE from 'three';
import type { EngineResources, Warn } from './resources';

/** 面明暗（sRGB 空间的系数，和游戏一样乘在贴图颜色上） */
export const FACE_SHADE: Readonly<Record<Face, number>> = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

/**
 * 立方体各面的四个角（逆时针，从面外看），以及 UV：贴图的上边朝 +y（顶面朝北、底面朝南）。
 * 坐标：+x 东，+y 上，+z 南。边长 1，中心在原点。
 */
const FACE_QUADS: Readonly<Record<Face, readonly (readonly [number, number, number])[]>> = {
  // 顺序：左下、右下、右上、左上（从面外看）
  up: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
  down: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]],
  north: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
  south: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
  east: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]],
  west: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]],
};
const QUAD_UV = [0, 0, 1, 0, 1, 1, 0, 1] as const;
const SIDES: readonly Face[] = ['north', 'south', 'east', 'west'];

/** sRGB 系数 → 线性系数（顶点色在线性空间里乘） */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function faceColor(face: Face, tex: FaceTexture, shading: boolean): [number, number, number] {
  const k = shading ? FACE_SHADE[face] : 1;
  const tint = tex.tint ? tintRgb(tex.tint) : ([1, 1, 1] as const);
  return [srgbToLinear(k * tint[0]), srgbToLinear(k * tint[1]), srgbToLinear(k * tint[2])];
}

interface Group {
  face: Face;
  tex: FaceTexture;
  overlay: boolean;
}

/** 立方体几何：每个面一个材质组（同一张贴图的面共用一个材质下标） */
function buildCubeGeometry(groups: readonly Group[], textureIds: readonly string[], shading: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const g = new THREE.BufferGeometry();
  groups.forEach((grp, i) => {
    const base = pos.length / 3;
    const c = faceColor(grp.face, grp.tex, shading);
    FACE_QUADS[grp.face].forEach((p, k) => {
      pos.push(p[0], p[1], p[2]);
      uv.push(QUAD_UV[k * 2]!, QUAD_UV[k * 2 + 1]!);
      color.push(...c);
    });
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    g.addGroup(i * 6, 6, textureIds.indexOf(grp.tex.texture + (grp.overlay ? '#overlay' : '')));
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** 逐实例不透明度：在 alphaTest 之后乘上，这样 cutout 的阈值只看贴图本身的 alpha */
function withInstanceOpacity(material: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nif (vInstanceOpacity <= 0.0) discard;\ndiffuseColor.a *= vInstanceOpacity;');
  };
  material.customProgramCacheKey = () => 'allay-instance-opacity';
  return material;
}

function makeMaterial(map: THREE.Texture, render: RenderType, overlay: boolean, instanced: boolean): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, vertexColors: true });
  // 侧面叠加层（草方块侧面）：抠图并往前偏一点，避免和侧面打架
  if (overlay || render === 'cutout') m.alphaTest = 0.5;
  if (overlay) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
  }
  // 逐实例不透明度要混合，所以实例化的方块一律走透明队列（不透明度为 1 时结果与不透明一样）
  m.transparent = instanced || render === 'translucent';
  return instanced ? withInstanceOpacity(m) : m;
}

interface BlockParts {
  geometry: () => THREE.BufferGeometry;
  textures: Map<string, { tex: THREE.Texture; overlay: boolean }>;
  textureIds: string[];
  render: RenderType;
  /** 每个面的贴图（不含侧面叠加层），BlockHandle.faceTexture 用 */
  faceTextures: Record<Face, THREE.Texture>;
}

async function loadParts(resources: EngineResources, id: string, shading: boolean, warn: Warn): Promise<BlockParts> {
  const def = getBlock(id);
  let faces: ResolvedBlockFaces;
  if (def) {
    faces = resolveBlockFaces(def);
  } else {
    warn(`block ${id} is not in the block catalog; a placeholder is used`);
    const missing: FaceTexture = { texture: 'allay:missing' };
    faces = { faces: { up: missing, down: missing, north: missing, south: missing, east: missing, west: missing }, render: 'opaque' };
  }
  const groups: Group[] = FACES.map((face) => ({ face, tex: faces.faces[face], overlay: false }));
  if (faces.sideOverlay) for (const face of SIDES) groups.push({ face, tex: faces.sideOverlay, overlay: true });
  const textures = new Map<string, { tex: THREE.Texture; overlay: boolean }>();
  for (const grp of groups) {
    const key = grp.tex.texture + (grp.overlay ? '#overlay' : '');
    if (textures.has(key)) continue;
    const tex = def ? await resources.texture(grp.tex.texture, warn) : resources.placeholderTexture();
    textures.set(key, { tex, overlay: grp.overlay });
  }
  const textureIds = [...textures.keys()];
  const faceTextures = Object.fromEntries(FACES.map((face) => [face, textures.get(faces.faces[face].texture)!.tex])) as Record<Face, THREE.Texture>;
  return { geometry: () => buildCubeGeometry(groups, textureIds, shading), textures, textureIds, render: faces.render, faceTextures };
}

/** ctx.resources.block(id, { shading })（04-templates.md 4.5） */
export async function createBlockHandle(resources: EngineResources, id: string, opts: { shading?: boolean } | undefined, warn: Warn): Promise<BlockHandle> {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) throw new TypeError('invalid block id');
  const parts = await loadParts(resources, id, opts?.shading !== false, warn);
  const materials = (instanced: boolean) => parts.textureIds.map((k) => {
    const t = parts.textures.get(k)!;
    return makeMaterial(t.tex, parts.render, t.overlay, instanced);
  });
  return {
    single() {
      return new THREE.Mesh(parts.geometry(), materials(false));
    },
    instanced(count) {
      if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new RangeError('instance count must be an integer between 1 and 100000');
      return createInstances(parts.geometry(), materials(true), count);
    },
    faceTexture(face) {
      if (!(FACES as readonly string[]).includes(face)) throw new TypeError(`invalid block face: ${String(face)}`);
      return parts.faceTextures[face];
    },
  };
}

function createInstances(geometry: THREE.BufferGeometry, materials: THREE.Material[], count: number): BlockInstances {
  const opacity = new Float32Array(count).fill(1);
  const opacityAttr = new THREE.InstancedBufferAttribute(opacity, 1);
  geometry.setAttribute('instanceOpacity', opacityAttr);
  const mesh = new THREE.InstancedMesh(geometry, materials, count);
  // 实例分散在整个舞台上，包围球没有意义
  mesh.frustumCulled = false;
  // 包围球固定在原点：Three 在第一次渲染时按当时的实例矩阵算包围球并缓存下来，透明队列按它的中心排序。
  // 不固定的话，几组实例之间的绘制顺序（以及深度相等时谁胜出）取决于这个 Worker 先渲染了哪一帧，
  // 画面就不再是时间的纯函数（docs/decisions.md M3“实例包围球与绘制顺序”）。
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e9);
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
  const tmp = new THREE.Color();
  let dirtyColor = true;
  let dirtyOpacity = true;
  let dirtyMatrix = true;
  const check = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new RangeError(`instance index out of range: ${i}`);
  };
  return {
    object: mesh,
    count,
    setMatrix(i, matrix) {
      check(i);
      mesh.setMatrixAt(i, matrix);
      dirtyMatrix = true;
    },
    setOpacity(i, value) {
      check(i);
      opacity[i] = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
      dirtyOpacity = true;
    },
    setTint(i, color) {
      check(i);
      mesh.setColorAt(i, tmp.set(color));
      dirtyColor = true;
    },
    commit() {
      if (dirtyMatrix) mesh.instanceMatrix.needsUpdate = true;
      if (dirtyColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (dirtyOpacity) opacityAttr.needsUpdate = true;
      dirtyMatrix = dirtyColor = dirtyOpacity = false;
    },
  };
}
