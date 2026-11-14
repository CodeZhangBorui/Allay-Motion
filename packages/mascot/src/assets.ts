import { useEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { CLIP_ORDER } from '../model/allay.motions';
import { HEAD_SIZES, type AtlasJson } from './atlas';

// 运行时读取烘焙产物（docs/07-allay-mascot.md 7.3、7.4；docs/decisions.md M5b）。
// 产物不在仓库里（原版贴图的派生图像，M5a），由主进程在 app://renderer/mascot/ 下提供：
// 打包后来自安装目录的 resources/mascot，开发时来自 packages/mascot/generated。
// 读不到 allay.atlas.json（404、格式不对）就是“缺产物”，组件退回 CSS 占位实现。
// 图集解码成 ImageBitmap，每个尺寸全应用只解码一次。

const ClipRange = z.object({ start: z.int().min(0), count: z.int().min(1) });

/** 文件读写的边界用 zod 校验（AGENTS.md 代码约定） */
export const AtlasJsonSchema = z
  .object({
    fps: z.number().positive().max(240),
    columns: z.int().min(1).max(64),
    frames: z.int().min(1).max(4096),
    sizes: z.array(z.int().min(8).max(1024)).min(1),
    clips: z.object(Object.fromEntries(CLIP_ORDER.map((c) => [c, ClipRange])) as Record<(typeof CLIP_ORDER)[number], typeof ClipRange>),
    handAnchor: z.array(z.tuple([z.number(), z.number(), z.number()])),
  })
  .refine((a) => a.handAnchor.length === a.frames, 'handAnchor must have one entry per frame')
  .refine((a) => Object.values(a.clips).every((c) => c.start + c.count <= a.frames), 'clip out of range');

export type MascotAssets = { status: 'pending' } | { status: 'missing' } | { status: 'ready'; atlas: AtlasJson };

let state: MascotAssets = { status: 'pending' };
let started = false;
const listeners = new Set<() => void>();

function set(next: MascotAssets): void {
  state = next;
  for (const l of listeners) l();
}

/** 产物所在的目录：页面同源的 mascot/ */
export function mascotBaseUrl(): string {
  return new URL('mascot/', document.baseURI).href;
}

function start(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  void (async () => {
    try {
      const res = await fetch(`${mascotBaseUrl()}allay.atlas.json`);
      if (!res.ok) throw new Error(`atlas ${res.status}`);
      const atlas = AtlasJsonSchema.parse(await res.json());
      set({ status: 'ready', atlas });
    } catch {
      set({ status: 'missing' });
    }
  })();
}

function subscribe(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getState = () => state;
const getServerState = (): MascotAssets => ({ status: 'pending' });

export function useMascotAssets(): MascotAssets {
  return useSyncExternalStore(subscribe, getState, getServerState);
}

/** 不用 React 时取当前状态（会触发读取） */
export function mascotAssets(): MascotAssets {
  start();
  return state;
}

/** 等产物读完（测试和启动时预热用） */
export function whenMascotAssetsSettled(): Promise<MascotAssets> {
  start();
  if (state.status !== 'pending') return Promise.resolve(state);
  return new Promise((resolve) => {
    const off = subscribe(() => {
      if (state.status === 'pending') return;
      off();
      resolve(state);
    });
  });
}

// ---- 图集 ----

const sheets = new Map<number, Promise<ImageBitmap | null>>();
const decoded = new Map<number, ImageBitmap>();

/** 在烘焙的几套帧尺寸里选不小于所需像素的那套；都不够时用最大的 */
export function pickSheetSize(devicePx: number, sizes: readonly number[]): number {
  const sorted = [...sizes].sort((a, b) => a - b);
  return sorted.find((s) => s >= devicePx) ?? sorted[sorted.length - 1]!;
}

function loadSheet(size: number): Promise<ImageBitmap | null> {
  let p = sheets.get(size);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${mascotBaseUrl()}allay-${size}.png`);
        if (!res.ok) return null;
        const bitmap = await createImageBitmap(await res.blob());
        decoded.set(size, bitmap);
        return bitmap;
      } catch {
        return null;
      }
    })();
    sheets.set(size, p);
  }
  return p;
}

/** 某个尺寸的图集；第一次用时解码，解码好之前返回 null，好了以后组件重渲染 */
export function useAtlasSheet(size: number | null): ImageBitmap | null {
  const [, bump] = useState(0);
  const ready = size === null ? null : (decoded.get(size) ?? null);
  useEffect(() => {
    if (size === null || decoded.has(size)) return;
    let alive = true;
    void loadSheet(size).then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [size]);
  return ready;
}

/** 正面头像：取设备像素不超过所需的最大一张（整数倍显示，不糊）；所需比最小的还小时用最小的 */
export function pickHeadSize(devicePx: number): number {
  let best: number = HEAD_SIZES[0];
  for (const s of HEAD_SIZES) if (s <= devicePx) best = s;
  return best;
}

export function headUrl(size: number, closed: boolean): string {
  return `${mascotBaseUrl()}allay-head-${size}${closed ? '-closed' : ''}.png`;
}
