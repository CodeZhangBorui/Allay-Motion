// pnpm mascot:bake 的渲染页：在不显示的 Electron 窗口里，用应用同一份 EngineHost（Worker、看门狗、源码检查）
// 装载内部模板 allay.internal.mascot，按帧号渲染出直通 alpha 的 RGBA，交回 Node 拼图和编码。
import { EngineHost } from '../../../apps/desktop/src/renderer/engine-host/EngineHost';
import { TemplateManifestSchema, type ParamValues, type ResourcePayload } from '../../../packages/template-sdk/src/index';

const manifest = TemplateManifestSchema.parse({
  formatVersion: 1,
  id: 'allay.internal.mascot',
  version: '1',
  name: 'mascot (internal)',
  category: 'overlay',
});

interface TextureIn {
  width: number;
  height: number;
  base64: string;
}

let templateCode = '';
const textures = new Map<string, TextureIn>();

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

const bake = {
  setup(code: string, tex: Record<string, TextureIn>) {
    templateCode = code;
    textures.clear();
    for (const [id, t] of Object.entries(tex)) textures.set(id, t);
  },

  /** 一次装载、按 indices 渲染若干帧（N = 1，不加运动模糊：动作要首尾无缝） */
  async render(params: ParamValues, size: number, indices: number[]): Promise<{ duration: number; warnings: string[]; frames: string[] }> {
    const host = await EngineHost.create({
      mode: 'export',
      strictDeterminism: true,
      resolveResource: async (kind, id): Promise<ResourcePayload | null> => {
        const t = kind === 'texture' ? textures.get(id) : undefined;
        return t ? { kind: 'rgba', width: t.width, height: t.height, data: fromBase64(t.base64) } : null;
      },
    });
    try {
      const loaded = await host.load({ manifest, code: templateCode, params, output: { width: size, height: size, fps: 30 }, resourceStamp: 'mascot-bake' });
      const frames: string[] = [];
      for (const i of indices) frames.push(toBase64(await host.renderFrame(i, { subframes: 1, shutterAngle: 180 })));
      return { duration: loaded.duration, warnings: loaded.warnings, frames };
    } finally {
      host.dispose();
    }
  },
};

export type BakePage = typeof bake;
declare global {
  interface Window {
    bake: BakePage;
    bakeReady: boolean;
  }
}
window.bake = bake;
window.bakeReady = true;
