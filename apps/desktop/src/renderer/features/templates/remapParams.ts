// 模板的参数定义变了（热重载时 manifest 被改，H9）：旧的取值按键名和类型重新对上。
// 键名相同且类型相同的保留（再经 template-sdk 的校验清洗：越界的钳制、不在选项里的回默认值）；
// 键名没了的丢掉；新加的、类型变了的取默认值。
import { sanitizeParams, type ParamDef, type ParamValues } from '@allay/template-sdk';

export function remapParams(oldDefs: readonly ParamDef[], newDefs: readonly ParamDef[], values: Readonly<Record<string, unknown>>, locale: string): ParamValues {
  const oldByKey = new Map(oldDefs.map((d) => [d.key, d] as const));
  const kept: Record<string, unknown> = {};
  for (const def of newDefs) {
    const old = oldByKey.get(def.key);
    if (!old || old.type !== def.type || !Object.hasOwn(values, def.key)) continue;
    kept[def.key] = values[def.key];
  }
  return sanitizeParams(newDefs, kept, { locale });
}
