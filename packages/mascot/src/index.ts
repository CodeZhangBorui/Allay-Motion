// 悦灵（docs/07-allay-mascot.md）。M5a：模型、动作和烘焙的约定；M4：组件的接口与加载时序；M5b：读烘焙图集的实现、四段编排、全局协调。
import './mascot.css';

export * from './atlas';
export { Allay, type AllayProps } from './Allay';
export { AllayHead } from './AllayHead';
export { AllayLoader, type AllayLoaderProps } from './AllayLoader';
export { AllayProgress, type AllayProgressPhase, type AllayProgressProps } from './AllayProgress';
export { AllayEmpty, type AllayEmptyProps } from './AllayEmpty';
export { AllayDelivery, DELIVERY_MS, type AllayDeliveryProps } from './AllayDelivery';
export { useReducedMotion, isReducedMotion } from './reduced';
export { MASCOT_PRIORITY, MascotSlotHeld, MascotStage, mascotClaimCount, useMascotSlot, type MascotPriority } from './stage';
export { mascotFrameStats, resetMascotFrameStats, type MascotFrameStats } from './ticker';
export { AtlasJsonSchema, declareMascotAssetsMissing, mascotAssets, whenMascotAssetsSettled, pickSheetSize, pickHeadSize, type MascotAssets } from './assets';
export { LoaderTimeline, LOADER_DELAY, LOADER_EXIT_MS, LOADER_EXIT_REDUCED_MS, LOADER_MIN_VISIBLE, type Clock, type LoaderPhase } from './timing';
export { enterPose, flightPose, flightSize, ENTER_MS, type FlightPose } from './flight';
