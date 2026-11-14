import type { ReactNode } from 'react';

/**
 * 一节的骨架：锚点、底色、版心。data-scene / data-scene-label 给整幅过场（motion/SceneWall）用：
 * 它按这些节的上沿算分界线，墙铺满时浮出下一节的名字。
 */
export function Section({ id, tone = 'base', label, children, className }: { id?: string; tone?: 'base' | 'alt'; label?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} data-tone={tone} data-scene={tone} data-scene-label={label} className={`site-section ${tone === 'alt' ? 'bg-site-alt' : 'bg-site'} ${className ?? ''}`}>
      <div className="site-container">{children}</div>
    </section>
  );
}

/** 节标题：小标签、大标题、引言。出场由分节过场（方块墙散开）负责，这里不再另做动画 */
export function SectionHead({ kicker, title, lead, align = 'left' }: { kicker: string; title: string; lead?: string; tone?: 'base' | 'alt'; align?: 'left' | 'center' }) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-[760px] text-center' : 'max-w-[760px]'}>
      <p className="site-kicker">{kicker}</p>
      <h2 className="site-h2 mt-3">{title}</h2>
      {lead && <p className="site-lead mt-4">{lead}</p>}
    </div>
  );
}
