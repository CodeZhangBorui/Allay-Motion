// 封面的调度（纯逻辑，docs/decisions.md“模板库撑到一百个模板”）：哪些该生成、先做哪个、哪些已经不要了。
// 一件活是“某个模板的封面”或“某个模板的悬停预览（帧网格）”。四条道，靠前的先做：
//   hover      指针（或键盘焦点）在一张卡片上停够了，要它的悬停预览；同一时刻只有一个
//   visible    可见范围里的卡片的封面，按界面上从上到下的先后
//   near       可见范围上下各一屏之内的封面（快滚到了，先备好）
//   background 不看位置、全部都要的（官网模板一节的 ensure：封面和悬停预览都要），按请求的先后
// 界面每次报来“现在哪些在可见范围附近”就整批替换：不在新一批里的 visible / near 请求撤掉，还没开始的不会再被选中；
// 正在做的由执行的一方用 wanted() 决定停不停（见 covers.ts）。已经有了的（缓存里有、刚做完）由 needed 回调跳过。

export type CoverLane = 'hover' | 'visible' | 'near' | 'background';
export type CoverJobKind = 'cover' | 'sheet';

export const LANE_RANK: Readonly<Record<CoverLane, number>> = { hover: 0, visible: 1, near: 2, background: 3 };

export interface CoverJob {
  kind: CoverJobKind;
  /** 模板的键（id@version） */
  key: string;
  lane: CoverLane;
}

export class CoverPlan {
  /** 模板库可见范围附近的封面，按界面上的先后 */
  private view: { key: string; lane: 'visible' | 'near' }[] = [];
  private viewKeys = new Set<string>();
  /** 悬停预览（最多一个） */
  private hovered: string | null = null;
  /** 官网的 ensure：封面和悬停预览都要。不撤（资源栈变了要重画，和原来一样） */
  private background: string[] = [];
  private backgroundKeys = new Set<string>();

  /** 整批替换可见范围的请求：items 按界面上的先后 */
  setView(items: readonly { key: string; lane: 'visible' | 'near' }[]): void {
    this.view = items.map((it) => ({ key: it.key, lane: it.lane }));
    this.viewKeys = new Set(items.map((it) => it.key));
  }

  setHover(key: string | null): void {
    this.hovered = key;
  }

  get hover(): string | null {
    return this.hovered;
  }

  addBackground(keys: readonly string[]): void {
    for (const k of keys) {
      if (this.backgroundKeys.has(k)) continue;
      this.backgroundKeys.add(k);
      this.background.push(k);
    }
  }

  /** 这件活还有没有人要（执行中途据此决定停不停） */
  wanted(kind: CoverJobKind, key: string): boolean {
    if (kind === 'sheet') return this.hovered === key || this.backgroundKeys.has(key);
    return this.viewKeys.has(key) || this.backgroundKeys.has(key) || this.hovered === key;
  }

  /** 现在所有的请求，按先后排好；needed(job) 为假的（已经有了、正在做、做不成）跳过 */
  queue(needed: (job: CoverJob) => boolean = () => true): CoverJob[] {
    const out: CoverJob[] = [];
    const seen = new Set<string>();
    const push = (job: CoverJob) => {
      const id = `${job.kind}:${job.key}`;
      if (seen.has(id)) return;
      seen.add(id);
      if (needed(job)) out.push(job);
    };
    if (this.hovered) push({ kind: 'sheet', key: this.hovered, lane: 'hover' });
    for (const lane of ['visible', 'near'] as const) for (const v of this.view) if (v.lane === lane) push({ kind: 'cover', key: v.key, lane });
    for (const key of this.background) {
      push({ kind: 'cover', key, lane: 'background' });
      push({ kind: 'sheet', key, lane: 'background' });
    }
    return out;
  }

  /** 下一件要做的；没有时为 null */
  next(needed: (job: CoverJob) => boolean = () => true): CoverJob | null {
    return this.queue(needed)[0] ?? null;
  }
}
