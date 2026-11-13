// 只给自动化测试用的开关。打包后的应用一律忽略，正式运行的行为（包括全部安全设置）不受影响。

export interface TestSwitches {
  /** 测试用的独立数据目录 */
  userDataDir: string | null;
  /** 窗口不显示、不进任务栏、不抢焦点（docs/decisions.md“测试在后台运行”） */
  hiddenWindow: boolean;
  /** 渲染进程装上测试钩子（装载测试模板等，docs/decisions.md M1） */
  testHooks: boolean;
  /** 导出不弹保存对话框，直接写到这个目录 */
  exportTarget: string | null;
  /** 开发时指定 FFmpeg 可执行文件（05-export.md 5.6 的 ALLAY_FFMPEG） */
  ffmpeg: string | null;
  /** H.264 探测的候选列表（逗号分隔的编码器名），代替 5.3 的表；测试“全部失败时禁用预设”用 */
  h264Candidates: string[] | null;
  /** 探测本机游戏时用这个目录代替 %APPDATA%（测试不能碰到这台机器上真装的游戏） */
  gameAppData: string | null;
  /** 原版下载改连本机的假服务器（http://127.0.0.1:端口），三个 Mojang 主机都映射到它（decisions.md M2a、M2b） */
  mojangOrigin: string | null;
  /** 工程的打开、保存对话框不弹出，直接用这个路径（对话框路径由服务层单元测试覆盖，e2e 用它走通界面） */
  projectPath: string | null;
  /** 悦灵烘焙产物的目录（代替 packages/mascot/generated）：测试用测试时生成的假图集，或指向空目录走占位实现（decisions.md M5b） */
  mascotDir: string | null;
  /** 后台测试时也创建（不显示的）启动画面，供 T-ALY 的启动画面测试检查 */
  splash: boolean;
}

export function readTestSwitches(isPackaged: boolean, env: Readonly<Record<string, string | undefined>>): TestSwitches {
  if (isPackaged) return { userDataDir: null, hiddenWindow: false, testHooks: false, exportTarget: null, ffmpeg: null, h264Candidates: null, gameAppData: null, mojangOrigin: null, projectPath: null, mascotDir: null, splash: false };
  const origin = env.ALLAY_E2E_MOJANG_ORIGIN;
  return {
    userDataDir: env.ALLAY_USER_DATA_DIR ? env.ALLAY_USER_DATA_DIR : null,
    hiddenWindow: env.ALLAY_E2E_HIDDEN === '1',
    testHooks: env.ALLAY_E2E_HOOKS === '1',
    exportTarget: env.ALLAY_E2E_EXPORT_TARGET ? env.ALLAY_E2E_EXPORT_TARGET : null,
    ffmpeg: env.ALLAY_FFMPEG ? env.ALLAY_FFMPEG : null,
    h264Candidates: parseCandidates(env.ALLAY_E2E_H264),
    gameAppData: env.ALLAY_E2E_GAME_APPDATA ? env.ALLAY_E2E_GAME_APPDATA : null,
    // 只接受本机回环地址，避免测试开关被拿来把下载指到别处
    mojangOrigin: origin && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin) ? origin : null,
    projectPath: env.ALLAY_E2E_PROJECT_PATH ? env.ALLAY_E2E_PROJECT_PATH : null,
    mascotDir: env.ALLAY_E2E_MASCOT_DIR ? env.ALLAY_E2E_MASCOT_DIR : null,
    splash: env.ALLAY_E2E_SPLASH === '1',
  };
}

/** 只接受编码器名的字符（字母、数字、下划线、连字符），最多 8 个 */
function parseCandidates(value: string | undefined): string[] | null {
  if (!value) return null;
  const list = value.split(',').map((v) => v.trim()).filter((v) => /^[a-z0-9_-]{1,32}$/i.test(v));
  return list.length ? list.slice(0, 8) : null;
}
