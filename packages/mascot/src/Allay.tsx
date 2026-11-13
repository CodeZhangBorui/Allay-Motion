import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { ClipName } from '../model/allay.motions';
import type { AtlasJson } from './atlas';
import { pickSheetSize, useAtlasSheet, useMascotAssets } from './assets';
import { AllayHead } from './AllayHead';
import { AllayPlaceholder } from './placeholder';
import { useReducedMotion } from './reduced';
import { useMascotSlot, type MascotPriority } from './stage';
import { onMascotFrame } from './ticker';

// Allay（docs/07-allay-mascot.md 7.4）：一只悦灵，只负责画当前帧，不负责移动。
// - 用一个 <canvas> 从烘焙的图集里 drawImage 当前帧；按 size × devicePixelRatio 在 96 和 288 两套里选不小于所需的那套。
// - 动作按图集的 30 fps 步进，由全应用唯一的帧循环驱动（ticker.ts），只在帧号变化时重画。
// - 捧着的东西画在手部锚点上（atlas.json 的 handAnchor，每帧一项）。
// - 朝向用水平翻转，转身 140 ms。glow 留在接口里但不画（界面禁止外发光，docs/decisions.md 界面重设计）。
// - 产物缺失时退回 CSS 占位（placeholder.tsx）。
// - 同一时刻全应用只画一只全身悦灵（stage.ts）；没轮到的只留一个同样大小的空位。
// - 减少动效：静止在当前动作的第一帧。

export interface AllayProps {
  clip?: ClipName;
  /** 显示尺寸（px，正方形） */
  size?: number;
  facing?: 'left' | 'right';
  /** 捧着的东西（物品图标等），画在手部锚点上 */
  carry?: ReactNode;
  /** 悦灵青的 drop-shadow 辉光（不烘进图集）。界面禁止外发光（6.1），不画 */
  glow?: boolean;
  /** 出场位置的优先级（stage.ts）：同一时刻只画优先级最高的那一只 */
  priority?: MascotPriority;
  className?: string;
  style?: CSSProperties;
}

/** 一只悦灵。只负责画当前帧，不负责移动。显示尺寸小于 28 px 时一律用头像（7.3）。 */
export function Allay(props: AllayProps) {
  const { size = 72, className } = props;
  if (size < 28) return <AllayHead size={size} className={className} />;
  return <AllayBody {...props} size={size} />;
}

function AllayBody({ clip = 'hover', size = 72, facing = 'right', carry, priority = 'default', className, style }: AllayProps & { size: number }) {
  const granted = useMascotSlot(priority);
  const assets = useMascotAssets();
  const reduced = useReducedMotion();
  if (!granted) {
    // 没轮到：留出同样大小的空位
    return <span data-allay="reserved" aria-hidden="true" className={`pointer-events-none inline-block shrink-0 ${className ?? ''}`} style={{ width: size, height: size, ...style }} />;
  }
  if (assets.status === 'missing') return <AllayPlaceholder clip={clip} size={size} facing={facing} carry={carry} reduced={reduced} className={className} style={style} />;
  return (
    <span
      data-allay="body"
      data-clip={clip}
      data-source={assets.status === 'ready' ? 'atlas' : 'pending'}
      aria-hidden="true"
      className={`pointer-events-none relative inline-block shrink-0 ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        transform: facing === 'left' ? 'scaleX(-1)' : undefined,
        transition: reduced ? undefined : 'transform 140ms var(--ease-out)',
        ...style,
      }}
    >
      {assets.status === 'ready' && <AtlasFrames atlas={assets.atlas} clip={clip} size={size} carry={carry} reduced={reduced} />}
    </span>
  );
}

function AtlasFrames({ atlas, clip, size, carry, reduced }: { atlas: AtlasJson; clip: ClipName; size: number; carry?: ReactNode; reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const carryRef = useRef<HTMLSpanElement>(null);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const px = Math.max(1, Math.round(size * dpr));
  const cell = pickSheetSize(px, atlas.sizes);
  const sheet = useAtlasSheet(cell);
  const hasCarry = carry !== undefined && carry !== null && carry !== false;

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || !sheet) return;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const { start, count } = atlas.clips[clip];
    const frameMs = 1000 / atlas.fps;
    const t0 = performance.now();
    let last = -1;
    const draw = (now: number) => {
      const f = reduced ? 0 : Math.floor((now - t0) / frameMs) % count;
      if (f === last) return;
      last = f;
      const idx = start + f;
      g.clearRect(0, 0, px, px);
      g.drawImage(sheet, (idx % atlas.columns) * cell, Math.floor(idx / atlas.columns) * cell, cell, cell, 0, 0, px, px);
      const item = carryRef.current;
      const a = atlas.handAnchor[idx];
      if (item && a) item.style.transform = `translate(${(a[0] * size).toFixed(1)}px, ${(a[1] * size).toFixed(1)}px) rotate(${a[2].toFixed(1)}deg) translate(-50%, -50%)`;
    };
    draw(t0);
    if (reduced) return;
    return onMascotFrame(draw);
  }, [atlas, clip, sheet, reduced, px, cell, size, hasCarry]);

  return (
    <>
      <canvas ref={canvasRef} width={px} height={px} className="pointer-events-none block" style={{ width: size, height: size }} />
      {hasCarry && (
        <span ref={carryRef} className="pointer-events-none absolute top-0 left-0 flex items-center justify-center" style={{ width: size * 0.3, height: size * 0.3, transform: 'translate(-9999px, 0)' }}>
          {carry}
        </span>
      )}
    </>
  );
}
