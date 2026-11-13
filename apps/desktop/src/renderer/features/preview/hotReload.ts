// 模板开发模式的热重载管线（docs/code-editing-and-mcp-plan.md H9；docs/08-milestones.md MD）：
// 主进程报告用户模板的文件夹被改了（templates.onChanged）→ 防抖 → 重新取代码和 manifest → 静态检查（语法预检、
// import、确定性规则）→ 在备用 Worker 里试载并试渲当前帧（受看门狗约束）→ 成功才切换、销毁旧 Worker；
// 失败就丢掉备用 Worker，旧 Worker 和上一帧都不动，诊断交给错误浮层。
// 播放位置不变；参数按键名和类型重新对上（对不上的回默认值）；manifest 变了属性面板跟着工程里的模板重建。
// 只处理当前模板。界面不反写模板代码。
import { diagnosticOf, type TemplateDiagnostic } from '@allay/template-sdk';
import i18next from 'i18next';
import { EngineCrashedError } from '../../engine-host/EngineHost';
import { forgetTemplateAssets } from '../../engine-host/resource-client';
import { analyzeTemplateCode } from '../../../shared/template-code';
import type { TemplateDevChange } from '../../../shared/templates';
import { sameRef, useDevStore, type TemplateRef } from '../../stores/devStore';
import { hotSwapTemplate, useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { readTemplate, type TemplateSource } from '../../templates/catalog';
import { remapParams } from '../templates/remapParams';
import { previewEngine } from './previewEngine';

/** 主进程已经按模板防抖了 150 ms；这里再合并一次，连着几次保存只重载最后一次 */
export const RELOAD_DEBOUNCE_MS = 100;

/** 错误或别的东西变成诊断；拿不到结构化诊断时给一条不带位置的 */
export function diagnosticFrom(error: unknown): TemplateDiagnostic {
  const d = diagnosticOf(error);
  if (d) return d;
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 2000);
  return { kind: 'load', severity: 'error', code: error instanceof EngineCrashedError ? 'engine-crashed' : 'load-failed', message };
}

export type ReloadResult = { ok: true; duration: number; cutTime: number | null; diagnostics: TemplateDiagnostic[] } | { ok: false; diagnostics: TemplateDiagnostic[] };

type Listener = (ref: TemplateRef, diagnostics: readonly TemplateDiagnostic[]) => void;

class HotReloader {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private started = false;
  private readonly listeners = new Set<Listener>();
  private readonly changeListeners = new Set<(change: TemplateDevChange) => void>();

  /** 启动时调用一次：订阅主进程的改动通知，跟着当前模板更新“在监视谁” */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.allay.templates.onChanged((change) => this.onChange(change));
    const sync = () => {
      const ref = this.watchable();
      const dev = useDevStore.getState();
      if (sameRef(ref, dev.watching) || (!ref && !dev.watching)) return;
      // 换了模板：上一个模板的诊断和重载记录不再相关
      useDevStore.setState({ watching: ref, diagnostics: [], last: null });
    };
    useProjectStore.subscribe((s, prev) => {
      if (s.template !== prev.template) sync();
    });
    useTemplateStore.subscribe((s, prev) => {
      if (s.entries !== prev.entries) sync();
    });
    sync();
  }

  /** 诊断推给订阅者（宿主接口的 engine.onDiagnostics）；返回取消订阅 */
  onDiagnostics(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** 文件夹的改动（宿主接口的 templates.onExternalChange） */
  onExternalChange(cb: (change: TemplateDevChange) => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  /** 当前模板是用户模板时返回它（只有用户模板的文件夹在监视之内） */
  private watchable(): TemplateRef | null {
    const ref = useProjectStore.getState().template?.ref;
    if (!ref) return null;
    const entry = useTemplateStore.getState().entries.find((e) => e.id === ref.id && e.version === ref.version);
    return entry?.source === 'user' ? { id: ref.id, version: ref.version } : null;
  }

  private onChange(change: TemplateDevChange): void {
    for (const cb of this.changeListeners) cb(change);
    // 模板库里的名字、说明可能变了；manifest 坏了的模板已经从列表里移除
    void useTemplateStore.getState().refresh();
    const current = useProjectStore.getState().template?.ref;
    if (!sameRef(current, change)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, RELOAD_DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.reloadCurrent();
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  /** 从磁盘重新取当前模板，走完整条管线 */
  private async reloadCurrent(): Promise<void> {
    const cur = useProjectStore.getState().template;
    if (!cur) return;
    const ref = { ...cur.ref };
    useDevStore.setState({ phase: 'reloading' });
    let source: TemplateSource | null;
    try {
      source = await readTemplate(ref.id, ref.version);
    } catch (error) {
      this.finish(ref, { ok: false, diagnostics: [diagnosticFrom(error)] });
      return;
    }
    if (!source) {
      // manifest.json 坏了、template.js 没了，或者整个文件夹被删了：主进程已经把它从列表里拿掉
      this.finish(ref, { ok: false, diagnostics: [{ kind: 'load', severity: 'error', code: 'template-unreadable', message: 'manifest.json is missing or invalid, or template.js is missing' }] });
      return;
    }
    forgetTemplateAssets(source.assets);
    this.finish(ref, await this.trial(source));
  }

  /**
   * 静态检查 + 备用 Worker 试载试渲，成功就切换。source 必须是当前模板（同一个 id 和版本）。
   * 宿主接口的 requestReload（不落盘的试载）也走这里。
   */
  async trial(source: TemplateSource): Promise<ReloadResult> {
    // 1. 静态检查：语法、import 抛 compile 诊断；确定性规则命中也不切换（硬性规则 2）
    let rules: TemplateDiagnostic[];
    try {
      rules = await analyzeTemplateCode(source.code);
    } catch (error) {
      return { ok: false, diagnostics: [diagnosticFrom(error)] };
    }
    if (rules.length > 0) return { ok: false, diagnostics: rules };

    // 2. 参数按键名和类型对上
    const locale = i18next.language;
    const before = useProjectStore.getState();
    if (!before.template || !sameRef(before.template.ref, source.ref)) return { ok: false, diagnostics: [] };
    const params = remapParams(before.template.params, source.params, before.params, locale);

    // 3. 备用 Worker 试载、试渲当前帧
    const trial = await previewEngine.trySwap(source, params);
    if (!trial.ok) return { ok: false, diagnostics: [diagnosticFrom(trial.error)] };

    // 试载期间换了模板：放弃
    const now = useProjectStore.getState();
    if (!now.template || !sameRef(now.template.ref, source.ref)) {
      trial.discard();
      return { ok: false, diagnostics: [] };
    }
    const old = now.template;
    trial.commit(() => {
      // 用提交那一刻的参数重新对上（试载期间用户可能又改了参数）
      const latest = useProjectStore.getState();
      const next = remapParams(old.params, source.params, latest.params, locale);
      hotSwapTemplate(source, next, (prevTemplate, values) => remapParams(prevTemplate.params, source.params, values, locale));
    });
    return { ok: true, duration: trial.result.duration, cutTime: trial.result.cutTime, diagnostics: trial.result.diagnostics ?? [] };
  }

  /** 不落盘的试载（宿主接口的 engine.requestReload）：代码来自调用方，其余同文件改动 */
  async reloadWithSource(source: TemplateSource): Promise<ReloadResult> {
    useDevStore.setState({ phase: 'reloading' });
    const result = await this.trial(source);
    this.finish(source.ref, result);
    return result;
  }

  private finish(ref: TemplateRef, result: ReloadResult): void {
    // 被放弃的（中途换了模板）不算一次重载
    if (!result.ok && result.diagnostics.length === 0) {
      useDevStore.setState({ phase: 'idle' });
      return;
    }
    const diagnostics = result.ok ? [] : result.diagnostics;
    useDevStore.setState((s) => ({ phase: 'idle', last: { at: Date.now(), ok: result.ok }, diagnostics, reloads: s.reloads + 1 }));
    for (const cb of this.listeners) cb(ref, diagnostics);
  }
}

export const hotReloader = new HotReloader();
