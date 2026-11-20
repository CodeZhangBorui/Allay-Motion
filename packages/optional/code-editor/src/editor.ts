// 一个 CodeMirror 6 编辑器（docs/code-editing-and-mcp-plan.md 2.2：选 CodeMirror 不选 Monaco）。
// 主题全部读主程序的 CSS 变量（深浅两套主题自动跟随），不引入字体和图标；语法高亮、行内诊断、补全、悬停、查找、撤销。
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, GutterMarker, gutterLineClass, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers, type DecorationSet, type Tooltip } from '@codemirror/view';
import type { CodeViewDiagnostic, CodeViewHandle, CodeViewMark, CodeViewOptions } from '@allay/host-api';
import { tags } from '@lezer/highlight';

/** 颜色只用主程序的变量：中性灰为主，强调色天蓝给关键字（docs/design-direction.md） */
const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--well)', color: 'var(--foreground)', fontSize: '12px' },
  '.cm-scroller': { fontFamily: 'var(--font-num)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--primary)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--well)', color: 'var(--fg-subtle)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--control) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-muted)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--primary)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--primary-soft) !important' },
  '.cm-matchingBracket': { backgroundColor: 'var(--control-hi)', outline: 'none' },
  '.cm-selectionMatch': { backgroundColor: 'var(--control)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', border: 'none', borderRadius: '7px', boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--control-hi)', color: 'var(--foreground)' },
  '.cm-completionDetail': { color: 'var(--fg-subtle)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-diagnostic': { padding: '4px 8px', borderLeft: 'none' },
  '.cm-diagnostic-error': { borderLeft: 'none', color: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeft: 'none', color: 'var(--warning)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)', textUnderlineOffset: '3px' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--foreground)', border: 'none' },
  '.cm-searchMatch': { backgroundColor: 'var(--primary-soft)' },
  '.cm-hover-doc': { maxWidth: '420px', padding: '6px 9px', fontSize: '11.5px', lineHeight: '1.45' },
  '.cm-hover-doc code': { fontFamily: 'var(--font-num)', color: 'var(--primary-text)', whiteSpace: 'pre-wrap' },
  '.cm-hover-doc p': { margin: '4px 0 0', color: 'var(--fg-muted)' },
  // 实时预览（2026-11 第二轮）：这一刻在生效的代码。区间是强调色 20% 的底，图层开头一行是更淡的底，行号旁一条强调色
  '.cm-live-segment': { backgroundColor: 'var(--primary-soft)' },
  '.cm-live-hold': { backgroundColor: 'color-mix(in srgb, var(--mark) 18%, transparent)' },
  '.cm-live-edge': { backgroundColor: 'color-mix(in srgb, var(--primary-soft) 55%, transparent)' },
  '.cm-live-layer': { backgroundColor: 'color-mix(in srgb, var(--control) 70%, transparent)' },
  // 绑定到参数的值和参数的定义：标记色（琥珀，界面里“改过的参数”也是它）
  '.cm-live-param': { backgroundColor: 'color-mix(in srgb, var(--mark) 16%, transparent)' },
  '.cm-gutterElement.cm-live-gutter': { color: 'var(--primary-text)', boxShadow: 'inset -2px 0 0 var(--primary)' },
});

// ---- 实时预览的标记 ----

const setMarksEffect = StateEffect.define<readonly CodeViewMark[]>();
const liveGutter = new (class extends GutterMarker {
  override elementClass = 'cm-live-gutter';
})();

function buildMarks(state: EditorState, marks: readonly CodeViewMark[]): { lines: DecorationSet; gutter: ReturnType<typeof RangeSetBuilder.prototype.finish> } {
  const perLine = new Map<number, string>();
  // 先放图层，再放区间：同一行有两种时区间优先
  const rank: Record<CodeViewMark['kind'], number> = { layer: 0, param: 1, edge: 2, hold: 3, segment: 4 };
  for (const m of [...marks].sort((a, b) => rank[a.kind] - rank[b.kind])) {
    for (let l = Math.max(1, m.line); l <= Math.min(state.doc.lines, m.endLine); l++) perLine.set(l, m.kind);
  }
  const lines = new RangeSetBuilder<Decoration>();
  const gutter = new RangeSetBuilder<GutterMarker>();
  for (const l of [...perLine.keys()].sort((a, b) => a - b)) {
    const from = state.doc.line(l).from;
    lines.add(from, from, Decoration.line({ class: `cm-live-${perLine.get(l)!}` }));
    gutter.add(from, from, liveGutter);
  }
  return { lines: lines.finish(), gutter: gutter.finish() };
}

const liveField = StateField.define<{ lines: DecorationSet; gutter: ReturnType<typeof RangeSetBuilder.prototype.finish>; marks: readonly CodeViewMark[] }>({
  create: () => ({ lines: Decoration.none, gutter: new RangeSetBuilder<GutterMarker>().finish(), marks: [] }),
  update(value, tr) {
    let marks = value.marks;
    for (const e of tr.effects) if (e.is(setMarksEffect)) marks = e.value;
    if (marks === value.marks && !tr.docChanged) return value;
    return { ...buildMarks(tr.state, marks), marks };
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.lines), gutterLineClass.from(f, (v) => v.gutter)],
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--primary-text)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--fg-subtle)', fontStyle: 'italic' },
  { tag: [tags.propertyName], color: 'var(--foreground)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--foreground)', fontWeight: '500' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--fg-muted)' },
  { tag: [tags.typeName, tags.className], color: 'var(--primary-text)' },
  { tag: [tags.punctuation, tags.bracket, tags.operator], color: 'var(--fg-subtle)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

export interface EditorExtras {
  completion?: CompletionSource;
  hover?(view: EditorView, pos: number): Tooltip | null;
}

/** 行列（从 1 开始）→ 文档里的位置；没有位置的放在第 1 行开头 */
function toCmDiagnostic(state: EditorState, d: CodeViewDiagnostic): Diagnostic {
  const lines = state.doc.lines;
  const line = state.doc.line(Math.min(lines, Math.max(1, d.line ?? 1)));
  const from = Math.min(line.to, line.from + Math.max(0, (d.column ?? 1) - 1));
  // 下划线画到这个词的末尾（至少一个字符）
  const rest = state.doc.sliceString(from, line.to);
  const word = /^[\w$.]+/.exec(rest)?.[0].length ?? 1;
  return { from, to: Math.min(line.to, from + Math.max(1, word)), severity: d.severity, message: d.message };
}

export interface Editor extends CodeViewHandle {
  view: EditorView;
}

export function createEditor(container: HTMLElement, options: CodeViewOptions, extras: EditorExtras = {}): Editor {
  const readOnly = new Compartment();
  let silent = false;
  const hostHistory = !!options.onUndo && !!options.onRedo;
  const save = () => {
    options.onSave?.(view.state.doc.toString());
    return true;
  };
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    lintGutter(),
    // 宿主管撤销时编辑器自己不记（代码窗口与主窗口共用一份历史）
    ...(hostHistory ? [] : [history()]),
    liveField,
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(highlight),
    theme,
    options.language === 'json' ? json() : javascript(),
    autocompletion(extras.completion ? { override: [extras.completion], icons: false } : { icons: false }),
    ...(extras.hover ? [hoverTooltip((view, pos) => extras.hover!(view, pos))] : []),
    readOnly.of([EditorState.readOnly.of(options.readOnly ?? false), EditorView.editable.of(!(options.readOnly ?? false))]),
    keymap.of([
      { key: 'Mod-s', run: save, preventDefault: true },
      ...(hostHistory
        ? [
            { key: 'Mod-z', run: () => (options.onUndo!(), true), preventDefault: true },
            { key: 'Mod-Shift-z', run: () => (options.onRedo!(), true), preventDefault: true },
            { key: 'Mod-y', run: () => (options.onRedo!(), true), preventDefault: true },
          ]
        : historyKeymap),
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    ...(options.onPick
      ? [
          EditorView.domEventHandlers({
            mouseup: (_e, view) => {
              const sel = view.state.selection.main;
              if (sel.empty) options.onPick!(sel.head);
              return false;
            },
          }),
        ]
      : []),
    EditorView.contentAttributes.of({ 'aria-label': options.label }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !silent) options.onChange?.(u.state.doc.toString());
    }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: options.value, extensions }), parent: container });
  return {
    view,
    setValue(value) {
      if (value === view.state.doc.toString()) return;
      silent = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      } finally {
        silent = false;
      }
    },
    setReadOnly(ro) {
      view.dispatch({ effects: readOnly.reconfigure([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]) });
    },
    setDiagnostics(list) {
      view.dispatch(setDiagnostics(view.state, list.map((d) => toCmDiagnostic(view.state, d))));
    },
    focus() {
      view.focus();
    },
    setMarks(marks, reveal) {
      const effects: StateEffect<unknown>[] = [setMarksEffect.of(marks)];
      // 滚到关键帧区间优先，其次是参数绑定、图层
      const first = marks.find((m) => m.kind === 'segment' || m.kind === 'hold' || m.kind === 'edge') ?? marks.find((m) => m.kind === 'param') ?? marks[0];
      if (reveal && first && first.line <= view.state.doc.lines) effects.push(EditorView.scrollIntoView(view.state.doc.line(first.line).from, { y: 'center' }));
      view.dispatch({ effects });
    },
    dispose() {
      view.destroy();
    },
  };
}
