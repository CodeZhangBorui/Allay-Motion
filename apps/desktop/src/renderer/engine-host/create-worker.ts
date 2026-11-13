// 新建引擎 Worker（module worker）。new URL(..., import.meta.url) 必须写成字面量，Vite 才会把 Worker 单独打包。
export function createEngineWorker(name: string): Worker {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name });
}
