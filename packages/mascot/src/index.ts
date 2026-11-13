// 悦灵（docs/07-allay-mascot.md）。M5a：模型、动作和烘焙的约定；M4：组件的最终接口和占位实现（含加载时序）。
export * from './atlas';
export { Allay, AllayHead, type AllayProps } from './Allay';
export { AllayLoader, useReducedMotion, type AllayLoaderProps } from './AllayLoader';
export { AllayProgress, type AllayProgressPhase, type AllayProgressProps } from './AllayProgress';
export { AllayEmpty, type AllayEmptyProps } from './AllayEmpty';
export { LoaderTimeline, LOADER_DELAY, LOADER_EXIT_MS, LOADER_EXIT_REDUCED_MS, LOADER_MIN_VISIBLE, type Clock, type LoaderPhase } from './timing';
export { enterPose, flightPose, flightSize, ENTER_MS, type FlightPose } from './flight';
