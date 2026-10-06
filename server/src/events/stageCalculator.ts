export interface EventStageInput {
  event_id: number;
  status: string;
  coordinator_id?: string | null;
  coordinator_name?: string | null;
  organiser_id?: string | null;
  arrangements_recheck_needed?: boolean;
  /** SG2-100 AC3: 'safety_check' is a recognised entry alongside the existing values. */
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

// SG2-100 Unit 1: 7 steps, up from 5. `submitted` no longer has its own step —
// after Unit 2's submission redirect lands, `submitted` always means
// "assigned, awaiting review" and sits at the `under_review` step; until
// then both branches of the `submitted` case below point at that same step.
const STEPPER_DEFINITIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'unassigned', label: 'Awaiting Assignment' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'in_planning', label: 'Arrangements' },
  { key: 'safety_check', label: 'Safety Check' },
  { key: 'preparation', label: 'Preparation' },
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

    case 'unassigned':
      // SG2-100: real stored status, not a derived view of submitted + null
      // coordinator — gives the assignment queue an indexable predicate.
      stage = 'Awaiting Assignment';
      stageKey = 'unassigned';
      description = 'Event request submitted and awaiting coordinator assignment by the Event Coordinator Lead.';
      waitingOn = {
        persona: 'Event Coordinator Lead',
        action: 'Assign an event coordinator',
        user_id: null
      };
      activeStepIndex = 1;
      break;

    case 'submitted':
      // Kept for Unit 1: pre-existing rows may still carry 'submitted' with
      // no coordinator (sniffed below). Unit 2 removes this branch once
      // submission writes 'unassigned' and 'submitted' always means
      // "assigned, awaiting review". Both branches share the same stepper
      // position — there is no dedicated "Submitted" step any more.
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

    case 'needs_clarification':
      // SG2-36: still at the review step, but the ball is now with the
      // organiser — the coordinator has asked a question and is waiting for
      // an answer and an amended resubmission.
      stage = 'Clarification Needed';
      stageKey = 'needs_clarification';
      description = 'The coordinator has asked a question; the organiser needs to answer and resubmit.';
      waitingOn = {
        persona: 'Event Organiser',
        action: 'Answer the coordinator and resubmit the request',
        user_id: event.organiser_id ?? null
      };
      activeStepIndex = 2;
      break;

    case 'approved':
    case 'planning':
      // SG2-100: relabelled "Arrangements" — "Planning" next to the new
      // "Preparation" stage would be meaningless to a user. stage_key stays
      // 'in_planning' so no client keying breaks.
      stage = 'Arrangements';
      stageKey = 'in_planning';
      description = 'Event approved; coordinator is actively arranging venue and equipment.';
      waitingOn = {
        persona: coordinatorPersona,
        action: 'Complete venue suitability check and equipment reservation',
        user_id: event.coordinator_id ?? null
      };
      activeStepIndex = 3;
      break;

    case 'awaiting_safety_check':
      // SG2-100: writer lands with SG2-91; this unit only adds the display.
      stage = 'Awaiting Safety Check';
      stageKey = 'awaiting_safety_check';
      description = 'Arrangements complete; awaiting the Safety Officer’s operational safety check.';
      waitingOn = {
        persona: 'Safety Officer',
        action: 'Complete the operational safety check',
        user_id: null
      };
      activeStepIndex = 4;
      break;

    case 'safety_rejected':
      // SG2-100: a stop, not a recoverable waiting-on — the event cannot move
      // on to Preparation (SG2-92 AC4). SG2-93's Request Changes decision is
      // the separate, recoverable path and does carry a waiting-on.
      stage = 'Safety Rejected';
      stageKey = 'safety_rejected';
      description = 'The operational safety check was not passed; the event cannot proceed to Preparation.';
      waitingOn = null;
      activeStepIndex = 4;
      break;

    case 'preparation':
      stage = 'Preparation';
      stageKey = 'preparation';
      description = 'Safety check passed; coordinator is completing final preparations ahead of confirmation.';
      waitingOn = {
        persona: coordinatorPersona,
        action: 'Complete final preparations and confirm the event',
        user_id: event.coordinator_id ?? null
      };
      activeStepIndex = 5;
      break;

    case 'confirmed':
      stage = 'Confirmed';
      stageKey = 'confirmed';
      description = 'Event confirmed; all arrangements and reservations finalized.';
      waitingOn = null;
      activeStepIndex = 6;
      allCompleted = true;
      break;

    case 'completed':
      stage = 'Completed';
      stageKey = 'completed';
      description = 'Event successfully concluded.';
      waitingOn = null;
      activeStepIndex = 6;
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
