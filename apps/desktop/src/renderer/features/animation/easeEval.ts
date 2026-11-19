// 界面里求缓动（画曲线、算当前值、显示属性值）：用编辑器控件的同一套缓动数学（packages/ui 的 easing.ts，不改它）。
// Worker 里的求值走引擎的 ctx.ease，两边的名字和公式一致（template-sdk 的 EASING_NAMES）。
import { easingFn } from '@allay/ui/editor';
import type { EaseEval } from '../../../shared/animation/edit';

export const easeEval: EaseEval = (ease) => (ease === undefined || ease === 'hold' ? (x: number) => x : easingFn(ease));
