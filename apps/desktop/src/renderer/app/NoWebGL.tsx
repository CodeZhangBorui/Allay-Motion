import { Button } from '@allay/ui/components/button';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// 找不到 WebGL2 时的说明页（docs/01-product-architecture.md 1.10、docs/08-milestones.md M8）：
// 预览和导出都要 WebGL2（Three.js 的 WebGLRenderer），没有它就什么也做不了。不白屏，说清楚原因并附诊断信息。

/** 引擎在 Worker 里用 OffscreenCanvas 取 WebGL2；这里在主线程用同样的方式探测一次 */
export function hasWebGL2(): boolean {
  try {
    if (typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('webgl2')) return true;
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function webgl1Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl') !== null;
  } catch {
    return false;
  }
}

export function diagnosticsText(info: { version: string; platform: string }): string {
  return [
    `version: ${info.version}`,
    `platform: ${info.platform}`,
    `userAgent: ${navigator.userAgent}`,
    `webgl2: no`,
    `webgl1: ${webgl1Available() ? 'yes' : 'no'}`,
    `offscreenCanvas: ${typeof OffscreenCanvas !== 'undefined' ? 'yes' : 'no'}`,
    `hardwareConcurrency: ${navigator.hardwareConcurrency}`,
  ].join('\n');
}

export function NoWebGL({ info }: { info: { version: string; platform: string } }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = diagnosticsText(info);
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-8 text-foreground" data-testid="no-webgl">
      <div className="flex max-w-[560px] flex-col gap-4">
        <h1 className="text-lg font-semibold">{t('noWebgl.title')}</h1>
        <p className="text-sm text-fg-muted">{t('noWebgl.body')}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
          <li>{t('noWebgl.tips.driver')}</li>
          <li>{t('noWebgl.tips.gpu')}</li>
          <li>{t('noWebgl.tips.remote')}</li>
        </ul>
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-fg-subtle">{t('noWebgl.diagnostics')}</h2>
          <pre className="num max-h-48 overflow-auto rounded-sm border border-divider bg-surface-1 p-2 text-xs whitespace-pre-wrap select-text" data-testid="no-webgl-diagnostics">
            {text}
          </pre>
          <div>
            <Button
              size="sm"
              variant="secondary"
              data-testid="no-webgl-copy"
              onClick={() =>
                void window.allay.export
                  .copyDiagnostics(text)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? t('noWebgl.copied') : t('noWebgl.copy')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
