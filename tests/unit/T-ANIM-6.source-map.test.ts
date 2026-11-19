// T-ANIM-6：实时预览的“代码 ↔ 时刻”映射（docs/animation-editor.md 9.3）——某一时刻在生效的代码、点代码跳到的时刻，全部从文档结构推出来。
import { describe, expect, it } from 'vitest';
import { liveMarks, locateJson, timeAtOffset } from '../../apps/desktop/src/shared/animation/source-map';
import { AnimationDocSchema, newAnimationDoc, serializeAnimation } from '../../apps/desktop/src/shared/animation/schema';

const doc = AnimationDocSchema.parse({
  ...newAnimationDoc('Map', 'Block'),
  layers: [
    { ...newAnimationDoc('x').layers[0], from: 0.2, to: 1.8 },
    { id: 'r', name: 'Rect', type: 'rect', width: 10, height: 10, color: '#3CB7F4', props: { x: { keys: [{ t: 0, v: 0, ease: 'hold' }, { t: 1, v: 5 }] } } },
  ],
});
const text = serializeAnimation(doc);
const lineWith = (needle: string, from = 0) => text.slice(0, text.indexOf(needle, from)).split('\n').length;

describe('T-ANIM-6 实时预览的映射', () => {
  it('记录每个值的位置；不合法的 JSON 没有映射', () => {
    const spans = locateJson(text)!;
    const s = spans.get('layers.1.props.x.keys.1')!;
    expect(JSON.parse(text.slice(s.start, s.end))).toEqual({ t: 1, v: 5 });
    expect(locateJson('{ "a": ')).toBeNull();
  });

  it('t = 0.3：第一个图层可见，y 在 0–0.6 的区间（backOut），rotY 在 0–1.2，opacity 还没到第一个关键帧；第二个图层在保持', () => {
    const marks = liveMarks(doc, text, 0.3);
    const labels = marks.map((m) => `${m.kind}:${m.label}`);
    expect(labels).toContain('layer:Block');
    expect(labels.some((l) => l.startsWith('segment:Block · y · backOut（0–0.6 s）'))).toBe(true);
    expect(labels.some((l) => l.startsWith('segment:Block · rotY · cubicOut'))).toBe(true);
    expect(labels).toContain('edge:Block · opacity = 1');
    expect(labels.some((l) => l.startsWith('hold:Rect · x · hold'))).toBe(true);
    const y = marks.find((m) => m.label.startsWith('Block · y'))!;
    expect(y.line).toBe(lineWith('{ "t": 0, "v": -700'));
    expect(y.endLine).toBe(lineWith('{ "t": 0.6, "v": 0'));
  });

  it('可见区间之外的图层不标；常量属性不标', () => {
    const marks = liveMarks(doc, text, 1.9);
    expect(marks.some((m) => m.label.startsWith('Block'))).toBe(false);
    expect(marks.some((m) => m.label.includes('rotX'))).toBe(false);
  });

  it('点关键帧跳到它的时刻；点图层名跳到它出现的时刻；点时长跳到末尾；认不出的不跳', () => {
    expect(timeAtOffset(doc, text, text.indexOf('{ "t": 1.2'))).toBe(1.2);
    expect(timeAtOffset(doc, text, text.indexOf('"name": "Block"') + 3)).toBe(0.2);
    expect(timeAtOffset(doc, text, text.indexOf('"duration"') + 2)).toBe(doc.duration);
    expect(timeAtOffset(doc, text, 0)).toBeNull();
  });
});
