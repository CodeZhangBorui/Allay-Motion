// T-ARC-4：模板尝试访问 window、self.allay、fetch、indexedDB、动态 import()；结果经 ctx.warn 报告
export default {
  async setup(ctx) {
    const g = globalThis;
    const report = (name, value) => ctx.warn(`${name}=${value}`);
    report('window', typeof g.window);
    report('document', typeof g.document);
    report('allay', typeof g.allay);
    report('selfAllay', typeof (g.self && g.self.allay));
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'indexedDB', 'caches', 'importScripts', 'BroadcastChannel']) {
      report(name, typeof g[name]);
    }
    // 源码里不能写 import(...)（会在装载前被拒绝），所以经 Function 构造一次动态 import
    let dyn;
    try {
      const make = g['Func' + 'tion'];
      await make('return imp' + 'ort("data:text/javascript,export default 1")')();
      dyn = 'allowed';
    } catch (e) {
      dyn = 'blocked:' + (e && e.name);
    }
    report('dynamicImport', dyn);
    let ev;
    try {
      g['ev' + 'al']('1 + 1');
      ev = 'allowed';
    } catch (e) {
      ev = 'blocked:' + (e && e.name);
    }
    report('eval', ev);
    return { duration: 1, cutTime: null, update() {} };
  },
};
