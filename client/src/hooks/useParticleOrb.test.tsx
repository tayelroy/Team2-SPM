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
});

/** Runs the frames queued so far. */
function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(performance.now());
  }
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
  // One arc per particle, and the count scales with the canvas area.
  expect(ctx.arc.mock.calls.length).toBeGreaterThan(2000);
  expect(ctx.fill).toHaveBeenCalled();
});

test('grows the spacer so the sphere clears the hero copy', () => {
  const { getByTestId } = render(<Harness />);
  // The spacer's ref lands after the canvas's, so the height is set by the
  // re-measure the hook schedules for the next frame.
  tick();
  expect(getByTestId('spacer').style.height).toMatch(/^\d+px$/);
});

test('renders without a spacer or a reported device scale', () => {
  vi.stubGlobal('devicePixelRatio', undefined);
  const { getByTestId } = render(<Harness withSpacer={false} />);
  expect(() => tick()).not.toThrow();
  expect(getByTestId('orb')).toHaveAttribute('width', '800');
  expect(getByTestId('orb')).toHaveAttribute('height', '600');
  expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
});

test('pointer interaction keeps frames rendering without errors', () => {
  const { getByTestId } = render(<Harness />);
  const hero = getByTestId('hero');
  tick();
  const restingCalls = ctx.arc.mock.calls.length;

  fireEvent.pointerMove(hero, { clientX: 400, clientY: 300 });
  tick();
  expect(ctx.arc.mock.calls.length).toBeGreaterThan(restingCalls);

  // Pressing inverts the force and widens the reach.
  fireEvent.pointerDown(hero, { clientX: 400, clientY: 300 });
  tick();
  fireEvent.pointerUp(window);
  tick();
  fireEvent.pointerLeave(hero);
  expect(() => tick()).not.toThrow();
});

test('rebuilds on resize', () => {
  render(<Harness />);
  ctx.setTransform.mockClear();
  fireEvent(window, new Event('resize'));
  expect(ctx.setTransform).toHaveBeenCalled();
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
});

test('does not start drawing or schedule work for a detached canvas', () => {
  const { result } = renderHook(() => useParticleOrb());
  result.current.canvasRef(document.createElement('canvas'));
  expect(ctx.setTransform).not.toHaveBeenCalled();
  expect(ctx.arc).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
