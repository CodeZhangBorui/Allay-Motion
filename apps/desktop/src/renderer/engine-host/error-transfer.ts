// 让 Worker 抛出的错误带上结构化诊断（docs/code-editing-and-mcp-plan.md H5）。
// Comlink 默认只序列化错误的 name、message、stack；宿主一侧用 Object.assign 还原，所以这里只要
// 在 Worker 一侧把 diagnostic 多放一个字段，宿主就能在错误对象上拿到它。宿主用前再按 schema 校验（diagnosticOf）。
import { diagnosticOf } from '@allay/template-sdk';
import * as Comlink from 'comlink';

type Serialized = { isError: true; value: Record<string, unknown> } | { isError: false; value: unknown };

let installed = false;

/** 在 Worker 入口调用一次 */
export function installDiagnosticErrorTransfer(): void {
  if (installed) return;
  installed = true;
  const base = Comlink.transferHandlers.get('throw') as Comlink.TransferHandler<{ value: unknown }, Serialized> | undefined;
  if (!base) throw new Error('comlink throw handler is missing');
  Comlink.transferHandlers.set('throw', {
    canHandle: base.canHandle,
    serialize(thrown: { value: unknown }) {
      const [wire, transferables] = base.serialize(thrown);
      const diagnostic = diagnosticOf(thrown.value);
      if (diagnostic && wire.isError) wire.value = { ...wire.value, diagnostic };
      return [wire, transferables];
    },
    deserialize: base.deserialize,
  } satisfies Comlink.TransferHandler<{ value: unknown }, Serialized>);
}
