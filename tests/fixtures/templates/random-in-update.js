// 2.4：开发构建里 update 期间调用 Math.random 会抛错
export default {
  setup() {
    return { duration: 1, cutTime: null, update() { Math.random(); } };
  },
};
