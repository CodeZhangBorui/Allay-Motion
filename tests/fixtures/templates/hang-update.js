// T-ARC-5：update 里死循环
export default {
  setup() {
    return {
      duration: 1,
      cutTime: 0.5,
      update() {
        for (;;) {
          // 永不返回
        }
      },
    };
  },
};
