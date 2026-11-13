import { randomUUID } from 'node:crypto';

// 1.6 第 6 条：渲染进程拿到的只是不透明的引用，路径留在主进程。
// 引用只来自主进程自己弹出的对话框（以后还有拖放），渲染进程无法凭空造出一个有效引用。

export class FileGrants {
  private readonly grants = new Map<string, string>();

  grant(path: string): string {
    const ref = randomUUID();
    this.grants.set(ref, path);
    return ref;
  }

  resolve(ref: string): string | null {
    return this.grants.get(ref) ?? null;
  }
}
