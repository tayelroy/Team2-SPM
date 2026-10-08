import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
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
      'None (Planning completed)',
    );
    expect(screen.getByTestId('waiting-on-action')).toHaveTextContent(
      'No further actions pending. All lifecycle requirements are satisfied.',
    );
    expect(screen.queryByText('Arrangements Recheck Needed')).not.toBeInTheDocument();
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

  test('[BOUNDARY] [SG2-100:AC9] the step track scrolls on a narrow viewport rather than squashing or overflowing the page', () => {
    render(<EventStageTracker stage={safetyStage} />);
    const track = screen.getByTestId('stepper-track');
    // The track owns the horizontal scroll, so seven steps never push the
    // surrounding page sideways at 390px.
    expect(track).toHaveStyle({ overflowX: 'auto' });
    // Each step keeps a legible floor width, so seven of them are wider than
    // a 390px viewport and the track above is what absorbs the difference.
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveStyle({ 'min-width': '95px' });
    }
  });

  test('[FAILURE] [SG2-100:AC5] a stage with nobody waiting on it renders without a responsibility card', () => {
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
  });

  test('[CONFLICT] [SG2-100:AC5] an empty stepper payload renders nothing rather than throwing', () => {
    render(<EventStageTracker stage={{ ...safetyStage, stepper_steps: [] }} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Awaiting Safety Check');
  });
});
