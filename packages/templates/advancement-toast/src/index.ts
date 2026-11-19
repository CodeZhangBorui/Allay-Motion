// T6 进度提示 allay.builtin.advancement-toast（docs/04-templates.md 4.10）。叠加层：没有剪辑点，cutTime 为 null。
// 只用公开的模板接口：THREE 和所有辅助函数都从 ctx 拿，只从 template-sdk 做类型导入（4.9）。
//
// 布局以“界面像素”计（面板原生 160×32），一个界面像素 = g 个设计单位。各样式对照的原版行为见 docs/04-templates.md 的 T6 一节：
// - java（Java 1.12 起的提示框）：滑入滑出各 600 ms，在画面上的比例 = (经过时间 / 600)²（ToastManager 的 getVisibility），
//   从屏幕右边缘水平滑进来，贴着右上角、没有边距；进度提示显示 5 秒后开始滑出。
//   标题放不下一行（宽 125 界面像素）时：前 1.5 秒只显示类型行（1.2–1.5 秒淡出），之后标题各行在 0.3 秒里淡入、竖直居中、行距 9。
// - javaAchievement（Java 1.11 及更早的“获得成就！”）：从屏幕顶上落下，共 3 秒；进出各占 1/8，
//   位移 36 × (1 − 进度)⁴ 界面像素（GuiAchievement 的公式）。
// - 文字都不带阴影（游戏里 drawString(..., false)），用户可以在字体参数里打开。
import type { FontStyle, ParamValue, SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';

const num = (v: ParamValue | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: ParamValue | undefined, fallback: string): string => (typeof v === 'string' ? v : fallback);
const font = (v: ParamValue | undefined): FontStyle | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { family?: unknown }).family === 'string' ? (v as unknown as FontStyle) : undefined;

const PANEL_W = 160;
const PANEL_H = 32;
/** 图标：左上角 (8, 8)，16×16 */
const ICON_X = 8;
const ICON_Y = 8;
const ICON_SIZE = 16;
/** 文字右侧留白（面板加宽时用） */
const TEXT_RIGHT = 8;
/** 原版字体时两行文字的上边界 */
const HEADER_Y = 7;
const TITLE_Y = 18;
/** 进度提示里标题的换行宽度（AdvancementToast 的 font.split(title, 125)） */
const WRAP_W = 125;
/** 原版字体的行距 */
const LINE_H = 9;

type Kind = 'advancement' | 'recipe' | 'system';
type Style = 'java' | 'javaAchievement';

/** 每种提示框用的贴图、文字左边界、两行文字的默认颜色 */
const KINDS: Record<Kind, { texture: string; textX: number; icon: boolean; header: string; title: string }> = {
  advancement: { texture: 'minecraft:gui/sprites/toast/advancement', textX: 30, icon: true, header: '#FFFF00', title: '#FFFFFF' },
  // RecipeToast：标题 0xFF500050，说明文字黑色
  recipe: { texture: 'minecraft:gui/sprites/toast/recipe', textX: 30, icon: true, header: '#500050', title: '#000000' },
  // SystemToast：没有图标，文字从 18 开始
  system: { texture: 'minecraft:gui/sprites/toast/system', textX: 18, icon: false, header: '#FFFF00', title: '#FFFFFF' },
};
/** 进度类型决定的标题行颜色：挑战是 0xFF88FF，其余 0xFFFF00 */
const FRAME_COLOR: Record<string, string> = { task: '#FFFF00', goal: '#FFFF00', challenge: '#FF88FF' };
const HEADER_COLOR_DEFAULT = '#FFFF00';
const TITLE_COLOR_DEFAULT = '#FFFFFF';

/**
 * 游戏里的默认文案（语言文件的原文）。header / title 参数保持某个默认文案时，换成当前类型、样式对应的那一句（同一种语言），
 * 这样切换类型不用自己改字；用户改成别的文字就照用户的。
 */
const HEADERS: Record<string, { zh: string; en: string }> = {
  task: { zh: '进度已达成！', en: 'Advancement Made!' },
  goal: { zh: '目标已达成！', en: 'Goal Reached!' },
  challenge: { zh: '挑战已完成！', en: 'Challenge Complete!' },
  achievement: { zh: '获得成就！', en: 'Achievement get!' },
  recipe: { zh: '新配方已解锁！', en: 'New Recipes Unlocked!' },
};
const TITLES: Record<string, { zh: string; en: string }> = {
  advancement: { zh: '钻石！', en: 'Diamonds!' },
  recipe: { zh: '查看你的配方书', en: 'Check your recipe book' },
};
function swapDefault(value: string, table: Record<string, { zh: string; en: string }>, want: string): string {
  const target = table[want];
  if (!target) return value;
  for (const e of Object.values(table)) {
    if (value === e.zh) return target.zh;
    if (value === e.en) return target.en;
  }
  return value;
}

const template: TemplateModule = {
  async setup(ctx: SetupContext): Promise<TemplateInstance> {
    const { THREE, stage, scene, params } = ctx;
    const W = stage.width;
    const H = stage.height;
    const style: Style = params.style === 'javaAchievement' ? 'javaAchievement' : 'java';
    const kind: Kind = style === 'javaAchievement' ? 'advancement' : params.kind === 'recipe' || params.kind === 'system' ? params.kind : 'advancement';
    const k0 = KINDS[kind];
    const frame = str(params.frame, 'task');
    const headerKey = style === 'javaAchievement' ? 'achievement' : kind === 'recipe' ? 'recipe' : frame;
    const headerText = swapDefault(str(params.header, ''), HEADERS, headerKey);
    const titleText = swapDefault(str(params.title, ''), TITLES, kind === 'recipe' ? 'recipe' : 'advancement');
    const headerParam = str(params.headerColor, HEADER_COLOR_DEFAULT);
    const titleParam = str(params.titleColor, TITLE_COLOR_DEFAULT);
    const kindHeader = kind === 'advancement' && style === 'java' ? (FRAME_COLOR[frame] ?? k0.header) : k0.header;
    const headerColor = headerParam === HEADER_COLOR_DEFAULT ? kindHeader : headerParam;
    const titleColor = titleParam === TITLE_COLOR_DEFAULT ? k0.title : titleParam;
    const anchor = str(params.anchor, 'topRight');
    const guiScale = Math.max(1, Math.round(num(params.guiScale, 4)));
    const margin = Math.max(0, num(params.margin, 0));
    const inDuration = num(params.inDuration, 0.6);
    const hold = num(params.hold, 4.4);
    const outDuration = num(params.outDuration, 0.6);
    const volume = num(params.volume, 0.8);
    const duration = inDuration + hold + outDuration;

    // 文字先按 guiScale 建好，量出以界面像素计的尺寸（文字的宽高与字号成正比）
    const headerFont = font(params.headerFont);
    const titleFont = font(params.titleFont);
    const header = ctx.text.create({ text: headerText, size: guiScale, color: headerColor, align: 'left', ...(headerFont ? { font: headerFont } : {}) });
    // 进度提示（Java 1.12 起）的标题按 125 界面像素换行；其余照一行排，放不下时面板加宽
    const wrap = style === 'java' && kind === 'advancement';
    const title = ctx.text.create({
      text: titleText,
      size: guiScale,
      color: titleColor,
      align: 'left',
      ...(wrap ? { maxWidth: WRAP_W * guiScale } : {}),
      ...(titleFont ? { font: titleFont } : {}),
    });
    const probe = ctx.text.create({ text: 'A', size: guiScale, align: 'left', ...(titleFont ? { font: titleFont } : {}) });
    const oneLine = probe.height / guiScale;
    const hw = header.width / guiScale;
    const hh = header.height / guiScale;
    const tw = title.width / guiScale;
    const th = title.height / guiScale;
    const multiLine = wrap && th > oneLine + 1;
    const textX = k0.textX;

    // 面板：一行排的文字太长时向右加宽（九宫格拉伸，SystemToast 也是这样按文字宽度定宽）；
    // 文字比原版字体高（例如导入的字体）时两行重新均分、必要时加高
    const panelW = multiLine ? PANEL_W : Math.max(PANEL_W, Math.ceil(textX + Math.max(hw, tw) + TEXT_RIGHT));
    let headerTop = HEADER_Y;
    let titleTop = TITLE_Y;
    let panelH = PANEL_H;
    if (!multiLine && (headerTop + hh > titleTop || titleTop + th > PANEL_H - 3)) {
      panelH = Math.max(PANEL_H, Math.ceil(hh + th + 9));
      const gap = (panelH - hh - th) / 3;
      headerTop = gap;
      titleTop = 2 * gap + hh;
    }
    // 系统提示没有第二行时，标题放在 12（SystemToast）
    if (kind === 'system' && titleText.trim() === '') headerTop = 12;
    if (multiLine) {
      // 多行：类型行在 11；标题各行竖直居中（height / 2 − 行数 × 9 / 2）
      headerTop = 11;
      const lines = Math.max(1, Math.round((th + 1) / LINE_H));
      titleTop = Math.max(0, PANEL_H / 2 - Math.floor((lines * LINE_H) / 2));
    }

    // 实际缩放：面板放不进舞台（扣掉边距）时按比例缩小，三种画幅都成立
    const g = Math.max(0.1, Math.min(guiScale, (W - 2 * margin) / panelW, (H - 2 * margin) / panelH));
    const k = g / guiScale;
    const pw = panelW * g;
    const ph = panelH * g;

    const toast = new THREE.Object3D();
    scene.add(toast);
    // 1.11 及更早的成就框贴图（achievement_background.png）新版本的游戏文件里已经没有了，用同尺寸的进度提示框代替
    const panel = ctx.sprite.create(await ctx.resources.texture(k0.texture), { pixelSize: g });
    panel.setSize(pw, ph);
    toast.add(panel.object);
    // 子物体的坐标以面板左上角为原点（+y 向上，所以界面像素的 y 取负）
    const at = (obj: InstanceType<typeof THREE.Object3D>, x: number, y: number, z: number) => {
      obj.position.set(-pw / 2 + x * g, ph / 2 - y * g, z);
      toast.add(obj);
    };
    if (k0.icon) {
      const icon = (await ctx.resources.item(str(params.icon, 'minecraft:diamond'))).single();
      icon.scale.setScalar(ICON_SIZE * g);
      at(icon, ICON_X + ICON_SIZE / 2, ICON_Y + ICON_SIZE / 2, 2);
    }
    // 文字的原点：水平在左边，垂直在中线
    header.object.scale.setScalar(k);
    at(header.object, textX, headerTop + hh / 2, 3);
    if (titleText.trim() !== '' || kind !== 'system') {
      title.object.scale.setScalar(k);
      at(title.object, textX, titleTop + th / 2, 3);
    }

    // 停靠位置
    const right = anchor === 'topRight' || anchor === 'bottomRight';
    const top = anchor === 'topRight' || anchor === 'topLeft';
    const restX = right ? W / 2 - margin - pw / 2 : -W / 2 + margin + pw / 2;
    const restY = top ? H / 2 - margin - ph / 2 : -H / 2 + margin + ph / 2;
    // java：水平滑出到舞台边缘之外；javaAchievement：竖直方向移开 36 界面像素（面板高 32，整个在画外）
    const awayX = right ? W / 2 + pw / 2 + 1 : -W / 2 - pw / 2 - 1;
    const dropY = (Math.max(36 * g, ph + margin) + 1) * (top ? 1 : -1);
    toast.position.set(restX, restY, 0);

    // 时间窗：首尾各留一帧（同 T1 的理由：子帧最多偏离帧时刻 ±0.5/fps），所以首末帧面板整个在画外
    const pad = 1 / stage.fps;
    const inStart = Math.min(pad, inDuration / 2);
    const inLen = inDuration - inStart;
    const outStart = inDuration + hold;
    const outLen = duration - Math.min(pad, outDuration / 2) - outStart;

    // 音效：滑入时 ui.toast.in，开始滑出时 ui.toast.out（Toast.Visibility 的 SHOW / HIDE）；挑战另在第一帧放挑战完成音效
    if (typeof params.sound === 'string') ctx.audio.cue(params.sound, 0, { gain: volume });
    if (typeof params.outSound === 'string' && style === 'java') ctx.audio.cue(params.outSound, outStart, { gain: volume });
    if (typeof params.challengeSound === 'string' && style === 'java' && kind === 'advancement' && frame === 'challenge') ctx.audio.cue(params.challengeSound, 0, { gain: volume });

    const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

    return {
      duration,
      cutTime: null,
      update(t: number) {
        const a = clamp01((t - inStart) / inLen);
        const b = clamp01((t - outStart) / outLen);
        if (style === 'java') {
          // 在画面上的比例：滑入 a²，滑出 1 − b²
          const shown = b > 0 ? 1 - b * b : a * a;
          toast.position.x = shown >= 1 ? restX : awayX + (restX - awayX) * shown;
          if (multiLine) {
            // 相对提示框出现的时刻：前 1.5 秒只有类型行（最后 0.3 秒淡出），之后标题淡入
            const s = t - inStart;
            header.setOpacity(s < 1.5 ? clamp01((1.5 - s) / 0.3) : 0);
            title.setOpacity(s < 1.5 ? 0 : clamp01((s - 1.5) / 0.3) * (252 / 255));
          }
        } else {
          // 1.11 及更早：位移 36 × (1 − 进度)⁴
          const p = b > 0 ? 1 - b : a;
          const off = p >= 1 ? 0 : p <= 0 ? 1 : (1 - p) ** 4;
          toast.position.y = restY + dropY * off;
        }
      },
    };
  },
};

export default template;
