import { Button } from '@allay/ui/components/button';
import { ICON } from '@allay/ui/lib/icons';
import { WarningOctagon } from '@phosphor-icons/react';
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { usePreviewStore } from '../stores/previewStore';
import { useProjectStore } from '../stores/projectStore';
import { buildDiagnostics, copyText, errorInfo, uncaughtLine } from './diagnostics';

// 错误边界（docs/decisions.md “试用版的三个崩溃”）：渲染时抛错不再让整棵 React 树卸载成黑屏。
// - 最外层（scope="app"）：整窗的错误页，原因、“重新载入”、“复制诊断信息”。
// - 各面板（顶栏、左右面板、预览、时间轴、状态栏、对话框）：只换掉出错的那一块，多一个“重试”（重新挂载这一块）。
// 出错时把错误和组件栈经 console.error 写进日志（主进程收 error 级控制台消息，window.ts）。
// 事件处理和异步代码里的异常不经过错误边界，由 diagnostics.ts 的全局监听写日志。

/**
 * 只给自动化测试用（test-hooks.ts 的 crashPanel）：让某一块在下一次渲染时抛错，验证错误边界本身。
 * 没有测试钩子时没人往里放东西，CrashGate 什么都不做。
 */
export const useCrashRequests = create<{ scopes: readonly string[] }>(() => ({ scopes: [] }));

function CrashGate({ scope, children }: { scope: string; children: ReactNode }) {
  const crash = useCrashRequests((s) => s.scopes.includes(scope));
  if (crash) throw new Error(`test crash in ${scope}`);
  return children;
}

interface Props {
  /** 哪一块：写进日志和诊断信息，也是错误页上的 data-scope */
  scope: string;
  children: ReactNode;
  /** 整窗、一块面板，还是浮在界面上的一层（对话框） */
  variant?: 'app' | 'panel' | 'overlay';
  /** 浮层的“关闭”：关掉出错的对话框 */
  onClose?: () => void;
  /** 这个值变了就自动重试（例如换了模板） */
  resetKey?: unknown;
}

interface State {
  error: unknown;
  componentStack: string | null;
  failed: boolean;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null, failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null, componentStack: null, failed: false };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    const stack = (info.componentStack ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' ← ');
    console.error(`${uncaughtLine('render-error', this.props.scope, error)}${stack ? ` | components: ${stack}` : ''}`);
  }

  private readonly retry = () => this.setState({ error: null, componentStack: null, failed: false });

  override render(): ReactNode {
    if (!this.state.failed) return <CrashGate scope={this.props.scope}>{this.props.children}</CrashGate>;
    const onClose = this.props.onClose;
    return (
      <ErrorFallback
        scope={this.props.scope}
        variant={this.props.variant ?? 'panel'}
        error={this.state.error}
        componentStack={this.state.componentStack}
        onRetry={this.retry}
        {...(onClose ? { onClose: () => (this.retry(), onClose()) } : {})}
      />
    );
  }
}

/** 重新载入整个界面：经主进程（渲染进程自己的 location.reload 会被导航拦截挡住，1.6 不放宽） */
function reload(): void {
  window.allay.window.reload().catch((error: unknown) => console.error(uncaughtLine('unhandled-rejection', 'reload', error)));
}

/** 诊断信息里的现场：当前模板、预览状态（不含参数里的图片数据之外的东西；路径本来就不在渲染进程） */
function context(): Record<string, unknown> {
  const project = useProjectStore.getState();
  return { template: project.template?.ref ?? null, params: project.params, output: project.output, preview: usePreviewStore.getState().status };
}

export function ErrorFallback({
  scope,
  variant,
  error,
  componentStack,
  onRetry,
  onClose,
}: {
  scope: string;
  variant: 'app' | 'panel' | 'overlay';
  error: unknown;
  componentStack: string | null;
  onRetry: () => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<boolean | null>(null);
  const reason = errorInfo(error).message || errorInfo(error).name;
  const copy = () => {
    let text: string;
    try {
      text = buildDiagnostics({ scope, error, componentStack, context: context() });
    } catch {
      text = buildDiagnostics({ scope, error, componentStack });
    }
    setCopied(copyText(text));
  };
  const app = variant === 'app';
  return (
    <div
      role="alert"
      data-testid="error-boundary"
      data-scope={scope}
      className={
        app
          ? 'flex h-full min-h-screen w-full items-center justify-center bg-background p-6 text-foreground'
          : variant === 'overlay'
            ? 'fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 text-foreground'
            : 'flex h-full min-h-0 w-full items-center justify-center overflow-auto p-3 text-foreground'
      }
    >
      <div className={app ? 'flex w-full max-w-lg flex-col gap-3 rounded-xl bg-surface-1 p-6' : 'flex w-full max-w-sm flex-col gap-2 rounded-xl bg-surface-2 p-3'}>
        <div className="flex items-center gap-2">
          <WarningOctagon size={app ? ICON.md + 4 : ICON.md} className="shrink-0 text-danger" />
          <p className={app ? 'text-lg font-semibold' : 'text-sm font-semibold'}>{app ? t('errorBoundary.title') : t('errorBoundary.panelTitle')}</p>
        </div>
        <p className="text-xs text-fg-muted">{app ? t('errorBoundary.hint') : t('errorBoundary.panelHint')}</p>
        <p className="text-xs break-words">
          <span className="text-fg-subtle">{t('errorBoundary.reason')}</span>
          <span className="num" data-testid="error-boundary-reason">
            {reason}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {!app && (
            <Button variant="secondary" onClick={onRetry} data-testid="error-boundary-retry">
              {t('errorBoundary.retry')}
            </Button>
          )}
          <Button variant={app ? 'default' : 'ghost'} onClick={reload} data-testid="error-boundary-reload">
            {t('errorBoundary.reload')}
          </Button>
          <Button variant="ghost" onClick={copy} data-testid="error-boundary-copy">
            {t('errorBoundary.copy')}
          </Button>
          {onClose && (
            <Button variant="ghost" onClick={onClose} data-testid="error-boundary-close">
              {t('common.close')}
            </Button>
          )}
          {copied !== null && (
            <span className="text-xs text-fg-subtle" role="status" data-testid="error-boundary-copy-result">
              {copied ? t('errorBoundary.copied') : t('errorBoundary.copyFailed')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
