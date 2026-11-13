// T-DEV-2：update 抛错（读 null 的属性）。V8 把位置记在 .width 上：第 9 行第 29 列
export default {
  setup() {
    const state = { box: null };
    return {
      duration: 1,
      cutTime: 0.5,
      update(t) {
        const w = state.box.width * t;
        void w;
      },
    };
  },
};
