import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDroppedFiles } from './actions';

// 把资源包（zip 或文件夹）拖进窗口（03-assets.md 3.5）。页面只把 File 对象交给 preload，路径由 preload 取（1.6 第 6 条）。
// 不处理的拖放一律 preventDefault：否则 Chromium 会尝试打开文件（导航本来就被主进程拒绝）。

export function useDropPacks(): boolean {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length > 0) void addDroppedFiles(t, files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [t]);
  return over;
}
