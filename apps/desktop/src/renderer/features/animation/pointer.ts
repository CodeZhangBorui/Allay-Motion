// 拖动的指针跟踪：监听挂在 window 上，只认按下时的那个指针。
// 不挂在按下的元素上：关键帧按时刻作 React 的 key，拖动中它的时刻一变元素就被换掉，挂在它身上的监听跟着没了，
// 拖到一半就断（第三轮 e2e 发现的问题）。挂在 window 上与元素的生死无关。
export interface PointerHandlers {
  move(ev: PointerEvent): void;
  up(ev: PointerEvent): void;
}

export function trackPointer(down: { pointerId: number }, handlers: PointerHandlers): void {
  const id = down.pointerId;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === id) handlers.move(ev);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    handlers.up(ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
