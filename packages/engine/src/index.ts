// 渲染引擎（docs/02-engine.md）。Worker 入口在渲染进程的 engine-host 里，用 Comlink 暴露 Engine。
export { Engine, TemplateError, type EngineApi, type HostCallbacks, type InitOptions } from './engine';
export { FACE_SHADE } from './blocks';
export { buildItemGeometry } from './items';
export { createGlyphSource, italicShift, rasterizeText, resolveStyle, stackGlyphSource, SUB, tableGlyphSource } from './text';
export { FontRegistry, fontFamiliesIn } from './fonts';
export { placeholderPixels } from './resources';
export { frameCount, frameTime, lastFrameIndex, subframeTimes } from './frames';
export { DeterminismGuard, DeterminismViolation, REMOVED_GLOBALS, removeNetworkGlobals } from './harden';
export { describeThrown, diagnosticFromError, locateInStack, type SourceLocation } from './diagnostics';
export { computeStage, STAGE_SHORT_SIDE } from './stage';
export { createRng, cyrb128, sfc32 } from './random';
export { createNoise2D } from './noise';
export { bezier, ease, EASINGS, math, segment } from './ease';
