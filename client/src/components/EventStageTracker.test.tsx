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
    stage: 'Approved — In Planning',
    stage_key: 'in_planning',
    description: 'Event approved; coordinator is actively arranging venue and equipment.',
    waiting_on: {
      persona: 'Event Coordinator (Elroy Tay)',
      action: 'Complete venue suitability check and equipment reservation',
      user_id: 'coord-1',
    },
    stepper_steps: [
      { key: 'draft', label: 'Draft', status: 'completed' },
      { key: 'submitted', label: 'Submitted', status: 'completed' },
      { key: 'under_review', label: 'Under Review', status: 'completed' },
      { key: 'in_planning', label: 'Approved — In Planning', status: 'current' },
      { key: 'confirmed', label: 'Confirmed', status: 'upcoming' },
    ],
    arrangements_recheck_needed: true,
    outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
  };

  test('renders plain-language stage badge, description, and recheck indicator (AC 1)', () => {
    render(<EventStageTracker stage={mockPlanningStage} />);

    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Approved — In Planning');
    expect(
      screen.getByText('Event approved; coordinator is actively arranging venue and equipment.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Arrangements Recheck Needed')).toBeInTheDocument();
  });

  test('renders all 5 stepper steps with proper completion and current step states', () => {
    render(<EventStageTracker stage={mockPlanningStage} />);

    expect(screen.getByRole('list', { name: 'Lifecycle steps' })).toBeInTheDocument();
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(5);

    // Draft, Submitted, Under Review are completed -> have checkmark
    expect(listItems[0]).toHaveTextContent('Draft');
    expect(listItems[0]).toHaveTextContent('✓');

    expect(listItems[1]).toHaveTextContent('Submitted');
    expect(listItems[1]).toHaveTextContent('✓');

    expect(listItems[2]).toHaveTextContent('Under Review');
    expect(listItems[2]).toHaveTextContent('✓');

    // In Planning is current -> aria-current="step"
    expect(listItems[3]).toHaveAttribute('aria-current', 'step');
    expect(listItems[3]).toHaveTextContent('Approved — In Planning');
    expect(listItems[3]).toHaveTextContent('4');

    // Confirmed is upcoming -> step 5
    expect(listItems[4]).not.toHaveAttribute('aria-current');
    expect(listItems[4]).toHaveTextContent('Confirmed');
    expect(listItems[4]).toHaveTextContent('5');
  });

  test('renders prominent Waiting On card with persona and action (AC 2)', () => {
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

  test('renders completed/confirmed stage when waiting_on is null', () => {
    const mockConfirmedStage: EventStageResult = {
      event_id: 102,
      raw_status: 'confirmed',
      stage: 'Confirmed',
      stage_key: 'confirmed',
      description: 'Event confirmed; all arrangements and reservations finalized.',
      waiting_on: null,
      stepper_steps: [
        { key: 'draft', label: 'Draft', status: 'completed' },
        { key: 'submitted', label: 'Submitted', status: 'completed' },
        { key: 'under_review', label: 'Under Review', status: 'completed' },
        { key: 'in_planning', label: 'Approved — In Planning', status: 'completed' },
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
