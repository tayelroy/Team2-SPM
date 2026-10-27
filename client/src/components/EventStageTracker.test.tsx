import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import EventStageTracker from './EventStageTracker';
import type { EventStageResult } from '../api/eventRequests';

afterEach(() => {
  cleanup();
});

describe('EventStageTracker (SG2-38)', () => {
  const mockPlanningStage: EventStageResult = {
    event_id: 101,
    raw_status: 'planning',
    stage: 'Arrangements',
    stage_key: 'in_planning',
    description: 'Event approved; coordinator is actively arranging venue and equipment.',
    waiting_on: {
      persona: 'Event Coordinator (Elroy Tay)',
      action: 'Complete venue suitability check and equipment reservation',
      user_id: 'coord-1',
    },
    stepper_steps: [
      { key: 'draft', label: 'Draft', status: 'completed' },
      { key: 'unassigned', label: 'Awaiting Assignment', status: 'completed' },
      { key: 'under_review', label: 'Under Review', status: 'completed' },
      { key: 'in_planning', label: 'Arrangements', status: 'current' },
      { key: 'safety_check', label: 'Safety Check', status: 'upcoming' },
      { key: 'preparation', label: 'Preparation', status: 'upcoming' },
      { key: 'confirmed', label: 'Confirmed', status: 'upcoming' },
    ],
    arrangements_recheck_needed: true,
    outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
  };

  test('[NORMAL] [SG2-38:AC1] renders plain-language stage badge, description, and recheck indicator (AC 1)', () => {
    render(<EventStageTracker stage={mockPlanningStage} />);

    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Arrangements');
    expect(
      screen.getByText('Event approved; coordinator is actively arranging venue and equipment.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Arrangements Recheck Needed')).toBeInTheDocument();
  });

  test('[NORMAL] [SG2-100:AC5] renders all 7 stepper steps with proper completion and current step states', () => {
    render(<EventStageTracker stage={mockPlanningStage} />);

    expect(screen.getByRole('list', { name: 'Lifecycle steps' })).toBeInTheDocument();
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(7);

    // Draft, Awaiting Assignment, Under Review are completed -> have checkmark
    expect(listItems[0]).toHaveTextContent('Draft');
    expect(listItems[0]).toHaveTextContent('✓');

    expect(listItems[1]).toHaveTextContent('Awaiting Assignment');
    expect(listItems[1]).toHaveTextContent('✓');

    expect(listItems[2]).toHaveTextContent('Under Review');
    expect(listItems[2]).toHaveTextContent('✓');

    // Arrangements is current -> aria-current="step"
    expect(listItems[3]).toHaveAttribute('aria-current', 'step');
    expect(listItems[3]).toHaveTextContent('Arrangements');
    expect(listItems[3]).toHaveTextContent('4');

    // Safety Check, Preparation, Confirmed are upcoming -> steps 5, 6, 7
    expect(listItems[4]).not.toHaveAttribute('aria-current');
    expect(listItems[4]).toHaveTextContent('Safety Check');
    expect(listItems[4]).toHaveTextContent('5');

    expect(listItems[5]).not.toHaveAttribute('aria-current');
    expect(listItems[5]).toHaveTextContent('Preparation');
    expect(listItems[5]).toHaveTextContent('6');

    expect(listItems[6]).not.toHaveAttribute('aria-current');
    expect(listItems[6]).toHaveTextContent('Confirmed');
    expect(listItems[6]).toHaveTextContent('7');
  });

  test('[NORMAL] [SG2-38:AC2] renders prominent Waiting On card with persona and action (AC 2)', () => {
    render(<EventStageTracker stage={mockPlanningStage} />);

    const waitingOnCard = screen.getByTestId('waiting-on-card');
    expect(waitingOnCard).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-persona')).toHaveTextContent(
      'Event Coordinator (Elroy Tay)',
    );
    expect(screen.getByTestId('waiting-on-action')).toHaveTextContent(
      'Next step: Complete venue suitability check and equipment reservation',
    );
  });

  test('[BOUNDARY] [SG2-38:AC3] renders completed/confirmed stage when waiting_on is null', () => {
    const mockConfirmedStage: EventStageResult = {
      event_id: 102,
      raw_status: 'confirmed',
      stage: 'Confirmed',
      stage_key: 'confirmed',
      description: 'Event confirmed; all arrangements and reservations finalized.',
      waiting_on: null,
      stepper_steps: [
        { key: 'draft', label: 'Draft', status: 'completed' },
        { key: 'unassigned', label: 'Awaiting Assignment', status: 'completed' },
        { key: 'under_review', label: 'Under Review', status: 'completed' },
        { key: 'in_planning', label: 'Arrangements', status: 'completed' },
        { key: 'safety_check', label: 'Safety Check', status: 'completed' },
        { key: 'preparation', label: 'Preparation', status: 'completed' },
        { key: 'confirmed', label: 'Confirmed', status: 'completed' },
      ],
      arrangements_recheck_needed: false,
      outstanding_arrangements: [],
    };

    render(<EventStageTracker stage={mockConfirmedStage} />);

    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Confirmed');
    expect(screen.getByTestId('waiting-on-persona')).toHaveTextContent(
      'No active next step',
    );
    expect(screen.getByTestId('waiting-on-action')).toHaveTextContent(
      'Event confirmed; all arrangements and reservations finalized.',
    );
    expect(screen.queryByText('Arrangements Recheck Needed')).not.toBeInTheDocument();
  });

  test.each([
    ['cancelled', 'Cancelled', 'Event cancelled.'],
    ['completed', 'Completed', 'Event successfully concluded.'],
    ['rejected', 'Rejected', 'Event request was not approved.'],
    ['on_hold', 'On_hold', 'Event is currently on_hold.'],
  ])('[BOUNDARY] [SG2-38:AC1] [SG2-38:AC3] a %s stage without a next actor uses its actual description rather than claiming planning completed', (raw_status, name, description) => {
    render(<EventStageTracker stage={{ ...mockPlanningStage, raw_status, stage: name, stage_key: raw_status, description, waiting_on: null }} />);
    expect(screen.getByTestId('stage-badge')).toHaveTextContent(name);
    expect(screen.getByTestId('waiting-on-persona')).toHaveTextContent('No active next step');
    expect(screen.getByTestId('waiting-on-action')).toHaveTextContent(description);
    expect(screen.queryByText('None (Planning completed)')).not.toBeInTheDocument();
    expect(screen.queryByText('No further actions pending. All lifecycle requirements are satisfied.')).not.toBeInTheDocument();
  });
});

describe('EventStageTracker at seven steps (SG2-100 AC9)', () => {
  const SEVEN_STEP_LABELS = [
    'Draft',
    'Awaiting Assignment',
    'Under Review',
    'Arrangements',
    'Safety Check',
    'Preparation',
    'Confirmed',
  ];

  const safetyStage: EventStageResult = {
    event_id: 202,
    raw_status: 'awaiting_safety_check',
    stage: 'Awaiting Safety Check',
    stage_key: 'awaiting_safety_check',
    description: 'Arrangements are complete; the Safety Officer has the operational safety check.',
    waiting_on: {
      persona: 'Safety Officer',
      action: 'Complete the operational safety check',
      user_id: null,
    },
    stepper_steps: [
      { key: 'draft', label: 'Draft', status: 'completed' },
      { key: 'unassigned', label: 'Awaiting Assignment', status: 'completed' },
      { key: 'under_review', label: 'Under Review', status: 'completed' },
      { key: 'in_planning', label: 'Arrangements', status: 'completed' },
      { key: 'safety_check', label: 'Safety Check', status: 'current' },
      { key: 'preparation', label: 'Preparation', status: 'upcoming' },
      { key: 'confirmed', label: 'Confirmed', status: 'upcoming' },
    ],
    arrangements_recheck_needed: false,
    outstanding_arrangements: [],
  };

  test('[NORMAL] [SG2-100:AC5] all seven steps render with their plain-language labels, in order', () => {
    render(<EventStageTracker stage={safetyStage} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(7);
    // Completed steps show a tick instead of their number.
    expect(items.map((item) => item.textContent)).toEqual([
      '✓Draft',
      '✓Awaiting Assignment',
      '✓Under Review',
      '✓Arrangements',
      '5Safety Check',
      '6Preparation',
      '7Confirmed',
    ]);
    expect(items.map((item) => item.textContent?.replace(/^(✓|\d)/, ''))).toEqual(SEVEN_STEP_LABELS);
    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Awaiting Safety Check');
    expect(items[4]).toHaveAttribute('aria-current', 'step');
  });

  test('[FAILURE] [SG2-100:AC5] a failed safety check is never described as completed planning', () => {
    render(
      <EventStageTracker
        stage={{
          ...safetyStage,
          raw_status: 'safety_rejected',
          stage: 'Safety Rejected',
          stage_key: 'safety_rejected',
          description: 'The operational safety check was not passed.',
          waiting_on: null,
        }}
      />,
    );
    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Safety Rejected');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByTestId('waiting-on-persona')).toHaveTextContent('No active next step');
    expect(screen.getByTestId('waiting-on-action')).toHaveTextContent('The operational safety check was not passed.');
    expect(screen.queryByText('No further actions pending. All lifecycle requirements are satisfied.')).not.toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-100:AC5] an empty stepper payload renders nothing rather than throwing', () => {
    render(<EventStageTracker stage={{ ...safetyStage, stepper_steps: [] }} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Awaiting Safety Check');
  });
});

describe('EventStageTracker on a phone-width track (SG2-38)', () => {
  // jsdom has no layout, so the track and step geometry of a 390px phone
  // (measured in Chromium: a 274px track holding seven 95px steps with 8px
  // gaps, 713px in all) is supplied through the element size getters.
  const STEP = 95;
  const GAP = 8;
  const CONTENT = 7 * STEP + 6 * GAP;
  let trackWidth = 274;

  beforeEach(() => {
    trackWidth = 274;
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'listitem'
        ? Array.from(this.parentElement!.children).indexOf(this) * (STEP + GAP)
        : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'listitem' ? STEP : 0;
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.getAttribute('data-testid') === 'stepper-track' ? trackWidth : 0;
    });
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
      return this.getAttribute('data-testid') === 'stepper-track' ? Math.max(CONTENT, trackWidth) : 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stageAt = (current: number): EventStageResult => ({
    event_id: 42,
    raw_status: 'planning',
    stage: 'Arrangements',
    stage_key: 'in_planning',
    description: 'Event approved; coordinator is actively arranging venue and equipment.',
    waiting_on: null,
    stepper_steps: ['draft', 'unassigned', 'under_review', 'in_planning', 'safety_check', 'preparation', 'confirmed']
      .map((key, idx) => ({
        key,
        label: key,
        status: idx < current ? 'completed' : idx === current ? 'current' : 'upcoming',
      })),
    arrangements_recheck_needed: false,
    outstanding_arrangements: [],
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-100:AC5] the current step is scrolled to the middle of the track, never by scrolling the page', () => {
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(<EventStageTracker stage={stageAt(3)} />);
    const track = screen.getByTestId('stepper-track');
    // Arrangements starts at 3 × 103 = 309px, past the 274px track; centred
    // it sits at 309 − (274 − 95) / 2.
    expect(track.scrollLeft).toBe(219.5);
    expect(pageScroll).not.toHaveBeenCalled();
    expect(screen.getByTestId('stepper-scroll-hint')).toHaveTextContent('Swipe sideways to see all 7 steps.');
  });

  test('[BOUNDARY] [SG2-38:AC1] [SG2-100:AC5] the hint follows the track as it is scrolled to an end and as the window resizes', () => {
    render(<EventStageTracker stage={stageAt(1)} />);
    const track = screen.getByTestId('stepper-track');
    // Awaiting Assignment: 103 − (274 − 95) / 2.
    expect(track.scrollLeft).toBe(13.5);
    expect(screen.getByTestId('stepper-scroll-hint')).toBeInTheDocument();

    // Scrolled fully to the end: only the start fades, where steps are hidden.
    track.scrollLeft = CONTENT - trackWidth;
    fireEvent.scroll(track);
    expect(screen.getByTestId('stepper-scroll-hint')).toBeInTheDocument();

    // Back at the very start: only the end fades.
    track.scrollLeft = 0;
    fireEvent.scroll(track);
    expect(screen.getByTestId('stepper-scroll-hint')).toBeInTheDocument();

    // Turned to a laptop width the steps all fit: nothing scrolls, fades or hints.
    trackWidth = 1200;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(track.scrollLeft).toBe(0);
    expect(screen.queryByTestId('stepper-scroll-hint')).not.toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-38:AC1] a last current step is scrolled no further than the end of the track', () => {
    render(<EventStageTracker stage={stageAt(6)} />);
    // Centring Confirmed would ask for 618 − 89.5 = 528.5; the track ends at 713 − 274.
    expect(screen.getByTestId('stepper-track').scrollLeft).toBe(439);
  });

  test('[FAILURE] [SG2-38:AC1] with no current step the track is left where it is', () => {
    render(<EventStageTracker stage={stageAt(7)} />);
    expect(screen.getByTestId('stepper-track').scrollLeft).toBe(0);
    expect(screen.getByTestId('stepper-scroll-hint')).toBeInTheDocument();
  });
});
