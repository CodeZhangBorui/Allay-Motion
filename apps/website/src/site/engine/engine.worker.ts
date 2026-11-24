// 官网独立的引擎 Worker 入口（只运行在 Dedicated Worker 里，模板沙箱和桌面版同标准）。
// 启动后立即删掉联网与存储全局，再经 Comlink 暴露 @allay/engine 的 Engine。
import { Engine, removeNetworkGlobals, type EngineApi } from '@allay/engine';
import * as Comlink from 'comlink';

removeNetworkGlobals(self);

const engine = new Engine();

const api: EngineApi = {
  init: (opts, host) => engine.init(opts, host),
  load: (req) => engine.load(req),
  setParams: (params) => engine.setParams(params),
  resize: (w, h) => engine.resize(w, h),
  render: (t, quality) => engine.render(t, quality),
  renderFrame: async (index, quality, opaque) => {
    const buf = await engine.renderFrame(index, quality, opaque);
    return Comlink.transfer(buf, [buf]);
  },
  renderThumbnail: async (req) => {
    const bitmap = await engine.renderThumbnail(req);
    return Comlink.transfer(bitmap, [bitmap]);
  },
  readPreview: async (t) => {
    const buf = await engine.readPreview(t);
    return Comlink.transfer(buf, [buf]);
  },
  checkDeterminism: (probe, others, quality) => engine.checkDeterminism(probe, others, quality),
  dispose: () => engine.dispose(),
};

Comlink.expose(api);
