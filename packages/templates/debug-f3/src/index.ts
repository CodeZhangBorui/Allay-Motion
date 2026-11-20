// 054 调试屏幕 allay.builtin.debug-f3（docs/templates/debug-f3.md）。叠加层：F3 的左右两栏带灰底的调试文字，
// 坐标、朝向、帧率按参数给的路线随时间变化。只用公开的模板接口；版式、路线和数值格式在 layout.ts。
//
// 文字对象建好后内容不能改，所以会变的行这样画：固定的片段各是一个文字对象；数值占位符按字符画，
// “0123456789-.” 每个字符只建一个文字对象，其余都是它的克隆（克隆共用几何体和材质，改原件的不透明度对所有克隆生效）；
// 朝向的词只有四种，各建一个，显示当前那一个。update(t) 里只改位置和 visible。
import type { SetupContext, TemplateInstance, TemplateModule, TextObject } from '@allay/template-sdk';
import { overlayWindows, progress } from '../../_lib/src/timing';
import { alphaOf, createGui, fontOf, num, rgbOf, str } from '../../_lib/src/gui-kit';
import {
  FACINGS,
  facingIndex,
  fitRoot,
  formatValue,
  isNumericKey,
  lineBackground,
  lineTop,
  MARGIN,
  MAX_VALUES,
  NUMERIC_CHARS,
  NUMERIC_MAX_LEN,
  parseLine,
  poseAt,
  rightLineX,
  routeProgress,
  splitLines,
  TEXT_H,
  TOWARDS,
  type NumericKey,
  type Pose,
  type Route,
} from './layout';

type Object3D = InstanceType<SetupContext['THREE']['Object3D']>;

/**
 * 一行里的一段。宽度都是界面像素（缩小之前）。三种段用同一个形状、用不到的字段留空：
 * 打包后的 JS 没有类型标注，外部编辑器按 checkJs 检查时认不出可辨识联合（tests/unit/template-dev.test.ts）。
 */
interface Part {
  kind: 'static' | 'number' | 'word';
  /** static：这段固定文字（只有空格时是 null）和它的宽度 */
  object: Object3D | null;
  width: number;
  /** number：哪个数值，以及每个字符备好的克隆 */
  key: NumericKey | null;
  pools: Map<string, Object3D[]>;
  all: Object3D[];
  /** word：几个候选词，显示当前的那个 */
  options: { object: Object3D; width: number }[];
}
const part = (kind: Part['kind'], fields: Partial<Part>): Part => ({ kind, object: null, width: 0, key: null, pools: new Map(), all: [], options: [], ...fields });

interface Line {
  right: boolean;
  top: number;
  /** 灰底在批次里的序号 */
  index: number;
  holder: Object3D;
  parts: Part[];
  dynamic: boolean;
}

const template: TemplateModule = {
  setup(ctx: SetupContext): TemplateInstance {
    const { THREE, stage, params } = ctx;
    const G = Math.max(1, num(params.guiScale, 4));
    const inDuration = num(params.inDuration, 0.15);
    const hold = num(params.hold, 4);
    const win = overlayWindows(stage.fps, inDuration, hold, num(params.outDuration, 0.15));
    const font = fontOf(params.font);
    const color = rgbOf(params.textColor, '#E0E0E0');
    const bgColor = rgbOf(params.bgColor, '#505050');
    const bgAlpha = alphaOf(params.bgColor);

    const sway = ctx.random('sway');
    const jitter = ctx.random('fps');
    const phase = (): [number, number] => [sway.range(0, Math.PI * 2), sway.range(0, Math.PI * 2)];
    const route: Route = {
      from: [num(params.fromX, 0), num(params.fromY, 64), num(params.fromZ, 0)],
      to: [num(params.toX, 0), num(params.toY, 64), num(params.toZ, 0)],
      pitch: num(params.pitch, 0),
      fpsBase: num(params.fpsBase, 60),
      yawPhases: phase(),
      pitchPhases: phase(),
      fpsJitter: Array.from({ length: 31 }, () => jitter.range(-1, 1)),
    };
    const pose = (t: number): Pose => poseAt(t, routeProgress(t, inDuration, hold), route);

    // 所有文字对象（原件）：整体淡入淡出时逐个改不透明度
    const texts: TextObject[] = [];
    const make = (text: string): TextObject => {
      const t = ctx.text.create({ text, size: G, color, align: 'left', font });
      texts.push(t);
      return t;
    };
    // 数值用到的字符：每个一个原件。空格的宽度从 “0 0” 和 “0” 的宽度差量出来（原版字体是 4）
    const glyphs = new Map<string, { text: TextObject; width: number }>();
    for (const ch of NUMERIC_CHARS) {
      const text = make(ch);
      glyphs.set(ch, { text, width: text.width / G });
    }
    const zero = glyphs.get('0')!.width;
    const spaceWidth = Math.max(0, make('0 0').width / G - 2 * zero);
    /** 一段固定文字：文字对象的宽度不含行尾空格，按空格数补上 */
    const fixed = (text: string): Part => {
      const body = text.replace(/ +$/, '');
      const trailing = (text.length - body.length) * spaceWidth;
      if (body === '') return part('static', { width: trailing });
      const t = make(body);
      return part('static', { object: t.object, width: t.width / G + trailing });
    };

    const gui = createGui(ctx, G);
    gui.root.position.set(-stage.width / 2, stage.height / 2, 0);
    const columns = [splitLines(str(params.left, '')), splitLines(str(params.right, ''))];
    const backgrounds = gui.quads(columns[0]!.length + columns[1]!.length, null, 0);
    backgrounds.setOpacity(0);

    // 占位符太多时，多出来的定格成停留中点的值
    const frozen = pose(inDuration + hold / 2);
    let values = 0;
    const lines: Line[] = [];
    columns.forEach((column, side) => {
      column.forEach((source, row) => {
        const index = side * columns[0]!.length + row;
        backgrounds.hide(index);
        if (source === '') return;
        const holder = new THREE.Object3D();
        const parts: Part[] = [];
        let dynamic = false;
        for (const token of parseLine(source)) {
          if (token.kind === 'text') {
            parts.push(fixed(token.text));
            continue;
          }
          if (values >= MAX_VALUES) {
            parts.push(fixed(formatValue(token.key, frozen)));
            continue;
          }
          values++;
          dynamic = true;
          if (isNumericKey(token.key)) {
            // 每个数字备 maxLen 个克隆，负号、小数点各一个：值再怎么变也够用
            const maxLen = NUMERIC_MAX_LEN[token.key];
            const pools = new Map<string, Object3D[]>();
            const all: Object3D[] = [];
            for (const [ch, glyph] of glyphs) {
              const pool = Array.from({ length: ch === '-' || ch === '.' ? 1 : maxLen }, () => {
                // Object3D.clone() 是 three 的公开方法，但不在随应用生成的类型面（template-api.d.ts）里，所以这里断言一下
                const clone = (glyph.text.object as unknown as { clone(): Object3D }).clone();
                clone.visible = false;
                holder.add(clone);
                return clone;
              });
              pools.set(ch, pool);
              all.push(...pool);
            }
            parts.push(part('number', { key: token.key, pools, all }));
          } else {
            const words = token.key === 'facing' ? FACINGS : TOWARDS;
            const options = words.map((w) => {
              const t = make(w);
              t.object.visible = false;
              return { object: t.object, width: t.width / G };
            });
            parts.push(part('word', { options }));
          }
        }
        for (const p of parts) {
          if (p.object) holder.add(p.object);
          for (const o of p.options) holder.add(o.object);
        }
        // 行的原点在文字左边、这一行 8 个像素高的中线上
        gui.put(holder, MARGIN, lineTop(row) + TEXT_H / 2, 1);
        lines.push({ right: side === 1, top: lineTop(row), index, holder, parts, dynamic });
      });
    });

    /** 一行在某个状态下的宽度；apply 时顺带把各段摆好 */
    const used = new Map<string, number>();
    const layoutLine = (line: Line, at: Pose, apply: boolean): number => {
      let x = 0;
      for (const part of line.parts) {
        if (part.kind === 'static') {
          if (apply && part.object) part.object.position.x = x * G;
          x += part.width;
        } else if (part.kind === 'word') {
          const current = facingIndex(at.yaw);
          if (apply) {
            part.options.forEach((o, i) => {
              o.object.visible = i === current;
              o.object.position.x = x * G;
            });
          }
          x += part.options[current]!.width;
        } else if (part.key) {
          if (apply) for (const o of part.all) o.visible = false;
          used.clear();
          for (const ch of formatValue(part.key, at)) {
            const n = used.get(ch) ?? 0;
            used.set(ch, n + 1);
            // 备的克隆用完了（不该发生）就跳过这个字符，不报错
            const clone = part.pools.get(ch)?.[n];
            if (!clone) continue;
            if (apply) {
              clone.visible = true;
              clone.position.x = x * G;
            }
            x += glyphs.get(ch)!.width;
          }
        }
      }
      return x;
    };

    // 两栏最宽的行（会变的行在整段时间里取样），放不下时整体缩小，界面的宽高相应变大
    const samples = Array.from({ length: 49 }, (_, i) => pose((win.duration * i) / 48));
    const widest = (right: boolean): number =>
      Math.max(0, ...lines.filter((l) => l.right === right).map((l) => (l.dynamic ? Math.max(...samples.map((s) => layoutLine(l, s, false))) : layoutLine(l, frozen, false))));
    const k = fitRoot(stage.width / G, stage.height / G, widest(false), widest(true), Math.max(columns[0]!.length, columns[1]!.length));
    gui.root.scale.setScalar(k);
    const guiWidth = stage.width / (G * k);

    /** 摆一行：各段的位置、右栏的右对齐、灰底 */
    const place = (line: Line, at: Pose) => {
      const width = layoutLine(line, at, true);
      const x = line.right ? rightLineX(guiWidth, width) : MARGIN;
      line.holder.position.x = x * G;
      backgrounds.rect(line.index, ...lineBackground(x, line.top, width));
      backgrounds.color(line.index, bgColor, bgAlpha);
    };
    for (const line of lines) place(line, frozen);
    backgrounds.commit();

    return {
      duration: win.duration,
      cutTime: null,
      update(t: number) {
        // 整体淡入淡出（游戏里是按下 F3 直接出现）；首末帧全透明
        const a = progress(t, win.in) * (1 - progress(t, win.out));
        for (const text of texts) text.setOpacity(a);
        backgrounds.setOpacity(a);
        const at = pose(t);
        for (const line of lines) if (line.dynamic) place(line, at);
        backgrounds.commit();
      },
      dispose() {
        backgrounds.dispose();
      },
    };
  },
};

export default template;
