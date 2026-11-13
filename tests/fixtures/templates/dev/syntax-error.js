// T-DEV-2：语法错误。第 6 行第 25 列多了一个右括号
export default {
  setup() {
    return {
      duration: 1,
      update(t) { void t); },
    };
  },
};
