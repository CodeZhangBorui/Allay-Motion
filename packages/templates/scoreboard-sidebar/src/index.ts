// 040 记分板 allay.builtin.scoreboard-sidebar（docs/templates/scoreboard-sidebar.md）。叠加层：屏幕右侧的记分板侧边栏。
// 只用公开的模板接口；布局按界面像素（一个界面像素 = guiScale 个设计单位），数值在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { overlayWindows } from '../../_lib/src/timing';
import { fadeInOut } from '../../_lib/src/fade';
import { bool, createGui, fontOf, num, parseFormatted, plainText, rgbOf, richText, str, type Segment } from '../../_lib/src/gui-kit';
import { BODY_ALPHA, changeProgress, contentWidth, fitFactor, HEADER_ALPHA, parseRows, rowTop, SCORE_COLOR, sidebarLayout, SPACE_W, titleLeft, type Row } from './layout';

/** 一段会跟着行移动的文字：名字或分数 */
interface Piece {
  object: InstanceType<SetupContext['THREE']['Object3D']>;
  height: number;
  setOpacity(a: number): void;
  /** 变化前、变化后所在的行（0 是最上面）；null 表示那个状态里没有这一行 */
  from: number | null;
  to: number | null;
  /** 变化前、变化后是否显示（同一行前后的文字不同时，各有一段，在变化那一刻互换） */
  before: boolean;
  after: boolean;
}

const WHITE: Omit<Segment, 'text'> = { color: '#FFFFFF', bold: false, italic: false, underline: false, strikethrough: false };

const template: TemplateModule = {
  setup(ctx: SetupContext): TemplateInstance {
    const { stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 5));
    const inDuration = num(params.inDuration, 0.25);
    const hold = num(params.hold, 4);
    const outDuration = num(params.outDuration, 0.25);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);
    const showNumbers = bool(params.showNumbers, true);
    const side = params.side === 'left' ? 'left' : 'right';
    const mode = params.reorder === 'slide' ? 'slide' : 'instant';
    const scoreColor = rgbOf(params.scoreColor, SCORE_COLOR);
    const titleFont = fontOf(params.titleFont);
    const rowFont = fontOf(params.rowFont);

    const rowsBefore = parseRows(str(params.rows, ''));
    const afterText = str(params.rowsAfter, '');
    const hasChange = afterText.trim() !== '';
    const rowsAfter = hasChange ? parseRows(afterText) : rowsBefore;
    const changeAt = hasChange ? num(params.changeAt, 1.5) : Number.POSITIVE_INFINITY;

    const gui = createGui(ctx, G);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);
    const back = gui.quads(2, null, 0);

    // 文字对象建好后内容不能改：每个不同的名字、每个不同的分数各建一段，变化时切换显示
    const pieces: Piece[] = [];
    const widths: { nameW: number; scoreW: number }[] = [];
    const indexOf = (rows: readonly Row[], key: string): number | null => {
      const i = rows.findIndex((r) => r.key === key);
      return i < 0 ? null : i;
    };
    const scorePieces: { piece: Piece; width: number }[] = [];
    const addName = (name: string, from: number | null, to: number | null, before: boolean, after: boolean): number => {
      const rich = richText(ctx, parseFormatted(name, WHITE), G, rowFont, false);
      pieces.push({ object: rich.object, height: rich.height, setOpacity: (a) => rich.setOpacity(a), from, to, before, after });
      gui.put(rich.object, 0, 0, 2);
      return rich.width / G;
    };
    const addScore = (score: number, from: number | null, to: number | null, before: boolean, after: boolean): number => {
      if (!showNumbers) return 0;
      const t = ctx.text.create({ text: String(score), size: G, color: scoreColor, align: 'right', font: rowFont });
      const piece: Piece = { object: t.object, height: t.height, setOpacity: (a) => t.setOpacity(a), from, to, before, after };
      pieces.push(piece);
      scorePieces.push({ piece, width: t.width / G });
      gui.put(t.object, 0, 0, 2);
      return t.width / G;
    };
    const keys = [...new Set([...rowsBefore, ...rowsAfter].map((r) => r.key))];
    for (const key of keys) {
      const from = indexOf(rowsBefore, key);
      const to = hasChange ? indexOf(rowsAfter, key) : from;
      const b = from === null ? null : rowsBefore[from]!;
      const a = to === null ? null : rowsAfter[to]!;
      if (b && a) {
        if (b.name === a.name) {
          const nameW = addName(b.name, from, to, true, true);
          if (b.score === a.score) widths.push({ nameW, scoreW: addScore(b.score, from, to, true, true) });
          else widths.push({ nameW, scoreW: addScore(b.score, from, to, true, false) }, { nameW, scoreW: addScore(a.score, from, to, false, true) });
        } else {
          widths.push({ nameW: addName(b.name, from, to, true, false), scoreW: addScore(b.score, from, to, true, false) });
          widths.push({ nameW: addName(a.name, from, to, false, true), scoreW: addScore(a.score, from, to, false, true) });
        }
      } else {
        const r = (b ?? a)!;
        widths.push({ nameW: addName(r.name, from, to, b !== null, a !== null), scoreW: addScore(r.score, from, to, b !== null, a !== null) });
      }
    }

    const titleText = str(params.title, '');
    const title = plainText(titleText).trim() === '' ? null : richText(ctx, parseFormatted(titleText, WHITE), G, titleFont, false);
    const titleW = title ? title.width / G : 0;
    // “: ” 的宽度：冒号用一段不加进场景的文字量出来，空格按原版字体的 4
    const separatorW = showNumbers ? ctx.text.create({ text: ':', size: G, align: 'left', font: rowFont }).width / G + SPACE_W : 0;
    // 面板的宽度取前后两个状态里最宽的，变化时宽度不跳
    const contentW = contentWidth(titleW, widths, separatorW, showNumbers);

    // 放不下（行太多、名字太长、界面缩放太大）时整体缩小：界面像素变小，界面的宽高相应变大
    const maxRows = Math.max(rowsBefore.length, rowsAfter.length);
    const k = fitFactor(stage.width / G, stage.height / G, maxRows, contentW);
    gui.root.scale.setScalar(k);
    const guiW = stage.width / (G * k);
    const guiH = stage.height / (G * k);
    const layoutBefore = sidebarLayout(guiW, guiH, rowsBefore.length, contentW, side);
    const layoutAfter = sidebarLayout(guiW, guiH, rowsAfter.length, contentW, side);
    const { left, right, backLeft } = layoutBefore;

    // 水平位置不随时间变：名字靠左，分数的右边贴着黑底的右边，标题在内容宽度里居中
    for (const p of pieces) p.object.position.x = left * G;
    for (const s of scorePieces) s.piece.object.position.x = right * G;
    if (title) gui.put(title.object, titleLeft(layoutBefore, contentW, Math.ceil(titleW)), 0, 2);
    const empty = pieces.length === 0 && !title;

    if (hasChange && typeof params.sound === 'string' && changeAt < win.duration) ctx.audio.cue(params.sound, changeAt, { gain: num(params.volume, 0.8) });

    const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
    /** 把原点在竖直中线的对象的上边放到界面坐标 gy */
    const setTop = (object: Piece['object'], height: number, gy: number) => {
      object.position.y = -gy * G - height / 2;
    };

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 整体淡入淡出（游戏里记分板是直接出现的）；_lib 的时间窗首尾各让出一帧
        const a = fadeInOut(t, win);
        const changed = t >= changeAt;
        const p = changeProgress(t, changeAt, mode);
        const top = lerp(layoutBefore.top, layoutAfter.top, p);
        const bottom = lerp(layoutBefore.bottom, layoutAfter.bottom, p);

        if (empty || a <= 0) {
          back.hide(0);
          back.hide(1);
        } else {
          // 标题的黑底到最上一行上方 1 个界面像素为止，剩下的 1 像素和各行同色
          if (title) {
            back.rect(0, backLeft, top - 10, right - backLeft, 9);
            back.color(0, '#000000', HEADER_ALPHA * a);
          } else back.hide(0);
          back.rect(1, backLeft, top - 1, right - backLeft, bottom - top + 1);
          back.color(1, '#000000', BODY_ALPHA * a);
        }
        back.commit();

        if (title) {
          title.object.visible = a > 0;
          title.setOpacity(a);
          setTop(title.object, title.height, top - 9);
        }
        for (const piece of pieces) {
          const moving = piece.from !== null && piece.to !== null;
          // 两个状态里都有的行：文字在变化那一刻互换。只在一个状态里的行：instant 下直接出现、消失，slide 下跟着换位淡入、淡出
          const shown = moving ? (changed ? piece.after : piece.before) : true;
          const fade = moving ? 1 : piece.before ? 1 - p : p;
          const alpha = shown ? a * fade : 0;
          piece.object.visible = alpha > 0;
          piece.setOpacity(alpha);
          // 只在一个状态里的行不移动，待在它自己那个状态的位置上
          const yBefore = piece.from !== null ? rowTop(layoutBefore, piece.from) : rowTop(layoutAfter, piece.to ?? 0);
          const yAfter = piece.to !== null ? rowTop(layoutAfter, piece.to) : yBefore;
          setTop(piece.object, piece.height, lerp(yBefore, yAfter, p));
        }
      },
      dispose() {
        back.dispose();
      },
    };
  },
};

export default template;
