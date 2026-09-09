import { useCallback, useRef } from 'react';

/**
 * Smoothed scrolling for the landing page: wheel and touch deltas move a
 * target offset, and the inner track eases toward it each frame. The wheel
 * handler stays passive at both ends so the page still hands scrolling back to
 * the browser once the content is exhausted.
 *
 * Returns a callback ref for the clipping container; its first child is the
 * translated track.
 */
export function useInertiaScroll() {
  const cleanupRef = useRef<(() => void) | null>(null);

  // Teardown lives here rather than in an effect cleanup on purpose. React 18
  // StrictMode double-invokes effects but not callback refs, so an effect
  // cleanup would stop the loop on the simulated unmount with nothing left to
  // restart it. React always calls this ref with null on a real unmount.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;

    const track = el.firstElementChild as HTMLElement | null;
    if (!track) return;

    let target = 0;
    let current = 0;
    let max = 0;
    let frame = 0;
    let touchY = 0;

    const measure = () => {
      max = Math.max(0, track.scrollHeight - el.clientHeight);
      target = Math.min(target, max);
    };

    const loop = () => {
      current += (target - current) * 0.085;
      if (Math.abs(target - current) < 0.05) current = target;
      track.style.transform = `translate3d(0,${(-current).toFixed(2)}px,0)`;
      frame = requestAnimationFrame(loop);
    };

    const wheel = (e: WheelEvent) => {
      measure();
      if (max <= 0) return;
      const atTop = target <= 0 && e.deltaY < 0;
      const atEnd = target >= max && e.deltaY > 0;
      if (atTop || atEnd) return;
      e.preventDefault();
      target = Math.max(0, Math.min(max, target + e.deltaY));
    };

    const touchStart = (e: TouchEvent) => {
      touchY = e.touches[0].clientY;
      measure();
    };

    const touchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      const delta = touchY - y;
      touchY = y;
      if (max <= 0) return;
      target = Math.max(0, Math.min(max, target + delta * 1.6));
      e.preventDefault();
    };

    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('touchstart', touchStart, { passive: true });
    el.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('resize', measure);

    measure();
    loop();

    cleanupRef.current = () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('touchmove', touchMove);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return containerRef;
}
