import { describe, expect, it } from 'vitest';
import { pixelFontSize } from '../../packages/ui/src/lib/pixel-scale';

// 6.2 字体：像素字的每个字形像素占用整数个设备像素
describe('pixelFontSize', () => {
  it('100% 与 200% 下就是名义字号', () => {
    expect(pixelFontSize(12, 1)).toBe(12);
    expect(pixelFontSize(24, 1)).toBe(24);
    expect(pixelFontSize(12, 2)).toBe(12);
    expect(pixelFontSize(24, 2)).toBe(24);
  });
  it('150% 下 12 变成 16 CSS px（24 个设备像素），24 不变（36 个设备像素）', () => {
    expect(pixelFontSize(12, 1.5)).toBe(16);
    expect(pixelFontSize(24, 1.5)).toBe(24);
  });
  it('任何缩放下设备像素都是 12 的整数倍', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      for (const n of [12, 24]) {
        const device = pixelFontSize(n, dpr) * dpr;
        expect(Math.abs(device / 12 - Math.round(device / 12)), `${n}@${dpr}`).toBeLessThan(1e-9);
      }
    }
  });
  it('缩放比例异常时按 1 处理', () => {
    expect(pixelFontSize(12, 0)).toBe(12);
    expect(pixelFontSize(12, Number.NaN)).toBe(12);
  });
});
