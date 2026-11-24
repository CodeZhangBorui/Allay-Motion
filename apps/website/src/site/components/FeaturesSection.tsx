// 特性一节（精简为 4 张核心卡片）：
// - F/01 透明通道：复用封面服务的 block-wipe 半透明代表帧做分界对比（不额外开 WebGL 上下文）；
// - F/02 导出格式：桌面端四种导出预设；
// - F/03 资源栈：支持真正点击切换与锁定层，离开视口暂停自动轮换；
// - F/04 离线与沙箱隔离：列出从模板 Worker 移除的全局对象。
import { Button } from '@allay/ui/components/button';
import { Badge, Skeleton } from '@allay/ui/components/misc';
import { Export as ExportIcon, FilmStrip, Stack, WifiSlash } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOVED_GLOBALS } from '../../../../../packages/engine/src/harden';
import { mcTextureUrl } from '../../host/mc-pack';
import { useShowcaseCovers, type ShowcaseCover } from '../engine/covers';
import { SECTION } from '../links';
import { useReveal } from '../motion/interactions';
import { usePrefs } from '../prefs';

const ALPHA_TEMPLATE = 'allay.builtin.block-wipe';

function Card({
  index,
  icon,
  title,
  body,
  children,
  className,
  testId,
  style,
}: {
  index: string;
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
  className?: string;
  testId?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      <article className="card flex h-full flex-col p-6 sm:p-7" data-testid={testId}>
        <div className="flex items-center justify-between">
          <span className="flex size-9 items-center justify-center rounded-lg bg-control text-fg-muted">{icon}</span>
          <span className="t-mono text-[10.5px] text-fg-subtle">{index}</span>
        </div>
        <h3 className="t-h3 mt-5">{title}</h3>
        <p className="t-body mt-2 max-w-[36em]">{body}</p>
        {children}
      </article>
    </div>
  );
}

/** 示意背景素材 */
function Footage() {
  return (
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #1d2c55 0%, #52507d 38%, #d9866a 72%, #f2c57c 100%)' }}>
      <div className="absolute top-[52%] left-[64%] aspect-square w-[11%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffe3a8] opacity-90 blur-[2px]" />
      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-[#3b3157]" style={{ clipPath: 'polygon(0 40%, 12% 22%, 24% 38%, 38% 12%, 52% 34%, 66% 18%, 80% 36%, 92% 20%, 100% 30%, 100% 100%, 0 100%)' }} />
      <div className="absolute inset-x-0 bottom-0 h-[26%] bg-[#231d38]" style={{ clipPath: 'polygon(0 30%, 18% 50%, 34% 24%, 50% 46%, 70% 20%, 86% 44%, 100% 26%, 100% 100%, 0 100%)' }} />
    </div>
  );
}

/** 在分界线上叠加 block-wipe 渲染出的半透明代表帧（无额外 WebGL 上下文或空闲 rAF） */
function CoverOverlay({ cover, label }: { cover: ShowcaseCover | null | undefined; label: string }) {
  if (cover === undefined) return <Skeleton className="absolute inset-0 size-full rounded-none opacity-40" />;
  if (cover === null) return null;
  return <img src={cover.url} alt={label} className="pointer-events-none absolute inset-0 size-full object-cover" draggable={false} />;
}

function AlphaDemo() {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const [split, setSplit] = useState(50);
  const covers = useShowcaseCovers(language);
  const cover = covers[ALPHA_TEMPLATE];

  return (
    <div className="relative mt-auto pt-6">
      <div className="relative aspect-video overflow-hidden rounded-md ring-1 ring-[var(--site-line)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ring)]">
        <div className="preview-checker absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
          <Footage />
        </div>
        <CoverOverlay cover={cover} label={t('site.features.alpha.title')} />
        <Badge className="absolute top-3 left-3">{t('site.features.alpha.transparent')}</Badge>
        <Badge className="absolute top-3 right-3">{t('site.features.alpha.over')}</Badge>
        <div className="pointer-events-none absolute inset-y-0 w-0" style={{ left: `${split}%` }} aria-hidden="true">
          <div className="absolute inset-y-0 -left-px w-[2px] bg-foreground" />
          <div className="float absolute top-1/2 left-0 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center !rounded-full text-foreground">
            <span className="text-[13px] font-semibold">⇆</span>
          </div>
        </div>
        <input
          type="range"
          min={4}
          max={96}
          value={split}
          aria-valuetext={`${split}%`}
          onChange={(e) => setSplit(Number(e.currentTarget.value))}
          data-testid="alpha-split"
          className="link-focus absolute inset-0 size-full cursor-ew-resize opacity-0"
          aria-label={t('site.features.alpha.drag')}
        />
      </div>
      <p className="t-mono mt-3 text-[10px] text-fg-subtle">
        {t('site.features.alpha.drag')} · {t('site.features.alpha.footage')}
      </p>
    </div>
  );
}

interface FormatItem {
  name: string;
  ext: string;
  apps: string;
}

function FormatsDemo() {
  const { t } = useTranslation();
  const items = t('site.features.formats.items', { returnObjects: true }) as FormatItem[];
  return (
    <ul className="mt-5 flex-1 space-y-1.5" data-testid="format-list">
      {items.map((item) => (
        <li key={item.ext} className="rounded-md px-3 py-2.5 transition-colors duration-(--dur-1) hover:bg-control">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-medium">{item.name}</span>
            <Badge className="t-tab">{item.ext}</Badge>
          </div>
          <p className="mt-1 text-[12.5px] text-fg-subtle">{item.apps}</p>
        </li>
      ))}
    </ul>
  );
}

/** 三层资源栈：支持点击选中并锁定，仅在可见且未被点击锁定时温和轮播 */
function StackDemo() {
  const { t } = useTranslation();
  const { reducedMotion } = usePrefs();
  const layers = t('site.features.stack.layers', { returnObjects: true }) as string[];
  const [autoLayer, setAutoLayer] = useState(2);
  const [selected, setSelected] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reducedMotion || selected !== null || !visible) return;
    const id = window.setInterval(() => setAutoLayer((v) => (v + 1) % 3), 1800);
    return () => window.clearInterval(id);
  }, [reducedMotion, selected, visible]);

  const active = selected ?? autoLayer;
  const diamond = mcTextureUrl('minecraft:diamond_block');
  const swatch = (i: number): CSSProperties =>
    i === 0 || !diamond
      ? { background: i === 2 ? '#9B85E8' : i === 1 ? '#52D6DC' : 'repeating-linear-gradient(45deg, #3f8fa8 0 4px, #4aa6c1 4px 8px)' }
      : { backgroundImage: `url(${diamond})`, backgroundSize: 'cover', imageRendering: 'pixelated', filter: i === 2 ? 'hue-rotate(115deg) saturate(1.3)' : undefined };

  return (
    <div ref={rootRef} className="mt-auto flex flex-1 items-center gap-5 pt-6">
      <div className="flex flex-1 flex-col-reverse gap-1.5">
        {[0, 1, 2].map((i) => (
          <Button
            key={i}
            type="button"
            variant="ghost"
            size="lg"
            data-testid="stack-layer"
            data-layer={i}
            onClick={() => setSelected(i)}
            className={`h-10 justify-start gap-3 transition-[opacity,transform,background-color] duration-300 ${i <= active ? 'opacity-100' : 'opacity-45'}`}
            aria-pressed={i === active}
          >
            <span className="t-mono w-4 text-[10px] text-fg-subtle">{i + 1}</span>
            <span className="pixelated size-6 shrink-0 rounded-[4px]" style={swatch(i)} />
            <span className={i === active ? 'font-medium text-foreground' : 'text-fg-muted'}>{layers[2 - i]}</span>
          </Button>
        ))}
      </div>

      <div className="relative size-[86px] shrink-0" style={{ perspective: '400px' }} aria-hidden="true">
        <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d', transform: 'rotateX(-28deg) rotateY(38deg)' }}>
          {(['front', 'right', 'top'] as const).map((f) => (
            <span
              key={f}
              className="pixelated absolute inset-[18px] transition-[filter,background] duration-300"
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
  const ref = useReveal<HTMLUListElement>(0.25);
  return (
    <div className="mt-5 flex-1">
      <p className="t-mono text-[10px] text-fg-subtle">{t('site.features.offline.sandbox')}</p>
      <ul ref={ref} className="strike mt-3 grid grid-cols-2 gap-1.5">
        {REMOVED_GLOBALS.map((g, i) => (
          <li key={g} className="t-tab relative rounded-sm bg-control px-2.5 py-1.5 text-[11.5px] text-fg-muted" style={{ '--i': i } as CSSProperties}>
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FeaturesSection() {
  const { t } = useTranslation();
  const head = useReveal<HTMLDivElement>();
  const grid = useReveal<HTMLDivElement>(0.06);
  const i = (n: number) => ({ '--i': n }) as CSSProperties;

  return (
    <section id={SECTION.features} aria-labelledby="features-title" className="relative border-t border-[var(--site-line)] py-20 lg:py-28">
      <div className="wrap relative">
        <div ref={head} className="reveal max-w-[44em]">
          <p className="t-mono text-fg-subtle">{t('site.features.kicker')}</p>
          <h2 id="features-title" className="t-h2 mt-3">
            {t('site.features.title')}
          </h2>
        </div>

        <div ref={grid} className="reveal mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          <Card index="F/01" icon={<FilmStrip size={20} weight="fill" />} title={t('site.features.alpha.title')} body={t('site.features.alpha.body')} className="md:col-span-2 lg:col-span-7" testId="feature-alpha" style={i(0)}>
            <AlphaDemo />
          </Card>
          <Card index="F/02" icon={<ExportIcon size={20} weight="fill" />} title={t('site.features.formats.title')} body={t('site.features.formats.body')} className="lg:col-span-5" style={i(1)}>
            <FormatsDemo />
          </Card>
          <Card index="F/03" icon={<Stack size={20} weight="fill" />} title={t('site.features.stack.title')} body={t('site.features.stack.body')} className="lg:col-span-7" style={i(2)}>
            <StackDemo />
          </Card>
          <Card index="F/04" icon={<WifiSlash size={20} weight="fill" />} title={t('site.features.offline.title')} body={t('site.features.offline.body')} className="lg:col-span-5" style={i(3)}>
            <OfflineDemo />
          </Card>
        </div>
      </div>
    </section>
  );
}
