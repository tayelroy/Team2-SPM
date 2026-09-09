import { useCallback, useRef } from 'react';

/**
 * The bioluminescent data orb behind the landing hero: a Fibonacci-distributed
 * point sphere rendered to canvas, rotating on two axes, where each point
 * springs back to its projected home after the pointer pushes it away.
 * Pointer-down inverts the force so a click pulls the cloud inward.
 *
 * Returns two callback refs — one for the canvas, one for a spacer element the
 * hook grows so the whole sphere clears the hero copy at any viewport size.
 */
export function useParticleOrb() {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Teardown lives here rather than in an effect cleanup on purpose. React 18
  // StrictMode double-invokes effects but not callback refs, so an effect
  // cleanup would stop the loop on the simulated unmount with nothing left to
  // restart it. React always calls this ref with null on a real unmount.
  const canvasRef = useCallback((el: HTMLCanvasElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;

    const ctx = el.getContext('2d');
    // jsdom and other non-rendering hosts have no 2D context; the hero simply
    // renders without the orb.
    if (!ctx) return;

    const parent = el.parentElement;
    if (!parent) return;

    interface Point {
      sx: number;
      sy: number;
      sz: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      pink: boolean;
      size: number;
      placed: boolean;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pointer = { x: -9999, y: -9999, down: false };
    let width = 0;
    let height = 0;
    let frame = 0;
    let time = 0;
    let centreY = 0;
    let points: Point[] = [];

    const build = () => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(2100, Math.min(6600, Math.round((width * height) / 300)));
      // Radius keys off the viewport, not the hero, so growing the spacer
      // below cannot feed back into the size.
      const r = Math.min(width, window.innerHeight) * 0.36;
      const projected = r * (620 / (620 - r));

      const copy = spacerRef.current?.previousElementSibling ?? null;
      const textBottom = copy
        ? copy.getBoundingClientRect().bottom - box.top
        : height * 0.5;
      if (spacerRef.current) {
        spacerRef.current.style.height = `${Math.ceil(Math.max(0, 2 * projected - 328))}px`;
      }
      centreY = textBottom + projected - 164;

      points = [];
      for (let i = 0; i < count; i += 1) {
        const k = i + 0.5;
        const phi = Math.acos(1 - (2 * k) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * k;
        points.push({
          sx: Math.cos(theta) * Math.sin(phi) * r,
          sy: Math.cos(phi) * r,
          sz: Math.sin(theta) * Math.sin(phi) * r,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          pink: i % 11 === 0,
          size: 0.45 + Math.random() * 1.1,
          placed: false,
        });
      }
    };

    const step = () => {
      time += 0.0011;
      ctx.clearRect(0, 0, width, height);
      const cx = width * 0.5;
      const cos = Math.cos(time);
      const sin = Math.sin(time);
      const cos2 = Math.cos(time * 0.42);
      const sin2 = Math.sin(time * 0.42);

      for (const p of points) {
        // Rotate about Y, then about X.
        const x = p.sx * cos - p.sz * sin;
        let z = p.sx * sin + p.sz * cos;
        const y = p.sy * cos2 - z * sin2;
        z = p.sy * sin2 + z * cos2;

        const persp = 620 / (620 + z);
        const tx = cx + x * persp;
        const ty = centreY + y * persp;
        if (!p.placed) {
          p.x = tx;
          p.y = ty;
          p.placed = true;
        }

        // Spring toward the projected home position.
        p.vx += (tx - p.x) * 0.06;
        p.vy += (ty - p.y) * 0.06;

        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        const reach = pointer.down ? 300 : 165;
        if (d2 < reach * reach && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const force = (1 - d / reach) * (pointer.down ? -3.4 : 3.1);
          p.vx += (dx / d) * force;
          p.vy += (dy / d) * force;
        }

        p.vx *= 0.87;
        p.vy *= 0.87;
        p.x += p.vx;
        p.y += p.vy;

        const alpha = 0.22 + persp * 0.62;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * persp, 0, Math.PI * 2);
        ctx.fillStyle = p.pink
          ? `rgba(253,233,255,${alpha * 0.95})`
          : `rgba(203,255,252,${alpha * 0.72})`;
        ctx.fill();
      }
      frame = requestAnimationFrame(step);
    };

    const move = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      pointer.x = e.clientX - box.left;
      pointer.y = e.clientY - box.top;
    };
    const leave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
      pointer.down = false;
    };
    const down = (e: PointerEvent) => {
      pointer.down = true;
      move(e);
    };
    const up = () => {
      pointer.down = false;
    };

    parent.addEventListener('pointermove', move);
    parent.addEventListener('pointerleave', leave);
    parent.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('resize', build);

    build();
    // The spacer's ref is assigned after the canvas's, and web fonts settle
    // later still, so re-measure on the next frame and again shortly after.
    const settleFrame = requestAnimationFrame(build);
    const settleTimer = window.setTimeout(build, 300);
    step();

    cleanupRef.current = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame);
      window.clearTimeout(settleTimer);
      parent.removeEventListener('pointermove', move);
      parent.removeEventListener('pointerleave', leave);
      parent.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('resize', build);
    };
  }, []);

  return { canvasRef, spacerRef };
}
