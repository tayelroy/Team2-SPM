export interface EventStageInput {
  event_id: number;
  status: string;
  coordinator_id?: string | null;
  coordinator_name?: string | null;
  organiser_id?: string | null;
  arrangements_recheck_needed?: boolean;
  outstanding_arrangements?: string[];
}

export interface EventWaitingOn {
  persona: string | null;
  action: string | null;
  user_id?: string | null;
}

export interface StepperStep {
  key: string;
  label: string;
  status: 'completed' | 'current' | 'upcoming';
}

export interface EventStageResult {
  event_id: number;
  raw_status: string;
  stage: string;
  stage_key: string;
  description: string;
  waiting_on: EventWaitingOn | null;
  stepper_steps: StepperStep[];
  arrangements_recheck_needed: boolean;
  outstanding_arrangements: string[];
}

const STEPPER_DEFINITIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'in_planning', label: 'Approved — In Planning' },
  { key: 'confirmed', label: 'Confirmed' }
];

/**
 * Computes plain-language lifecycle stage, waiting-on responsibility,
 * and stepper progress for an event (SG2-38).
 */
export function computeEventStage(event: EventStageInput): EventStageResult {
  const status = (event.status || 'draft').toLowerCase();
  const coordinatorName = event.coordinator_name?.trim();
  const coordinatorPersona = coordinatorName
    ? `Event Coordinator (${coordinatorName})`
    : 'Event Coordinator';

  let stage: string;
  let stageKey: string;
  let description: string;
  let waitingOn: EventWaitingOn | null = null;
  let activeStepIndex = 0;
  let allCompleted = false;

  switch (status) {
    case 'draft':
      stage = 'Draft';
      stageKey = 'draft';
      description = 'Draft event request in preparation by organiser.';
      waitingOn = {
        persona: 'Event Organiser',
        action: 'Complete and submit event request',
        user_id: event.organiser_id ?? null
      };
      activeStepIndex = 0;
      break;

    case 'submitted':
      if (event.coordinator_id) {
        // Coordinator has already been assigned — request is under intake review
        stage = 'Under Review';
        stageKey = 'under_review';
        description = 'Event request under review by the assigned coordinator.';
        waitingOn = {
          persona: coordinatorPersona,
          action: 'Review and assess event request',
          user_id: event.coordinator_id
        };
        activeStepIndex = 2;
      } else {
        // Awaiting coordinator assignment by staff
        stage = 'Submitted';
        stageKey = 'submitted';
        description = 'Event request submitted and awaiting coordinator assignment.';
        waitingOn = {
          persona: 'ConnectSphere Staff',
          action: 'Assign event coordinator',
          user_id: null
        };
        activeStepIndex = 1;
      }
      break;

    case 'under_review':
      stage = 'Under Review';
      stageKey = 'under_review';
      description = 'Event request under review by the assigned coordinator.';
      waitingOn = {
        persona: coordinatorPersona,
        action: 'Review and assess event request',
        user_id: event.coordinator_id ?? null
      };
      activeStepIndex = 2;
      break;

    case 'approved':
    case 'planning':
      stage = 'Approved — In Planning';
      stageKey = 'in_planning';
      description = 'Event approved; coordinator is actively arranging venue and equipment.';
      waitingOn = {
        persona: coordinatorPersona,
        action: 'Complete venue suitability check and equipment reservation',
        user_id: event.coordinator_id ?? null
      };
      activeStepIndex = 3;
      break;

    case 'confirmed':
      stage = 'Confirmed';
      stageKey = 'confirmed';
      description = 'Event confirmed; all arrangements and reservations finalized.';
      waitingOn = null;
      activeStepIndex = 4;
      allCompleted = true;
      break;

    case 'completed':
      stage = 'Completed';
      stageKey = 'completed';
      description = 'Event successfully concluded.';
      waitingOn = null;
      activeStepIndex = 5;
      allCompleted = true;
      break;

    case 'cancelled':
      stage = 'Cancelled';
      stageKey = 'cancelled';
      description = 'Event cancelled.';
      waitingOn = null;
      activeStepIndex = -1;
      break;

    case 'rejected':
      stage = 'Rejected';
      stageKey = 'rejected';
      description = 'Event request was not approved.';
      waitingOn = null;
      activeStepIndex = -1;
      break;

    default:
      stage = status.charAt(0).toUpperCase() + status.slice(1);
      stageKey = status;
      description = `Event is currently ${status}.`;
      waitingOn = null;
      activeStepIndex = 0;
  }

  const stepper_steps: StepperStep[] = STEPPER_DEFINITIONS.map((def, idx) => {
    if (allCompleted) {
      return { ...def, status: 'completed' };
    }
    if (activeStepIndex === -1) {
      // Terminal states (cancelled / rejected)
      return { ...def, status: 'upcoming' };
    }
    if (idx < activeStepIndex) {
      return { ...def, status: 'completed' };
    }
    if (idx === activeStepIndex) {
      return { ...def, status: 'current' };
    }
    return { ...def, status: 'upcoming' };
  });

  return {
    event_id: event.event_id,
    raw_status: status,
    stage,
    stage_key: stageKey,
    description,
    waiting_on: waitingOn,
    stepper_steps,
    arrangements_recheck_needed: Boolean(event.arrangements_recheck_needed),
    outstanding_arrangements: Array.isArray(event.outstanding_arrangements)
      ? event.outstanding_arrangements
      : []
  };
}
