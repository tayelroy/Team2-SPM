import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useParticleOrb } from './useParticleOrb';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A 2D context recording just the calls the orb makes. */
function fakeContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
  };
}

let ctx: ReturnType<typeof fakeContext>;
/** Queued animation frames by id, so cancellation actually removes them. */
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  ctx = fakeContext();
  frames = new Map();
  nextFrameId = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  // jsdom lays everything out at zero; give the canvas a real box so the
  // sphere maths produces non-degenerate coordinates.
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  // Capture frame callbacks instead of running them, so each test drives the
  // animation loop by hand. Cancellation must really dequeue, otherwise a
  // torn-down loop would still appear to run.
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, cb);
      return nextFrameId;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((frameId: number) => frames.delete(frameId)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Runs the frames queued so far. */
function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(performance.now());
  }
}

function dispatchPointer(target: EventTarget, type: string, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
  });
  target.dispatchEvent(event);
}

function Harness({ withSpacer = true }: { withSpacer?: boolean }) {
  const { canvasRef, spacerRef } = useParticleOrb();
  return (
    <div data-testid="hero">
      <canvas ref={canvasRef} data-testid="orb" />
      <p>hero copy</p>
      {withSpacer ? <div ref={spacerRef} data-testid="spacer" /> : null}
    </div>
  );
}

test('builds the sphere and draws a frame', () => {
  render(<Harness />);
  expect(ctx.setTransform).toHaveBeenCalled();

  tick();
  expect(ctx.clearRect).toHaveBeenCalled();
  expect(ctx.arc.mock.calls.length).toBeGreaterThan(0);
  expect(ctx.arc.mock.calls.every(([x, y, radius]) =>
    Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius) && radius > 0,
  )).toBe(true);
  expect(ctx.fill).toHaveBeenCalled();
});

test('grows the spacer so the sphere clears the hero copy', () => {
  const { getByTestId } = render(<Harness />);
  // The spacer's ref lands after the canvas's, so the height is set by the
  // re-measure the hook schedules for the next frame.
  tick();
  expect(parseFloat(getByTestId('spacer').style.height)).toBeGreaterThan(0);
});

test('renders without a spacer or a reported device scale', () => {
  vi.stubGlobal('devicePixelRatio', undefined);
  const { getByTestId } = render(<Harness withSpacer={false} />);
  expect(() => tick()).not.toThrow();
  expect(getByTestId('orb')).toHaveAttribute('width', '800');
  expect(getByTestId('orb')).toHaveAttribute('height', '600');
  expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
});

test('hover repels particles, pressing attracts them, and release/leave reset the force', () => {
  // Compare the same particle at the same frame in fresh runs. This separates
  // pointer movement from the sphere's ordinary rotation without copying its physics.
  function positionAfter(events: string[]) {
    const { getByTestId, unmount } = render(<Harness />);
    tick();
    const [x, y] = ctx.arc.mock.calls.at(-1) as [number, number, number, number, number];
    for (const event of events) {
      dispatchPointer(event === 'pointerup' ? window : getByTestId('hero'), event, x - 20, y);
    }
    ctx.arc.mockClear();
    tick();
    const [nextX, nextY] = ctx.arc.mock.calls.at(-1) as [number, number, number, number, number];
    unmount();
    return [nextX, nextY];
  }

  const resting = positionAfter([]);
  const hovering = positionAfter(['pointermove']);
  const pressed = positionAfter(['pointerdown']);
  expect(hovering[0]).toBeGreaterThan(resting[0]);
  expect(pressed[0]).toBeLessThan(resting[0]);
  expect(positionAfter(['pointerdown', 'pointerup'])).toEqual(hovering);
  expect(positionAfter(['pointerdown', 'pointerleave'])).toEqual(resting);
});

test('rebuilds on resize', () => {
  const { getByTestId } = render(<Harness />);
  vi.mocked(HTMLCanvasElement.prototype.getBoundingClientRect).mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 300,
    width: 400, height: 300, toJSON: () => ({}),
  });
  fireEvent(window, new Event('resize'));
  expect(getByTestId('orb')).toHaveAttribute('width', '400');
  expect(getByTestId('orb')).toHaveAttribute('height', '300');
  ctx.clearRect.mockClear();
  tick();
  expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 400, 300);
});

test('stops the loop and detaches listeners on unmount', () => {
  const removeFromWindow = vi.spyOn(window, 'removeEventListener');
  const { unmount } = render(<Harness />);
  tick();
  unmount();

  expect(cancelAnimationFrame).toHaveBeenCalled();
  expect(removeFromWindow).toHaveBeenCalledWith('resize', expect.any(Function));

  // The loop stops rescheduling itself, so nothing further is drawn.
  ctx.clearRect.mockClear();
  tick();
  expect(ctx.clearRect).not.toHaveBeenCalled();
  ctx.setTransform.mockClear();
  vi.advanceTimersByTime(300);
  expect(ctx.setTransform).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

test('keeps animating under StrictMode', () => {
  // StrictMode double-invokes effects but not callback refs, so teardown must
  // not live in an effect cleanup — that would stop the loop on the simulated
  // unmount with nothing left to restart it.
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  tick();
  ctx.clearRect.mockClear();
  tick();
  expect(ctx.clearRect).toHaveBeenCalled();
});

test('no-ops when the host has no 2D context', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  expect(() => render(<Harness />)).not.toThrow();
  expect(ctx.setTransform).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

test('does not start drawing or schedule work for a detached canvas', () => {
  const { result } = renderHook(() => useParticleOrb());
  result.current.canvasRef(document.createElement('canvas'));
  expect(ctx.setTransform).not.toHaveBeenCalled();
  expect(ctx.arc).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
