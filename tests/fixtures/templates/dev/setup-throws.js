// T-DEV-2：setup 抛错。V8 把位置记在 new Error 上：第 5 行第 11 列
export default {
  setup(ctx) {
    void ctx;
    throw new Error('setup exploded');
  },
};
