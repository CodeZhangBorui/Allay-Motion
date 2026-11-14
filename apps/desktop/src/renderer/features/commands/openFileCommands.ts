// 文件关联与第二实例参数（docs/08-milestones.md M8，docs/decisions.md M8）：主进程拿到双击的 .allay / .allaytpl 后，
// 经命令通道（H11）请界面执行这两个命令。参数只有主进程签发的一次性令牌，界面拿它向主进程换回打开的结果，
// 路径始终留在主进程（1.6 第 6 条）。命令面板里不列出：令牌只有主进程有，从别处调用只会得到“已失效”。
import i18next from 'i18next';
import { z } from 'zod';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { openAssociatedProject } from '../project/actions';
import { installAssociatedTemplate } from '../templates/actions';

const TokenInput = z.strictObject({ token: z.uuid() });

export const OPEN_FILE_COMMANDS: AnyCommand[] = [
  defineCommand({
    id: 'project.openAssociated',
    titleKey: 'command.items.projectOpenAssociated',
    effect: 'destructive',
    hideInPalette: true,
    input: TokenInput,
    output: z.strictObject({ opened: z.boolean() }),
    run: async ({ token }) => ({ opened: await openAssociatedProject(token) }),
  }),
  defineCommand({
    id: 'templates.installAssociated',
    titleKey: 'command.items.templatesInstallAssociated',
    effect: 'write',
    hideInPalette: true,
    input: TokenInput,
    output: z.strictObject({ installed: z.boolean() }),
    run: async ({ token }) => {
      const outcome = await installAssociatedTemplate(i18next.t.bind(i18next), token, i18next.language);
      return { installed: outcome.kind === 'installed' };
    },
  }),
];
