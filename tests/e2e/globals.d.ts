import type { AllayApi } from '../../apps/desktop/src/preload/api';
import type { AllayTestHooks } from '../../apps/desktop/src/renderer/test-hooks';

declare global {
  interface Window {
    readonly allay: AllayApi;
    /** 只在未打包且 ALLAY_E2E_HOOKS=1 时存在 */
    __allayTest?: AllayTestHooks;
  }
}
