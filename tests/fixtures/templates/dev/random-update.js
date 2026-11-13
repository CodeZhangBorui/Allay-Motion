// T-DEV-2：不确定的代码。静态规则指向表达式开头（第 8 行第 24 列），运行时的调用栈指向被调用的 random（第 8 行第 29 列）
// 字符串和注释里的 Math.random() 不算：'Math.random()'
export default {
  setup() {
    return {
      duration: 1,
      update(t) {
        const jitter = Math.random() * 0 + t;
        void jitter;
      },
    };
  },
};
