// 041 聊天消息 allay.builtin.chat-message（docs/templates/chat-message.md）。叠加层：左下角的聊天行，可以先在输入栏里打字再发出。
// 只用公开的模板接口；布局按界面像素，数值和时间公式在 layout.ts。
import type { SetupContext, TemplateInstance, TemplateModule } from '@allay/template-sdk';
import { overlayWindows, progress } from '../../_lib/src/timing';
import { bool, createGui, fontOf, linesOf, num, parseFormatted, plainText, rgbOf, richText } from '../../_lib/src/gui-kit';
import {
  BG_LEFT,
  BG_RIGHT,
  CHAT_WIDTH,
  CHAT_X,
  CURSOR_COLOR,
  cursorOn,
  fitUnit,
  INPUT_TEXT_COLOR,
  inputBar,
  LINE_H,
  MAX_MESSAGES,
  MAX_ROWS,
  rowCount,
  rowTop,
  sampleCues,
  schedule,
  TEXT_DY,
  typedCount,
  typedText,
  visibleRows,
} from './layout';

type Object3D = InstanceType<SetupContext['THREE']['Object3D']>;

interface Message {
  object: Object3D;
  /** 设计单位 */
  height: number;
  rows: number;
  setOpacity(a: number): void;
}

const template: TemplateModule = {
  setup(ctx: SetupContext): TemplateInstance {
    const { stage, params } = ctx;
    const inDuration = num(params.inDuration, 0.2);
    const hold = num(params.hold, 6);
    const outDuration = num(params.outDuration, 0.2);
    const win = overlayWindows(stage.fps, inDuration, hold, outDuration);
    const lifetime = Math.max(0.1, num(params.lifetime, 10));
    const interval = Math.max(0, num(params.interval, 1.2));
    const bgOpacity = num(params.bgOpacity, 0.5);
    const textColor = rgbOf(params.textColor, '#FFFFFF');
    const font = fontOf(params.font);

    // 放不下 332 个界面像素宽时整体缩小（9:16）
    const unit = fitUnit(stage.width, stage.height, Math.max(1, num(params.guiScale, 4)));
    const gw = stage.width / unit;
    const gh = stage.height / unit;
    const gui = createGui(ctx, unit);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);

    // 单行高度：原版字体是 8（行高 9）；更高的字体时行跟着变高，底板和文字仍然对齐
    const oneLine = ctx.text.create({ text: 'A', size: unit, align: 'left', font }).height / unit;
    const rowH = Math.max(LINE_H, Math.ceil(oneLine - 1e-6) + 1);

    const lines = linesOf(params.lines, MAX_MESSAGES).filter((l) => plainText(l).trim() !== '');
    const messages: Message[] = lines.map((line) => {
      if (plainText(line) !== line) {
        // 带格式码的一行：多色文字不能换行，放不下 320 时这一行自己缩小
        const rich = richText(ctx, parseFormatted(line, { color: textColor, bold: false, italic: false, underline: false, strikethrough: false }), unit, font, true);
        const k = Math.min(1, (CHAT_WIDTH * unit) / Math.max(1, rich.width));
        rich.object.scale.setScalar(k);
        gui.put(rich.object, CHAT_X, 0, 2);
        return { object: rich.object, height: oneLine * unit, rows: 1, setOpacity: (a) => rich.setOpacity(a) };
      }
      const text = ctx.text.create({ text: line, size: unit, color: textColor, align: 'left', maxWidth: CHAT_WIDTH * unit, font });
      gui.put(text.object, CHAT_X, 0, 2);
      return { object: text.object, height: text.height, rows: rowCount(text.height / unit, oneLine), setOpacity: (a) => text.setOpacity(a) };
    });

    // 输入栏：每个前缀长度一个文字对象（文字对象建好后不能改内容），光标单独一个
    const typed = bool(params.typeFirst, false) && lines.length > 0 ? typedText(plainText(lines[0]!)) : [];
    const typing = typed.length > 0;
    const typeSpeed = Math.max(0.5, num(params.typeSpeed, 10));
    const bar = inputBar(gw, gh);
    const prefixes: { text: { object: Object3D; setOpacity(a: number): void } | null; width: number }[] = [];
    let cursor: { object: Object3D; setOpacity(a: number): void } | null = null;
    if (typing) {
      for (let n = 1; n <= typed.length; n++) {
        const s = typed.slice(0, n).join('');
        const trailing = s.length - s.replace(/ +$/, '').length;
        if (s.trim() === '') {
          prefixes.push({ text: null, width: trailing * 4 });
          continue;
        }
        const t = ctx.text.create({ text: s, size: unit, color: INPUT_TEXT_COLOR, align: 'left', font });
        gui.putText(t, bar.textX, bar.textY, 2);
        t.object.visible = false;
        // 文字对象的宽度不含行尾空格，按空格数补（原版字体的空格宽 4）
        prefixes.push({ text: t, width: t.width / unit + trailing * 4 });
      }
      const c = ctx.text.create({ text: '_', size: unit, color: CURSOR_COLOR, align: 'left', font });
      gui.putText(c, bar.textX, bar.textY, 2);
      cursor = c;
    }

    const plan = schedule(messages.length, interval, typing ? { start: win.in.end, chars: typed.length, speed: typeSpeed } : null);

    // 行底板最多 MAX_ROWS 块，最后一块留给输入栏
    const BAR = MAX_ROWS;
    const plates = gui.quads(MAX_ROWS + 1, null, 0);
    for (let i = 0; i <= MAX_ROWS; i++) plates.hide(i);
    const rowsOf = messages.map((m) => m.rows);

    if (typeof params.sound === 'string') {
      const gain = num(params.volume, 0.8);
      for (const at of sampleCues(plan.appear.filter((at) => at < win.duration))) ctx.audio.cue(params.sound, at, { gain });
    }

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 整体的淡入淡出（游戏里聊天是直接出现的）；首尾各让出一帧
        const g = progress(t, win.in) * (1 - progress(t, win.out));

        for (const m of messages) m.object.visible = false;
        let q = 0;
        if (g > 0) {
          for (const slot of visibleRows(t, plan.appear, rowsOf, lifetime)) {
            const m = messages[slot.index]!;
            // 多行的消息：最上面一行的上边 + 1 是整段文字的上边
            const top = rowTop(gh, slot.row + slot.rows - 1, rowH) + TEXT_DY;
            m.object.visible = true;
            m.object.position.y = -top * unit - m.height / 2;
            m.setOpacity(slot.alpha * g);
            for (let r = 0; r < slot.rows; r++) {
              plates.rect(q, BG_LEFT, rowTop(gh, slot.row + r, rowH), BG_RIGHT - BG_LEFT, rowH);
              plates.color(q, '#000000', bgOpacity * slot.alpha * g);
              q++;
            }
          }
        }
        for (; q < MAX_ROWS; q++) plates.hide(q);

        if (typing && cursor) {
          const open = g > 0 && t < plan.inputEnd;
          const n = open ? typedCount(t - plan.typeStart, typeSpeed, typed.length) : 0;
          for (let i = 0; i < prefixes.length; i++) {
            const p = prefixes[i]!.text;
            if (!p) continue;
            p.object.visible = open && i === n - 1;
            if (p.object.visible) p.setOpacity(g);
          }
          cursor.object.visible = open && cursorOn(t);
          if (open) {
            cursor.object.position.x = (bar.textX + (n > 0 ? prefixes[n - 1]!.width : 0)) * unit;
            cursor.setOpacity(g);
            plates.rect(BAR, bar.x, bar.y, bar.w, bar.h);
            plates.color(BAR, '#000000', bgOpacity * g);
          } else {
            plates.hide(BAR);
          }
        }
        plates.commit();
      },
      dispose() {
        plates.dispose();
      },
    };
  },
};

export default template;
