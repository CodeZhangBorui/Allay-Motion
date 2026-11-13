import { createContext, useContext, useId, useLayoutEffect, useSyncExternalStore } from 'react';

// “同一时刻全身形象最多一只”（docs/07-allay-mascot.md 7.2、T-ALY-3）。
// 每个想画全身悦灵的地方先申请一个位置；全应用只批准一个：优先级最高的，同级里先来的。
// 没批准的不画悦灵（只留同样大小的空位，布局不跳）；批准的那个卸载或不再需要时，下一个自动顶上。
// 申请和撤回都在 layout effect 里做，外部存储变化时 React 同步重渲染，所以同一次提交里一只消失、另一只出现，DOM 里不会有两只。

/** 出场位置的优先级：越大越优先。拖放和模态对话框盖过背景里的加载编排 */
export const MASCOT_PRIORITY = {
  drop: 100,
  export: 90,
  dialog: 80,
  picker: 60,
  preview: 50,
  gallery: 40,
  error: 30,
  empty: 20,
  default: 10,
} as const;

export type MascotPriority = keyof typeof MASCOT_PRIORITY;

interface Claim {
  priority: number;
  order: number;
}

/** 申请与批准的纯逻辑（单元测试直接用它） */
export class MascotStage {
  private readonly claims = new Map<string, Claim>();
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  winner: string | null = null;

  claim(id: string, priority: MascotPriority): void {
    this.claims.set(id, { priority: MASCOT_PRIORITY[priority], order: this.counter++ });
    this.recompute();
  }

  release(id: string): void {
    if (this.claims.delete(id)) this.recompute();
  }

  get size(): number {
    return this.claims.size;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getWinner = (): string | null => this.winner;

  private recompute(): void {
    let best: string | null = null;
    let bestClaim: Claim | null = null;
    for (const [id, c] of this.claims) {
      if (!bestClaim || c.priority > bestClaim.priority || (c.priority === bestClaim.priority && c.order < bestClaim.order)) {
        best = id;
        bestClaim = c;
      }
    }
    if (best !== this.winner) {
      this.winner = best;
      for (const l of this.listeners) l();
    }
  }
}

const stage = new MascotStage();

/**
 * 外层已经拿到位置时（飞舞区域、导出进度、拖放），里面的 <Allay> 不再另外申请：
 * 外层用 <MascotSlotHeld.Provider value={true}> 包住它。
 */
export const MascotSlotHeld = createContext(false);

/** 申请一个全身悦灵的位置。active 为假时不申请。返回是否批准 */
export function useMascotSlot(priority: MascotPriority, active = true): boolean {
  const id = useId();
  const held = useContext(MascotSlotHeld);
  const current = useSyncExternalStore(stage.subscribe, stage.getWinner, stage.getWinner);
  const claiming = active && !held;
  useLayoutEffect(() => {
    if (!claiming) return;
    stage.claim(id, priority);
    return () => stage.release(id);
  }, [id, priority, claiming]);
  return held ? active : claiming && current === id;
}

/** 测试用：当前有多少个申请 */
export function mascotClaimCount(): number {
  return stage.size;
}
