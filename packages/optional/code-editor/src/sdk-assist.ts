// ctx 的补全与悬停（docs/code-editing-and-mcp-plan.md 2.2：不跑 TypeScript 语言服务，用 H8 生成的接口说明 template-api.json）。
// 只认 `ctx.` 开头的成员链（ctx.resources.block、ctx.ease.cubicOut …），以及字符串里的方块 ID；其余交给 CodeMirror 的默认行为。
import type { CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import type { EditorView, Tooltip } from '@codemirror/view';
import type { SdkApiDoc, SdkApiMember } from '@allay/host-api';

/** 沿成员链找到一个成员；找不到时为 null。ctx.ease 的缓动名不在说明里，单独处理 */
export function resolveChain(api: SdkApiDoc, chain: readonly string[]): SdkApiMember | null {
  let members: readonly SdkApiMember[] = api.ctx;
  let found: SdkApiMember | null = null;
  for (const name of chain) {
    found = members.find((m) => m.name === name) ?? null;
    if (!found) return null;
    members = found.members ?? [];
  }
  return found;
}

/** 某条成员链下面可补全的成员（链为空时是 ctx 本身） */
export function membersOf(api: SdkApiDoc, chain: readonly string[]): { label: string; detail: string; doc: string; kind: 'property' | 'method' }[] {
  if (chain.length === 1 && chain[0] === 'ease') {
    return [
      ...api.easings.map((e) => ({ label: e, detail: 'EaseFn', doc: '', kind: 'property' as const })),
      { label: 'bezier', detail: '(x1, y1, x2, y2) => EaseFn', doc: '', kind: 'method' as const },
      { label: 'from', detail: '(value) => EaseFn', doc: '', kind: 'method' as const },
    ];
  }
  const parent = chain.length === 0 ? null : resolveChain(api, chain);
  const list = chain.length === 0 ? api.ctx : (parent?.members ?? []);
  return list.map((m) => ({ label: m.name, detail: m.signature.replace(/^\w+\??:?\s*/, '').slice(0, 80), doc: m.doc, kind: m.kind }));
}

const CHAIN_RE = /\bctx((?:\.\w+)*)\.(\w*)$/;

export function sdkCompletion(api: SdkApiDoc, blockIds: () => readonly string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    // 字符串里的方块 ID：'minecraft:sto…'
    const id = /['"`]((?:minecraft)?:?[\w/]*)$/.exec(before);
    if (id && /^m|^:/.test(id[1]!) && id[1]!.length >= 2) {
      return { from: context.pos - id[1]!.length, options: blockIds().map((b) => ({ label: b, type: 'constant' })), validFor: /^[\w:/]*$/ };
    }
    const m = CHAIN_RE.exec(before);
    if (!m) return null;
    const chain = m[1] ? m[1].slice(1).split('.') : [];
    const options = membersOf(api, chain).map((o) => ({ label: o.label, detail: o.detail, info: o.doc || undefined, type: o.kind === 'method' ? 'method' : 'property' }));
    if (options.length === 0) return null;
    return { from: context.pos - m[2]!.length, options, validFor: /^\w*$/ };
  };
}

/** 悬停在 ctx.xxx.yyy 的某一段上：显示签名和说明 */
export function sdkHover(api: SdkApiDoc): (view: EditorView, pos: number) => Tooltip | null {
  return (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const at = pos - line.from;
    let start = at;
    let end = at;
    while (start > 0 && /[\w.]/.test(text[start - 1]!)) start--;
    while (end < text.length && /\w/.test(text[end]!)) end++;
    const expr = text.slice(start, end);
    const m = /^ctx((?:\.\w+)+)$/.exec(expr);
    if (!m) return null;
    const chain = m[1]!.slice(1).split('.');
    const member = resolveChain(api, chain);
    if (!member) return null;
    return {
      pos: line.from + start,
      end: line.from + end,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-hover-doc';
        const sig = document.createElement('code');
        sig.textContent = member.signature;
        dom.append(sig);
        if (member.doc) {
          const p = document.createElement('p');
          p.textContent = member.doc;
          dom.append(p);
        }
        return { dom };
      },
    };
  };
}
