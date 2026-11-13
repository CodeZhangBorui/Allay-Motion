// 16 位 PCM 的 WAV 编码（docs/05-export.md 5.5）。纯函数，不依赖 Web Audio：单元测试和 test:export 直接用。

/** 把各声道的浮点样本（-1–1）编码成交错的 16 位 PCM WAV。超出范围的样本先钳制 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const n = channels.length;
  if (n < 1) throw new Error('at least one channel');
  const frames = channels[0]!.length;
  if (channels.some((c) => c.length !== frames)) throw new Error('channel lengths differ');
  const dataBytes = frames * n * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, n, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * n * 2, true);
  view.setUint16(32, n * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i]!));
      // 对称量化：±1 对应 ±32767，四舍五入（确定性，与平台无关）
      view.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  }
  return out;
}
