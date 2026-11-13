// 带修订号的工程读写命令（docs/code-editing-and-mcp-plan.md H3）：读到的修订号可以在写的时候带回来，
// 期间工程被别处改过就拒绝（RevisionConflictError），不覆盖别人的改动。命令面板里不列出（没有界面上的意义），
// 给主进程的命令通道、可选模块和测试用。
import i18next from 'i18next';
import { z } from 'zod';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { ifRevision, useProjectStore } from '../../stores/projectStore';

const JsonRecord = z.record(z.string().min(1).max(64), z.json());

export const ProjectSnapshotSchema = z.strictObject({
  revision: z.int().min(0),
  template: z.strictObject({ id: z.string(), version: z.string() }).nullable(),
  params: JsonRecord,
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export function projectSnapshot(): ProjectSnapshot {
  const s = useProjectStore.getState();
  return { revision: s.revision, template: s.template ? { ...s.template.ref } : null, params: JSON.parse(JSON.stringify(s.params)) as Record<string, z.infer<ReturnType<typeof z.json>>> };
}

const SetParamsInput = z.strictObject({
  params: JsonRecord,
  /** 读到的修订号；给了且不是当前的就拒绝 */
  baseRevision: z.int().min(0).optional(),
});

export const PROJECT_COMMANDS: AnyCommand[] = [
  defineCommand({
    id: 'project.get',
    titleKey: 'command.items.projectGet',
    effect: 'read',
    hideInPalette: true,
    output: ProjectSnapshotSchema,
    run: projectSnapshot,
  }),
  defineCommand({
    id: 'project.setParams',
    titleKey: 'command.items.projectSetParams',
    effect: 'write',
    undoLabelKey: 'history.params',
    hideInPalette: true,
    input: SetParamsInput,
    output: ProjectSnapshotSchema,
    enabled: () => useProjectStore.getState().template !== null,
    run: (input) =>
      ifRevision(input.baseRevision, () => {
        useProjectStore.getState().setParams(input.params, i18next.language);
        return projectSnapshot();
      }),
  }),
];
