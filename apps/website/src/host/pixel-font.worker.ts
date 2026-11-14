// 兜底像素字体的下载、解压、解析放在这个 Worker 里：BDF 有 3.6 MB 文本，在主线程上解析会卡住几十毫秒
// （首屏预览轮到带文字的模板时掉帧）。结果的几张表零拷贝转回主线程。
import { parseBdf } from '@allay/assets';

async function load(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pixel font ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // 外面是一层 gzip；托管方已经替我们解过（带了 Content-Encoding）时直接当文本
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const url = typeof event.data === 'string' ? event.data : null;
  if (!url) return;
  void load(url)
    .then((text) => {
      const t = parseBdf(text);
      self.postMessage({ ok: true, tables: t }, { transfer: [t.codepoints.buffer, t.metrics.buffer, t.offsets.buffer, t.bits.buffer] });
    })
    .catch((error: unknown) => self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }));
});
