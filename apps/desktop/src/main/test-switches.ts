// 只给自动化测试用的开关。打包后的应用一律忽略，正式运行的行为（包括全部安全设置）不受影响。

export interface TestSwitches {
  /** 测试用的独立数据目录 */
  userDataDir: string | null;
  /** 窗口不显示、不进任务栏、不抢焦点（docs/decisions.md“测试在后台运行”） */
  hiddenWindow: boolean;
}

export function readTestSwitches(isPackaged: boolean, env: Readonly<Record<string, string | undefined>>): TestSwitches {
  if (isPackaged) return { userDataDir: null, hiddenWindow: false };
  return {
    userDataDir: env.ALLAY_USER_DATA_DIR ? env.ALLAY_USER_DATA_DIR : null,
    hiddenWindow: env.ALLAY_E2E_HIDDEN === '1',
  };
}
