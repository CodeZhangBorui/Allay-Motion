// Vite 的 ?raw 导入：以字符串拿到文件内容（主进程构建和 vitest 都支持）
declare module '*?raw' {
  const text: string;
  export default text;
}
