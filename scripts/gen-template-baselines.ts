// pnpm templates:baselines：重新生成 T-TPL-5 的基准图（tests/fixtures/baselines/<模板 id>/*.png）。
// 跑的是 test:engine 里同一个 T-TPL-5 测试，设 ALLAY_UPDATE_BASELINES=1 时写入而不是比较。
// 资源是测试脚本生成的纯色假资源栈，不含任何原版贴图。窗口不显示、不抢焦点。
// 基准图应当在真实显卡上生成（docs/04-templates.md 4.11）；生成后用 git diff 看一眼再提交。
//
// 只重新生成某几个模板：pnpm templates:baselines block-wipe pixel-dissolve（写目录名或完整 id）。
// 不带参数时重新生成全部。做新模板时带上自己的名字，别动别人的基准图（docs/template-catalog.md 4.3）。
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const name of only) {
  if (!/^[a-z0-9.-]+$/.test(name)) throw new Error(`not a template name: ${name}`);
}
const env: NodeJS.ProcessEnv = { ...process.env, ALLAY_UPDATE_BASELINES: '1' };
if (only.length > 0) env.ALLAY_TPL_ONLY = only.join(',');
execSync('vite build --configLoader runner --config tests/engine/vite.config.ts', { cwd: root, stdio: 'inherit', env });
execSync('playwright test --config playwright.engine.config.ts tests/engine/templates.spec.ts -g T-TPL-5', { cwd: root, stdio: 'inherit', env });
