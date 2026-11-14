// 模板装载失败时，把校验错误（zod 的 issue 数组）整理成“哪个参数、什么问题”的短句给人看。
// 原始的 issue 数组不直接显示，留在预览状态里，经“复制诊断信息”带走（docs/decisions.md “试用版的三个崩溃”）。
// 纯函数：不碰 DOM、不碰 store，文字经传入的 t 取（两种语言都在 locale JSON 的 preview.issues 下）。
import { localize, type TemplateManifest } from '@allay/template-sdk';
import { z } from 'zod';

const IssueSchema = z.looseObject({
  path: z.array(z.union([z.string(), z.number()])).max(64),
  message: z.string().max(2000),
  code: z.string().max(64).optional(),
});
export type LoadIssue = z.infer<typeof IssueSchema>;

const IssuesSchema = z.array(IssueSchema).min(1).max(1000);

/** 跨 Worker 传回来的错误只剩 name、message：zod 的错误 message 是 issue 数组的 JSON */
export function loadIssuesOf(error: unknown): LoadIssue[] | null {
  if (typeof error !== 'object' || error === null) return null;
  const { name, message, issues } = error as { name?: unknown; message?: unknown; issues?: unknown };
  if (name !== 'ZodError' && name !== '$ZodError') return null;
  let raw: unknown = issues;
  if (raw === undefined && typeof message === 'string') {
    try {
      raw = JSON.parse(message);
    } catch {
      return null;
    }
  }
  const parsed = IssuesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

type T = (key: string, vars?: Record<string, unknown>) => string;

function problemOf(issue: LoadIssue, t: T): string {
  const group = /^unknown group "(.*)"$/.exec(issue.message);
  if (group) return t('preview.issues.unknownGroup', { group: group[1] });
  const visible = /^visibleWhen refers to unknown param "(.*)"$/.exec(issue.message);
  if (visible) return t('preview.issues.unknownParam', { key: visible[1] });
  if (/^duplicate param key/.test(issue.message)) return t('preview.issues.duplicateKey');
  if (/^default /.test(issue.message)) return t('preview.issues.badDefault');
  switch (issue.code) {
    case 'invalid_type':
      return t('preview.issues.wrongType');
    case 'too_big':
      return t('preview.issues.tooBig');
    case 'too_small':
      return t('preview.issues.tooSmall');
    case 'unrecognized_keys':
      return t('preview.issues.unknownField');
    default:
      return t('preview.issues.invalid');
  }
}

/**
 * 每条 issue 一句话：落在参数定义上的写“参数‘名称’的 字段：问题”，其他的写“字段：问题”。
 * 路径可能带着请求的外层（manifest.），参数名按界面语言取自交给引擎的那份 manifest。
 */
export function describeLoadIssues(issues: readonly LoadIssue[], manifest: TemplateManifest | null, t: T, locale: string): string[] {
  return issues.map((issue) => {
    const path = issue.path[0] === 'manifest' ? issue.path.slice(1) : issue.path;
    const problem = problemOf(issue, t);
    if (path[0] === 'params' && typeof path[1] === 'number') {
      const def = manifest?.params?.[path[1]];
      const label = def ? localize(def.label, locale) || def.key : `#${path[1] + 1}`;
      const field = path.slice(2).join('.');
      return field ? t('preview.issues.paramField', { label, field, problem }) : t('preview.issues.param', { label, problem });
    }
    const field = path.join('.');
    return field ? t('preview.issues.field', { field, problem }) : problem;
  });
}

/** 错误卡片上最多列几句；其余的合成一句“还有 N 处” */
export const MAX_SHOWN_ISSUES = 4;
