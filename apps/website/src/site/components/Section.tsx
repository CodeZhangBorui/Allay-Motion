import type { ReactNode } from 'react';
import { PixelReveal } from '../motion/PixelReveal';

/** 一节的骨架：锚点、底色、版心 */
export function Section({ id, tone = 'base', children, className }: { id?: string; tone?: 'base' | 'alt'; children: ReactNode; className?: string }) {
  return (
    <section id={id} data-tone={tone} className={`site-section ${tone === 'alt' ? 'bg-site-alt' : 'bg-site'} ${className ?? ''}`}>
      <div className="site-container">{children}</div>
    </section>
  );
}

/** 节标题：小标签、大标题、引言。出现时像素溶解 */
export function SectionHead({ kicker, title, lead, tone = 'base', align = 'left' }: { kicker: string; title: string; lead?: string; tone?: 'base' | 'alt'; align?: 'left' | 'center' }) {
  return (
    <PixelReveal bg={tone === 'alt' ? '--site-alt' : '--site-bg'} className={align === 'center' ? 'mx-auto max-w-[760px] text-center' : 'max-w-[760px]'}>
      <p className="site-kicker">{kicker}</p>
      <h2 className="site-h2 mt-3">{title}</h2>
      {lead && <p className="site-lead mt-4">{lead}</p>}
    </PixelReveal>
  );
}
