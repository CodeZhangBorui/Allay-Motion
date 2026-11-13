/// <reference types="vite/client" />
import type { AllayApi } from '../preload/api';

declare global {
  interface Window {
    readonly allay: AllayApi;
  }
}
