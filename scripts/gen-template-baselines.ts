// pnpm templates:baselines：重新生成 T-TPL-5 的基准图（tests/fixtures/baselines/<模板 id>/*.png）。
// 跑的是 test:engine 里同一个 T-TPL-5 测试，设 ALLAY_UPDATE_BASELINES=1 时写入而不是比较。
// 资源是测试脚本生成的纯色假资源栈，不含任何原版贴图。窗口不显示、不抢焦点。
// 基准图应当在真实显卡上生成（docs/04-templates.md 4.11）；生成后用 git diff 看一眼再提交。
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, ALLAY_UPDATE_BASELINES: '1' };
execSync('vite build --configLoader runner --config tests/engine/vite.config.ts', { cwd: root, stdio: 'inherit', env });
execSync('playwright test --config playwright.engine.config.ts tests/engine/templates.spec.ts -g T-TPL-5', { cwd: root, stdio: 'inherit', env });
