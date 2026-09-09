import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useInertiaScroll } from './useInertiaScroll';

/** Queued animation frames by id, so cancellation actually removes them. */
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

beforeEach(() => {
  frames = new Map();
  nextFrameId = 0;
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
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Drives the easing loop for a number of frames. */
function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(performance.now());
  }
}

function Harness({ withTrack = true }: { withTrack?: boolean }) {
  const containerRef = useInertiaScroll();
  return (
    <div ref={containerRef} data-testid="container">
      {withTrack ? <div data-testid="track">content</div> : null}
    </div>
  );
}

/** jsdom reports no layout, so declare the scrollable overflow explicitly. */
function setScrollable(
  container: HTMLElement,
  track: HTMLElement,
  { trackHeight = 3000, viewport = 800 } = {},
) {
  Object.defineProperty(track, 'scrollHeight', {
    configurable: true,
    value: trackHeight,
  });
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    value: viewport,
  });
}

function offsetOf(track: HTMLElement) {
  const match = /translate3d\(0,(-?[\d.]+)px,0\)/.exec(track.style.transform);
  return match ? Number(match[1]) : 0;
}

/**
 * Runs well past the point where the easing snaps onto its target (the loop
 * needs roughly 120 frames to close a full-page gap) and returns the offset.
 */
function settle(track: HTMLElement) {
  tick(400);
  return offsetOf(track);
}

test('eases the track toward the wheel target', () => {
  const { getByTestId } = render(<Harness />);
  const container = getByTestId('container');
  const track = getByTestId('track');
  setScrollable(container, track);

  fireEvent.wheel(container, { deltaY: 500 });
  tick();
  const first = offsetOf(track);
  // Easing means it approaches the target rather than jumping to it.
  expect(first).toBeLessThan(0);
  expect(first).toBeGreaterThan(-500);

  expect(settle(track)).toBe(-500);
});

test('clamps at the top and bottom of the content', () => {
  const { getByTestId } = render(<Harness />);
  const container = getByTestId('container');
  const track = getByTestId('track');
  setScrollable(container, track);

  // Scrolling up at the top is left to the browser.
  fireEvent.wheel(container, { deltaY: -200 });
  expect(settle(track)).toBe(0);

  // Past the end, the offset stops at the maximum (3000 - 800).
  fireEvent.wheel(container, { deltaY: 99999 });
  expect(settle(track)).toBe(-2200);

  fireEvent.wheel(container, { deltaY: 200 });
  expect(settle(track)).toBe(-2200);
});

test('touch dragging scrolls the track', () => {
  const { getByTestId } = render(<Harness />);
  const container = getByTestId('container');
  const track = getByTestId('track');
  setScrollable(container, track);

  fireEvent.touchStart(container, { touches: [{ clientY: 500 }] });
  fireEvent.touchMove(container, { touches: [{ clientY: 400 }] });
  // 100px of drag is amplified by 1.6.
  expect(settle(track)).toBe(-160);
});

test('does nothing when the content fits', () => {
  const { getByTestId } = render(<Harness />);
  const container = getByTestId('container');
  const track = getByTestId('track');
  setScrollable(container, track, { trackHeight: 400, viewport: 800 });

  fireEvent.wheel(container, { deltaY: 300 });
  fireEvent.touchStart(container, { touches: [{ clientY: 500 }] });
  fireEvent.touchMove(container, { touches: [{ clientY: 100 }] });
  tick(10);
  expect(offsetOf(track)).toBe(0);
});

test('re-measures on resize', () => {
  const { getByTestId } = render(<Harness />);
  const container = getByTestId('container');
  const track = getByTestId('track');
  setScrollable(container, track);

  fireEvent.wheel(container, { deltaY: 99999 });
  expect(settle(track)).toBe(-2200);

  // Shrinking the content pulls the target back within range.
  setScrollable(container, track, { trackHeight: 1200, viewport: 800 });
  fireEvent(window, new Event('resize'));
  expect(settle(track)).toBe(-400);
});

test('keeps easing under StrictMode', () => {
  // See the matching note in useParticleOrb.test.tsx — an effect cleanup here
  // would kill the loop on StrictMode's simulated unmount.
  const { getByTestId } = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const container = getByTestId('container');
  const track = getByTestId('track');
  setScrollable(container, track);

  fireEvent.wheel(container, { deltaY: 500 });
  expect(settle(track)).toBe(-500);
});

test('no-ops without a track child', () => {
  expect(() => render(<Harness withTrack={false} />)).not.toThrow();
});

test('stops the loop and detaches listeners on unmount', () => {
  const removeFromWindow = vi.spyOn(window, 'removeEventListener');
  const { unmount } = render(<Harness />);
  tick();
  unmount();

  expect(cancelAnimationFrame).toHaveBeenCalled();
  expect(removeFromWindow).toHaveBeenCalledWith('resize', expect.any(Function));
});
