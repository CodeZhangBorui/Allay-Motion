// 官网精选模板的封面和循环帧网格：只为固定 5 个精选模板渲染一次（320×180，20 帧 @ 15 fps），
// 用单个临时导出 Worker 顺序画完立刻释放（不留常驻后台 Worker），供模板卡片和 Alpha 演示共用。
import { frameCount } from '@allay/engine/frames';
import { defaultParams, type FrameQuality } from '@allay/template-sdk';
import { useEffect, useState } from 'react';
import { showcaseBundle, showcaseEntries, type SiteTemplateEntry } from '../../host/templates';
import type { SiteLanguage } from '../prefs';
import { SITE_RESOURCE_STAMP, SiteEngineHost, hasWebgl2 } from './runtime';

export const COVER_W = 320;
export const COVER_H = 180;
export const COVER_FPS = 15;
export const COVER_COLS = 5;
export const COVER_FRAMES = 20;

const COVER_QUALITY: FrameQuality = { subframes: 1, shutterAngle: 180 };

export interface ShowcaseCover {
  url: string;
  sheet: ImageBitmap;
  frames: number;
  cols: number;
  fps: number;
  posterSlot: number;
}

/** 将封面帧网格的指定槽位绘制到目标画布 */
export function drawCoverSlot(ctx: CanvasRenderingContext2D, cover: ShowcaseCover, slot: number): void {
  const safe = ((slot % cover.frames) + cover.frames) % cover.frames;
  ctx.clearRect(0, 0, COVER_W, COVER_H);
  ctx.drawImage(
    cover.sheet,
    (safe % cover.cols) * COVER_W,
    Math.floor(safe / cover.cols) * COVER_H,
    COVER_W,
    COVER_H,
    0,
    0,
    COVER_W,
    COVER_H,
  );
}

/** 按经过秒数计算封面当前帧号（从 posterSlot 起播并在循环末短暂停留） */
export function nextCoverSlot(cover: ShowcaseCover, elapsedSec: number): number {
  const pauseFrames = Math.round(cover.fps * 0.4);
  const span = cover.frames + pauseFrames;
  const step = Math.floor(elapsedSec * cover.fps) % span;
  return step < cover.frames ? (cover.posterSlot + step) % cover.frames : cover.posterSlot;
}

type CoverRecord = Record<string, ShowcaseCover | null>;

const cache = new Map<string, ShowcaseCover | null>();
const listeners = new Set<() => void>();
let desiredLocale: SiteLanguage = 'en';
let pumping = false;

function cacheKey(locale: SiteLanguage, id: string): string {
  return `${locale}:${id}`;
}

function snapshot(locale: SiteLanguage): CoverRecord {
  const out: CoverRecord = {};
  for (const e of showcaseEntries()) {
    const v = cache.get(cacheKey(locale, e.id));
    if (v !== undefined) out[e.id] = v;
  }
  return out;
}

function notify(): void {
  for (const fn of listeners) fn();
}

async function renderCover(host: SiteEngineHost, entry: SiteTemplateEntry, locale: SiteLanguage): Promise<ShowcaseCover | null> {
  const bundle = showcaseBundle(entry.id);
  if (!bundle) return null;
  const params = defaultParams(bundle.entry.manifest.params ?? [], { locale });
  const loaded = await host.load({
    manifest: bundle.entry.manifest,
    code: bundle.code,
    params,
    output: { width: COVER_W, height: COVER_H, fps: COVER_FPS },
    resourceStamp: SITE_RESOURCE_STAMP,
    locale,
  });

  const total = frameCount(loaded.duration, COVER_FPS);
  const count = Math.min(COVER_FRAMES, total);
  const rows = Math.ceil(count / COVER_COLS);
  const sheetCanvas = new OffscreenCanvas(COVER_W * COVER_COLS, COVER_H * rows);
  const sheetCtx = sheetCanvas.getContext('2d');
  const frameCanvas = new OffscreenCanvas(COVER_W, COVER_H);
  const frameCtx = frameCanvas.getContext('2d');
  if (!sheetCtx || !frameCtx) return null;

  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = count === 1 ? 0 : Math.round((i / (count - 1)) * (total - 1));
    indices.push(idx);
  }

  const midSlot = Math.floor(count / 2);
  let bestSlot = midSlot;
  let bestScore = Infinity;
  let bestRgba: Uint8Array | null = null;
  let midRgba: Uint8Array | null = null;

  for (let slot = 0; slot < indices.length; slot++) {
    const idx = indices[slot]!;
    const rgba = await host.renderFrame(idx, COVER_QUALITY);
    frameCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), COVER_W, COVER_H), 0, 0);
    sheetCtx.drawImage(frameCanvas, (slot % COVER_COLS) * COVER_W, Math.floor(slot / COVER_COLS) * COVER_H);

    if (slot === midSlot) midRgba = new Uint8Array(rgba);

    let opaque = 0;
    let totalSamples = 0;
    for (let y = 0; y < COVER_H; y += 4) {
      for (let x = 0; x < COVER_W; x += 4) {
        totalSamples++;
        if (rgba[(y * COVER_W + x) * 4 + 3]! > 20) opaque++;
      }
    }
    const cov = totalSamples > 0 ? opaque / totalSamples : 0;
    if (cov > 0.02) {
      const score = Math.abs(cov - 0.48) + (slot > count * 0.65 ? 0.08 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestSlot = slot;
        bestRgba = new Uint8Array(rgba);
      }
    }
  }

  const chosenSlot = bestRgba ? bestSlot : midSlot;
  const chosenRgba = bestRgba ?? midRgba ?? new Uint8Array(COVER_W * COVER_H * 4);
  frameCtx.putImageData(new ImageData(new Uint8ClampedArray(chosenRgba), COVER_W, COVER_H), 0, 0);
  const posterUrl = URL.createObjectURL(await frameCanvas.convertToBlob({ type: 'image/png' }));

  const sheet = await createImageBitmap(sheetCanvas);
  return { url: posterUrl, sheet, frames: count, cols: COVER_COLS, fps: COVER_FPS, posterSlot: chosenSlot };
}

function nextMissing(locale: SiteLanguage): SiteTemplateEntry | undefined {
  return showcaseEntries().find((e) => !cache.has(cacheKey(locale, e.id)));
}

function pumpCovers(locale: SiteLanguage): void {
  desiredLocale = locale;
  if (!hasWebgl2()) {
    for (const e of showcaseEntries()) {
      const k = cacheKey(locale, e.id);
      if (!cache.has(k)) cache.set(k, null);
    }
    notify();
    return;
  }
  if (pumping || !nextMissing(desiredLocale)) return;
  pumping = true;
  void (async () => {
    let host: SiteEngineHost | null = null;
    try {
      host = await SiteEngineHost.create('export');
      while (true) {
        const currentLocale = desiredLocale;
        const entry = nextMissing(currentLocale);
        if (!entry) break;
        const key = cacheKey(currentLocale, entry.id);
        try {
          cache.set(key, await renderCover(host, entry, currentLocale));
        } catch (error) {
          console.warn(`[site-covers] failed for ${entry.id}`, error);
          cache.set(key, null);
        }
        notify();
      }
    } catch (error) {
      console.warn('[site-covers] export worker unavailable', error);
      for (const entry of showcaseEntries()) {
        const key = cacheKey(desiredLocale, entry.id);
        if (!cache.has(key)) cache.set(key, null);
      }
      notify();
    } finally {
      pumping = false;
      host?.dispose();
      // 若收尾期间语言又切换了，再补一轮
      if (nextMissing(desiredLocale)) pumpCovers(desiredLocale);
    }
  })();
}

/** 订阅 5 个精选模板封面（按语言按需启动一次，画完即销毁导出 Worker） */
export function useShowcaseCovers(locale: SiteLanguage): CoverRecord {
  const [covers, setCovers] = useState<CoverRecord>(() => snapshot(locale));

  useEffect(() => {
    setCovers(snapshot(locale));
    const onUpdate = () => setCovers(snapshot(locale));
    listeners.add(onUpdate);
    const timer = window.setTimeout(() => pumpCovers(locale), 350);
    return () => {
      listeners.delete(onUpdate);
      window.clearTimeout(timer);
    };
  }, [locale]);

  return covers;
}
