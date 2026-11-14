// 特性一节：不等大的网格（bento），每张卡配一个真正在动、看得懂的小演示。
// - 透明通道：同一段画面（方块擦除，封面服务刚渲染的帧）一半盖在棋盘格上、一半盖在“素材”上，拖动分界线对比；
// - 预览就是成片：两行同样的帧，同一个播放头扫过，指到的那一帧两行同时点亮；
// - 导出格式：直接取应用的 EXPORT_PRESETS 和应用自己的文案；
// - 资源栈：三层依次叠上去，右边的方块用最上面那层的贴图（上层覆盖下层）；
// - 完全离线：引擎在装载模板前删掉的全局（REMOVED_GLOBALS）一个个划掉；
// - 模板可扩展：manifest 里一条真实的参数定义，旁边就是它生成的控件。
// 演示里的帧都来自桌面版的封面服务（杂务引擎 Worker 渲染），贴图来自官网专用的原版贴图；减少动效时都是静止的终态。
import { localize } from '@allay/template-sdk';
import { FilmStrip, PlugsConnected, PuzzlePiece, Stack, WifiSlash, Export as ExportIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOVED_GLOBALS } from '../../../../../packages/engine/src/harden';
import type { Cover } from '../../../../desktop/src/renderer/features/gallery/covers';
import { EXPORT_PRESETS, PRESET_EXTENSION } from '../../../../desktop/src/shared/export';
import { mcTextureUrl } from '../../host/mc-pack';
import { builtinEntries } from '../../host/templates';
import { SECTION } from '../links';
import { useReveal } from '../motion/interactions';
import { usePrefs } from '../prefs';
import { LiveCanvas } from './LiveCanvas';
import { PRESET_KEY } from './stage/panels';

const DEMO_TEMPLATE = 'allay.builtin.block-wipe';
const ALPHA_TEMPLATE = 'allay.builtin.block-fall';
const COVER_W = 320;
const COVER_H = 180;

/** 某个内置模板的封面（与模板一节共用封面服务；那边已经排了队，这里只是订阅） */
function useCover(id: string): Cover | null {
  const [cover, setCover] = useState<Cover | null>(null);
  useEffect(() => {
    const entry = builtinEntries().find((e) => e.id === id);
    if (!entry) return;
    let off: (() => void) | null = null;
    let alive = true;
    let timer = 0;
    const start = async () => {
      const rt = await import('../engine/runtime');
      await rt.ensureRuntime();
      if (!alive || !rt.hasWebgl2()) return;
      const key = rt.coverKey(entry.id, entry.version);
      const pick = (s: { covers: Record<string, Cover | null> }) => setCover(s.covers[key] ?? null);
      pick(rt.useCoverStore.getState());
      off = rt.useCoverStore.subscribe(pick);
      rt.covers.ensure([entry]);
    };
    timer = window.setTimeout(() => void start(), 1500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      off?.();
    };
  }, [id]);
  return cover;
}

function Card({ index, icon, title, body, children, className, testId, style }: { index: string; icon: ReactNode; title: string; body: string; children?: ReactNode; className?: string; testId?: string; style?: CSSProperties }) {
  return (
    <div className={className} style={style}>
      <article className="card spot flex h-full flex-col p-6 sm:p-7" data-testid={testId}>
        <div className="flex items-center justify-between">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-text">{icon}</span>
          <span className="t-mono text-[10.5px] text-fg-faint">{index}</span>
        </div>
        <h3 className="t-h3 mt-6">{title}</h3>
        <p className="t-body mt-2 max-w-[36em]">{body}</p>
        {children}
      </article>
    </div>
  );
}

/** 一段“素材”：生成的黄昏天空和起伏的山（不是游戏截图） */
function Footage() {
  return (
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #1d2c55 0%, #52507d 38%, #d9866a 72%, #f2c57c 100%)' }}>
      <div className="absolute top-[52%] left-[64%] size-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffe3a8] opacity-90 blur-[2px]" />
      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-[#3b3157]" style={{ clipPath: 'polygon(0 40%, 12% 22%, 24% 38%, 38% 12%, 52% 34%, 66% 18%, 80% 36%, 92% 20%, 100% 30%, 100% 100%, 0 100%)' }} />
      <div className="absolute inset-x-0 bottom-0 h-[26%] bg-[#231d38]" style={{ clipPath: 'polygon(0 30%, 18% 50%, 34% 24%, 50% 46%, 70% 20%, 86% 44%, 100% 26%, 100% 100%, 0 100%)' }} />
    </div>
  );
}

/** 透明通道：方块坠落由引擎实时渲染（透明背景），左半边垫棋盘格、右半边垫“素材”，拖动分界线对比 */
function AlphaDemo() {
  const { t } = useTranslation();
  const [split, setSplit] = useState(50);
  return (
    <div className="relative mt-auto pt-6">
      <div className="relative aspect-video overflow-hidden rounded-[14px] ring-1 ring-[var(--site-line)]">
        <div className="preview-checker absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
          <Footage />
        </div>
        <LiveCanvas templateId={ALPHA_TEMPLATE} className="absolute inset-0" testId="alpha-live" />
        <span className="t-mono absolute top-3 left-3 rounded-full bg-[rgb(0_0_0/.55)] px-2.5 py-1 text-[10px] text-white backdrop-blur">{t('site.features.alpha.transparent')}</span>
        <span className="t-mono absolute top-3 right-3 rounded-full bg-[rgb(0_0_0/.55)] px-2.5 py-1 text-[10px] text-white backdrop-blur">{t('site.features.alpha.over')}</span>
        {/* 分界线 */}
        <div className="pointer-events-none absolute inset-y-0 w-0" style={{ left: `${split}%` }} aria-hidden="true">
          <div className="absolute inset-y-0 -left-px w-[2px] bg-white shadow-[0_0_12px_rgb(var(--glow)/.9)]" />
          <div className="absolute top-1/2 left-0 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#0d0d0e] shadow-[0_4px_20px_rgb(0_0_0/.4)]">
            <span className="text-[14px] font-semibold">⇆</span>
          </div>
        </div>
        <input
          type="range"
          min={4}
          max={96}
          value={split}
          onChange={(e) => setSplit(Number(e.currentTarget.value))}
          className="link-focus absolute inset-0 size-full cursor-ew-resize opacity-0"
          aria-label={t('site.features.alpha.drag')}
        />
      </div>
      <p className="t-mono mt-3 text-[10px] text-fg-subtle">{t('site.features.alpha.drag')} · {t('site.features.alpha.footage')}</p>
    </div>
  );
}

function FramesDemo() {
  const { t } = useTranslation();
  const cover = useCover(DEMO_TEMPLATE);
  const N = 7;
  const strips = useRef<(HTMLCanvasElement | null)[]>([]);
  const [hot, setHot] = useState(0);
  const { reducedMotion } = usePrefs();
  // 帧条：从整段里均匀取 N 帧
  useEffect(() => {
    const sheet = cover?.sheet;
    if (!cover || !sheet) return;
    strips.current.forEach((c, k) => {
      const g = c?.getContext('2d');
      if (!g) return;
      const i = Math.min(cover.frames - 1, Math.round(((k % N) + 0.5) * (cover.frames / N)));
      g.clearRect(0, 0, COVER_W, COVER_H);
      g.drawImage(sheet, (i % cover.cols) * COVER_W, Math.floor(i / cover.cols) * COVER_H, COVER_W, COVER_H, 0, 0, COVER_W, COVER_H);
    });
  }, [cover]);
  // 播放头：一格一格往前走
  useEffect(() => {
    if (reducedMotion) {
      setHot(3);
      return;
    }
    const id = window.setInterval(() => setHot((h) => (h + 1) % N), 520);
    return () => window.clearInterval(id);
  }, [reducedMotion]);
  const frameNo = cover ? Math.round((hot + 0.5) * (cover.frames / N)) : hot;
  return (
    <div className="mt-6 flex-1 space-y-2" aria-hidden="true">
      {(['preview', 'export'] as const).map((row, r) => (
        <div key={row} className="flex items-center gap-3">
          <span className="t-mono w-16 shrink-0 text-[10px] text-fg-subtle">{t(`site.features.frames.${row}`)}</span>
          <div className="relative grid flex-1 grid-cols-7 gap-1">
            {Array.from({ length: N }, (_, k) => (
              <div key={k} className={`preview-checker relative aspect-video overflow-hidden rounded-[5px] transition-[box-shadow,opacity] duration-300 ${k === hot ? 'opacity-100 shadow-[0_0_0_2px_var(--primary),0_0_16px_rgb(var(--glow)/.6)]' : 'opacity-55'}`}>
                <canvas
                  ref={(el) => {
                    strips.current[r * N + k] = el;
                  }}
                  width={COVER_W}
                  height={COVER_H}
                  className="absolute inset-0 size-full"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 pt-2">
        <span className="w-16 shrink-0" />
        <div className="relative h-5 flex-1">
          <div className="absolute top-1/2 h-px w-full bg-[var(--site-line-hi)]" />
          <div className="absolute top-0 bottom-0 w-[2px] rounded bg-primary transition-[left] duration-500 ease-(--ease-expo)" style={{ left: `${((hot + 0.5) / N) * 100}%`, boxShadow: '0 0 10px rgb(var(--glow)/.9)' }} />
        </div>
      </div>
      <p className="t-mono pl-[76px] text-[10px] text-primary-text">
        {t('site.features.frames.same')} · #{String(frameNo).padStart(3, '0')} · frame(t) = update(t)
      </p>
    </div>
  );
}

function FormatsDemo() {
  const { t } = useTranslation();
  return (
    <ul className="mt-6 flex-1 space-y-1.5" data-testid="format-list">
      {EXPORT_PRESETS.map((p) => (
        <li key={p} data-preset={p} className="group/row rounded-[12px] px-3 py-2.5 transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-medium">{t(`export.presets.${PRESET_KEY[p]}`)}</span>
            <span className="t-tab rounded-md bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary-text">.{PRESET_EXTENSION[p]}</span>
          </div>
          <p className="mt-1 text-[12.5px] text-fg-subtle">{t('export.worksWith', { apps: t(`export.presetFor.${PRESET_KEY[p]}`) })}</p>
        </li>
      ))}
    </ul>
  );
}

/** 资源栈：三层依次叠上去，右边的方块用最上面那层的贴图 */
function StackDemo() {
  const { t } = useTranslation();
  const { reducedMotion } = usePrefs();
  const layers = t('site.features.stack.layers', { returnObjects: true }) as string[];
  const [top, setTop] = useState(2); // 叠到第几层（0 内置、1 原版、2 资源包）
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (reducedMotion || hover !== null) return;
    const id = window.setInterval(() => setTop((v) => (v + 1) % 3), 1600);
    return () => window.clearInterval(id);
  }, [reducedMotion, hover]);
  const active = hover ?? top;
  const diamond = mcTextureUrl('minecraft:diamond_block');
  // 第 0 层：内置层（生成的纯色块）；第 1 层：原版贴图；第 2 层：资源包（用滤镜把原版贴图换个色，示意“换皮”）
  const swatch = (i: number): CSSProperties =>
    i === 0 || !diamond
      ? { background: i === 2 ? '#9B85E8' : i === 1 ? '#52D6DC' : 'repeating-linear-gradient(45deg, #3f8fa8 0 4px, #4aa6c1 4px 8px)' }
      : { backgroundImage: `url(${diamond})`, backgroundSize: 'cover', imageRendering: 'pixelated', filter: i === 2 ? 'hue-rotate(115deg) saturate(1.3)' : undefined };
  return (
    <div className="mt-6 flex flex-1 items-center gap-5" onMouseLeave={() => setHover(null)}>
      <div className="flex flex-1 flex-col-reverse gap-1.5">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className={`link-focus flex h-11 items-center gap-3 rounded-[11px] px-3 text-left text-[13px] transition-[opacity,transform,background-color] duration-500 ease-(--ease-expo) ${i <= active ? 'bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] opacity-100' : '-translate-y-1 opacity-35'}`}
            aria-pressed={i <= active}
          >
            <span className="t-mono w-4 text-[10px] text-fg-faint">{i + 1}</span>
            <span className="pixelated size-6 shrink-0 rounded-[4px]" style={swatch(i)} />
            <span className={i === active ? 'font-medium text-foreground' : 'text-fg-muted'}>{layers[2 - i]}</span>
          </button>
        ))}
      </div>
      {/* 结果：一块等距视角的方块，贴图取最上面那层 */}
      <div className="relative size-[86px] shrink-0" style={{ perspective: '400px' }} aria-hidden="true">
        <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d', transform: 'rotateX(-28deg) rotateY(38deg)' }}>
          {(['front', 'right', 'top'] as const).map((f) => (
            <span
              key={f}
              className="pixelated absolute inset-[18px] transition-[filter,background] duration-500"
              style={{
                ...swatch(active),
                transform: f === 'front' ? 'translateZ(25px)' : f === 'right' ? 'rotateY(90deg) translateZ(25px)' : 'rotateX(90deg) translateZ(25px)',
                filter: `${swatch(active).filter ?? ''} brightness(${f === 'top' ? 1.1 : f === 'right' ? 0.7 : 0.88})`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OfflineDemo() {
  const { t } = useTranslation();
  const ref = useReveal<HTMLUListElement>(0.3);
  return (
    <div className="mt-6 flex-1">
      <p className="t-mono text-[10px] text-fg-subtle">{t('site.features.offline.sandbox')}</p>
      <ul ref={ref} className="strike mt-3 grid grid-cols-2 gap-1.5">
        {REMOVED_GLOBALS.map((g, i) => (
          <li key={g} className="t-tab relative rounded-[8px] bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] px-2.5 py-1.5 text-[11.5px] text-fg-muted" style={{ '--i': i } as CSSProperties}>
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** manifest 里一条真实的参数定义（第一个带范围的整数参数）和它生成的控件 */
function ExtendDemo() {
  const { language, reducedMotion } = usePrefs();
  const param = useMemo(() => {
    for (const e of builtinEntries()) {
      const p = (e.manifest.params ?? []).find((x) => x.type === 'integer' && 'min' in x && 'max' in x);
      if (p) return p as typeof p & { default: number; min: number; max: number; ui?: string };
    }
    return null;
  }, []);
  const [v, setV] = useState(param?.default ?? 0);
  useEffect(() => {
    if (!param || reducedMotion) return;
    let k = 0;
    const id = window.setInterval(() => {
      k++;
      setV(Math.round(param.min + ((Math.sin(k * 0.5) + 1) / 2) * (param.max - param.min)));
    }, 700);
    return () => window.clearInterval(id);
  }, [param, reducedMotion]);
  if (!param) return null;
  const json = { key: param.key, type: param.type, label: param.label, default: param.default, min: param.min, max: param.max, ...(param.ui ? { ui: param.ui } : {}) };
  const fill = (v - param.min) / (param.max - param.min || 1);
  return (
    <div className="mt-6 grid flex-1 items-center gap-4 md:grid-cols-[1.3fr_auto_1fr]">
      <pre className="t-tab overflow-x-auto rounded-[14px] bg-[color-mix(in_oklab,var(--well)_80%,transparent)] p-4 text-[11.5px] leading-[1.6] ring-1 ring-[var(--site-line)]" aria-label="manifest.json">
        {JSON.stringify(json, null, 2)
          .split('\n')
          .map((line, i) => {
            const m = /^(\s*)("[^"]+")(:\s*)(.*)$/.exec(line);
            return (
              <span key={i} className="block">
                {m ? (
                  <>
                    {m[1]}
                    <span className="text-primary-text">{m[2]}</span>
                    {m[3]}
                    <span className={/^"/.test(m[4]!) ? 'text-[var(--cue)]' : /^[\d.]/.test(m[4]!) ? 'text-[var(--mark)]' : 'text-fg-muted'}>{m[4]}</span>
                  </>
                ) : (
                  <span className="text-fg-subtle">{line}</span>
                )}
              </span>
            );
          })}
      </pre>
      <span className="t-mono hidden text-center text-[18px] text-fg-faint md:block" aria-hidden="true">
        →
      </span>
      <div className="rounded-[14px] bg-surface-2 p-4 ring-1 ring-[var(--site-line)]" aria-hidden="true">
        <div className="flex items-baseline justify-between text-[12.5px]">
          <span className="text-fg-muted">{localize(param.label, language)}</span>
          <span className="t-tab font-medium">{v}</span>
        </div>
        <div className="relative mt-3 h-1.5 rounded-full bg-well">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500 ease-(--ease-expo)" style={{ width: `${fill * 100}%` }} />
          <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-[0_0_0_3px_var(--primary-soft)] transition-[left] duration-500 ease-(--ease-expo)" style={{ left: `${fill * 100}%` }} />
        </div>
        <div className="t-tab mt-2 flex justify-between text-[10px] text-fg-faint">
          <span>{param.min}</span>
          <span>{param.max}</span>
        </div>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const { t } = useTranslation();
  const head = useReveal<HTMLDivElement>();
  const grid = useReveal<HTMLDivElement>(0.06);
  const i = (n: number) => ({ '--i': n }) as CSSProperties;
  return (
    <section id={SECTION.features} data-clip="features" data-clip-color="var(--stage-enter)" aria-labelledby="features-title" className="relative py-32">
      <div className="ruler wrap pointer-events-none absolute inset-x-0 top-0 opacity-60" aria-hidden="true" />
      <div className="wrap relative">
        <div ref={head} className="reveal relative max-w-[900px]">
          <span data-allay-anchor="features" data-allay-facing="left" className="absolute -top-6 right-0 size-1 lg:-right-[18%]" aria-hidden="true" />
          <p className="t-mono text-fg-subtle">{t('site.features.kicker')}</p>
          <h2 id="features-title" className="t-h2 mt-4">
            {t('site.features.title')}
          </h2>
        </div>
        <div ref={grid} className="reveal mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          <Card index="F/01" icon={<FilmStrip size={20} weight="fill" />} title={t('site.features.alpha.title')} body={t('site.features.alpha.body')} className="md:col-span-2 lg:col-span-7 lg:row-span-2" testId="feature-alpha" style={i(0)}>
            <AlphaDemo />
          </Card>
          <Card index="F/02" icon={<PlugsConnected size={20} weight="fill" />} title={t('site.features.frames.title')} body={t('site.features.frames.body')} className="lg:col-span-5" style={i(1)}>
            <FramesDemo />
          </Card>
          <Card index="F/03" icon={<ExportIcon size={20} weight="fill" />} title={t('site.features.formats.title')} body={t('site.features.formats.body')} className="lg:col-span-5" style={i(2)}>
            <FormatsDemo />
          </Card>
          <Card index="F/04" icon={<Stack size={20} weight="fill" />} title={t('site.features.stack.title')} body={t('site.features.stack.body')} className="lg:col-span-4" style={i(3)}>
            <StackDemo />
          </Card>
          <Card index="F/05" icon={<WifiSlash size={20} weight="fill" />} title={t('site.features.offline.title')} body={t('site.features.offline.body')} className="lg:col-span-3" style={i(4)}>
            <OfflineDemo />
          </Card>
          <Card index="F/06" icon={<PuzzlePiece size={20} weight="fill" />} title={t('site.features.extend.title')} body={t('site.features.extend.body')} className="md:col-span-2 lg:col-span-5" style={i(5)}>
            <ExtendDemo />
          </Card>
        </div>
      </div>
    </section>
  );
}
