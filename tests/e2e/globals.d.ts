import type { AllayApi } from '../../apps/desktop/src/preload/api';

declare global {
  interface Window {
    readonly allay: AllayApi;
  }
}
