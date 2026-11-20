// 内置模板验收测试（T-TPL-3、4、5）的挑选：模板多了以后一次跑不完，按环境变量只跑其中一部分。
// 挑的是“跑哪些模板”，每个被挑中的模板该做的检查一项不少（docs/template-catalog.md 4.3）。
//
// - ALLAY_TPL_SHARD="i/n"：把全部模板按 id 排序后轮流分成 n 份，只跑第 i 份（i 从 1 起）。n 份合起来正好是全部、互不重叠。
// - ALLAY_TPL_ONLY="id,id"：只跑列出的模板，可以写完整 id（allay.builtin.block-wipe）或最后一段（block-wipe）。
//   pnpm templates:baselines <名字…> 用它只重新生成指定模板的基准图。
// 两个都设时先按 ONLY 挑、再分片。都不设时跑全部。

export interface TemplateSelection {
  shard?: string | undefined;
  only?: string | undefined;
}

export function selectionFromEnv(env: Record<string, string | undefined>): TemplateSelection {
  return { shard: env.ALLAY_TPL_SHARD, only: env.ALLAY_TPL_ONLY };
}

/** 解析 "i/n"；写错了直接报错，免得悄悄跑了全部或一个都没跑 */
export function parseShard(value: string): { index: number; total: number } {
  const m = /^(\d+)\/(\d+)$/.exec(value.trim());
  const index = m ? Number(m[1]) : NaN;
  const total = m ? Number(m[2]) : NaN;
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
    throw new Error(`ALLAY_TPL_SHARD must look like "2/4" (1 ≤ i ≤ n), got "${value}"`);
  }
  return { index, total };
}

/** 从全部模板 id 里挑出这一次要跑的；结果按 id 排序 */
export function selectTemplateIds(ids: readonly string[], selection: TemplateSelection): string[] {
  let out = [...ids].sort();
  const only = (selection.only ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (only.length > 0) {
    const unknown = only.filter((name) => !out.some((id) => id === name || id.endsWith(`.${name}`)));
    if (unknown.length > 0) throw new Error(`ALLAY_TPL_ONLY names unknown templates: ${unknown.join(', ')}`);
    out = out.filter((id) => only.some((name) => id === name || id.endsWith(`.${name}`)));
  }
  if (selection.shard !== undefined && selection.shard.trim() !== '') {
    const { index, total } = parseShard(selection.shard);
    out = out.filter((_, i) => i % total === index - 1);
  }
  return out;
}
