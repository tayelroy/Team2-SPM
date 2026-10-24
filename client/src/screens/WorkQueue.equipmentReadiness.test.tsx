import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WorkQueue from './WorkQueue';
import type { WorkItem } from '../api/workQueue';
import type { EquipmentRequirement, RequirementsView } from '../api/equipmentRequirements';
import type { EventArrangementsResult, PlanningEventRecord } from '../api/eventRequests';

// Reservation forms have a separate public-component suite. Keep the real
// requirements, readiness, planning drawer and queue together in this suite.
vi.mock('../components/EquipmentReservations', () => ({ default: () => null }));
// SG2-66: change requests and rechecks have their own suites and fetches.
vi.mock('../components/ArrangementRechecks', () => ({ default: () => null }));
vi.mock('../components/ChangeRequestsPanel', () => ({ default: () => null }));
// SG2-92: the safety decision summary has its own suites and fetch.
vi.mock('../components/SafetyDecisionSummary', () => ({ default: () => null }));
// SG2-93: the staff safety re-review panel has its own suites and fetch.
vi.mock('../components/SafetyRereviewQueue', () => ({ default: () => null }));

// jsdom has no scrolling implementation; the real drawer focuses save errors.
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); });

const EVENT: WorkItem = {
  kind: 'event', item_id: 17, event_id: 17, title: 'Planning readiness forum',
  event_name: 'Planning readiness forum', status: 'planning', category: 'assigned', assigned_to_me: true,
  starts_at: '2030-06-15T02:00:00Z', ends_at: null,
  details: { organisation: 'Harbour Trust', expected_attendance: 40, registration_needed: false, planning_notes: 'Stored notes' },
};
const REQUIREMENT: EquipmentRequirement = {
  request_id: 51, event_id: 17, equipment_id: 3, equipment_type: 'Projector', quantity: 1,
  status: 'pending', notes: null, arrangement_notes: null, shortfall: null,
  placement_venue_id: null, placement_venue_name: null, placement_position: null, version: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function readiness(requests: EquipmentRequirement[]): EventArrangementsResult {
  return {
    event_id: 17,
    arrangements: [{ key: 'equipment', label: 'Equipment', state: requests.length ? 'outstanding' : 'not_required',
      detail: requests.length ? `Equipment quantities need checking: ${requests[0].quantity} requested.` : 'No equipment requested.' }],
    outstanding: requests.length ? ['equipment'] : [], ready_for_confirmation: requests.length === 0,
  };
}

function fixture(options: { saveGate?: Promise<void>; readinessReplies?: (Promise<Response> | undefined)[]; failSave?: boolean } = {}) {
  const state = { requests: [] as EquipmentRequirement[], readinessReads: 0, queueReads: 0, requirementReads: 0 };
  const equipmentView = (): RequirementsView => ({
    event: { event_id: 17, name: EVENT.title, status: 'planning' }, requests: state.requests,
    equipment: [{ equipment_id: 3, type: 'Projector' }], venues: [], can_request: true, can_arrange: false,
  });
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.startsWith('/api/work-queue')) { state.queueReads++; return Response.json({ items: [EVENT] }); }
    if (url === '/api/venue-clashes') return Response.json({ clashes: [] });
    if (url === '/api/equipment-requests?event_id=17') { state.requirementReads++; return Response.json(equipmentView()); }
    if (url === '/api/event-requests/17/arrangements') {
      const index = state.readinessReads++;
      return options.readinessReplies?.[index] ?? Response.json(readiness(state.requests));
    }
    if ((url === '/api/equipment-requests' && init?.method === 'POST') || (url === '/api/equipment-requests/51' && init?.method === 'PATCH')) {
      if (options.failSave) return Response.json({ error: 'Service unavailable' }, { status: 503 });
      const values = JSON.parse(String(init!.body)) as { quantity: number; notes: string | null };
      state.requests = [{ ...REQUIREMENT, ...values, version: state.requests.length + 1 }];
      await options.saveGate;
      return Response.json(equipmentView());
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { state, fetch };
}

async function open() {
  render(<WorkQueue role="Event Coordinator" accessToken="coordinator-token" />);
  fireEvent.click(await screen.findByRole('button', { name: /Planning readiness forum/ }));
  await screen.findByText('No equipment requested.');
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Ready for confirmation');
}

function addRequirement() {
  fireEvent.click(screen.getByRole('button', { name: 'Add equipment requirement' }));
  fireEvent.change(screen.getByLabelText('Equipment type'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Quantity required'), { target: { value: '1' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Add equipment requirement' }));
}

test('[NORMAL] [SG2-53:AC2] [SG2-57:AC2] adding equipment immediately replaces not-required readiness with outstanding without refreshing the event', async () => {
  const { state } = fixture();
  await open();
  addRequirement();
  await screen.findByText('Equipment quantities need checking: 1 requested.');
  expect(within(screen.getByRole('region', { name: 'Event arrangement readiness' })).getByText('Equipment quantities need checking: 1 requested.')).toBeVisible();
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Arrangements outstanding');
  expect(screen.queryByText('No equipment requested.')).not.toBeInTheDocument();
  expect(state).toMatchObject({ readinessReads: 2, queueReads: 2, requirementReads: 1 });
});

test('[BOUNDARY] [SG2-39:AC1] [SG2-57:AC2] equipment success refreshes only readiness and preserves an unsaved planning drawer', async () => {
  const save = deferred<void>();
  const { state } = fixture({ saveGate: save.promise });
  await open();
  addRequirement();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Planning Information' }));
  fireEvent.change(screen.getByLabelText('Planning Notes (Internal Coordinator Log)'), { target: { value: 'Unsaved coordinator draft' } });
  await act(async () => save.resolve());
  await screen.findByText('Equipment quantities need checking: 1 requested.');
  expect(screen.getByLabelText('Planning Notes (Internal Coordinator Log)')).toHaveValue('Unsaved coordinator draft');
  expect(screen.getByRole('button', { name: 'Save Planning Details' })).toBeVisible();
  expect(state).toMatchObject({ readinessReads: 2, queueReads: 2, requirementReads: 1 });
});

test('[CONFLICT] [SG2-53:AC2] [SG2-57:AC2] editing equipment refreshes readiness again and a slower previous read cannot overwrite the latest quantity', async () => {
  const oldRead = deferred<Response>();
  const { state } = fixture({ readinessReplies: [undefined, oldRead.promise] });
  await open();
  addRequirement();
  await screen.findByText('Equipment requirement saved.');
  fireEvent.click(screen.getByRole('button', { name: 'Edit requirement for Projector' }));
  fireEvent.change(screen.getByLabelText('Quantity required'), { target: { value: '2' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Edit equipment requirement' }));
  await screen.findByText('Equipment quantities need checking: 2 requested.');
  await act(async () => oldRead.resolve(Response.json(readiness([REQUIREMENT]))));
  expect(screen.getByText('Equipment quantities need checking: 2 requested.')).toBeVisible();
  expect(screen.queryByText('Equipment quantities need checking: 1 requested.')).not.toBeInTheDocument();
  expect(state).toMatchObject({ readinessReads: 3, queueReads: 2, requirementReads: 1 });
});

test('[FAILURE] [SG2-53:AC2] [SG2-57:AC2] an unsuccessful equipment save preserves the draft and does not falsely change readiness', async () => {
  const { state } = fixture({ failSave: true });
  await open();
  addRequirement();
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Quantity required')).toHaveValue('1');
  expect(screen.getByText('No equipment requested.')).toBeVisible();
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Ready for confirmation');
  expect(state).toMatchObject({ readinessReads: 1, queueReads: 2, requirementReads: 1 });
});

test('[FAILURE] [SG2-57:AC2] a failed readiness refresh removes the obsolete ready badge after equipment has been saved', async () => {
  const { state } = fixture({ readinessReplies: [undefined, Promise.resolve(Response.json({ error: 'Service unavailable' }, { status: 503 }))] });
  await open();
  addRequirement();
  await screen.findByText('Equipment requirement saved.');
  await waitFor(() => expect(state.readinessReads).toBe(2));
  expect(screen.queryByText('No equipment requested.')).not.toBeInTheDocument();
  expect(screen.queryByTestId('readiness-badge')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Equipment requirement: Projector' })).toBeVisible();
});

function registrationFixture(failSave = false) {
  const base = fixture();
  let event: PlanningEventRecord = {
    event_id: 17, status: 'planning', proposed_date: EVENT.starts_at, expected_attendance: 40,
    venue_requirements: null, equipment_requirements: null, accessibility_needs: null,
    registration_needed: false, registration_capacity: null, registration_opens_at: null, registration_closes_at: null,
    planning_notes: 'Stored notes', arrangements_recheck_needed: false, outstanding_arrangements: [],
    expected_crowd_movement: null,
  };
  let readinessReads = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/event-requests/17/planning' && init?.method === 'PATCH') {
      if (failSave) return Response.json({ error: 'Planning service unavailable' }, { status: 503 });
      event = { ...event, ...JSON.parse(String(init.body)) };
      return Response.json({ event });
    }
    if (url === '/api/event-requests/17/arrangements') {
      readinessReads++;
      const configured = Boolean(event.registration_capacity && event.registration_opens_at && event.registration_closes_at);
      const result: EventArrangementsResult = {
        event_id: 17,
        arrangements: [{ key: 'registration', label: 'Registration',
          state: !event.registration_needed ? 'not_required' : configured ? 'ready' : 'outstanding',
          detail: !event.registration_needed ? 'Registration not required.' : configured
            ? 'Registration capacity and opening and closing times set.' : 'Registration opening and closing times are missing.' }],
        outstanding: event.registration_needed && !configured ? ['registration'] : [],
        ready_for_confirmation: !event.registration_needed || configured,
      };
      return Response.json(result);
    }
    // SG2-63's registration panel is covered elsewhere; 404 keeps it hidden.
    if (url === '/api/event-requests/17/registrations') return Response.json({ error: 'Event not found.' }, { status: 404 });
    return base.fetch(url, init);
  });
  vi.stubGlobal('fetch', fetch);
  return { state: base.state, fetch, readinessReads: () => readinessReads };
}

async function openRegistrationPlanning() {
  render(<WorkQueue role="Event Coordinator" accessToken="coordinator-token" />);
  fireEvent.click(await screen.findByRole('button', { name: /Planning readiness forum/ }));
  await screen.findByText('Registration not required.');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Planning Information' }));
  fireEvent.click(screen.getByRole('button', { name: 'Registration Disabled' }));
}

test('[NORMAL] [SG2-39:AC1] [SG2-57:AC2] [SG2-63:AC8] turning registration on saves only that, and it stays outstanding until the organiser sets capacity and times', async () => {
  const current = registrationFixture();
  await openRegistrationPlanning();
  expect(screen.queryByLabelText('Registration Capacity')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('epd-registration-settings')).getAllByText('Not set')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
  await screen.findByText('Registration opening and closing times are missing.');
  expect(screen.getByTestId('arrangement-registration-state')).toHaveTextContent('Outstanding');
  const save = current.fetch.mock.calls.find(([url, init]) => url === '/api/event-requests/17/planning' && init?.method === 'PATCH')!;
  const sent = JSON.parse(String(save[1]!.body)) as Record<string, unknown>;
  expect(sent.registration_needed).toBe(true);
  expect(Object.keys(sent).filter(key => /^registration_(capacity|opens_at|closes_at)$/.test(key))).toEqual([]);
  expect(current.readinessReads()).toBe(2);
  expect(current.state).toMatchObject({ queueReads: 2, requirementReads: 1 });
});

test('[BOUNDARY] [SG2-39:AC1] [SG2-57:AC2] turning registration back off restores not-required readiness', async () => {
  const current = registrationFixture();
  await openRegistrationPlanning();
  fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
  await screen.findByText('Registration opening and closing times are missing.');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Planning Information' }));
  fireEvent.click(screen.getByRole('button', { name: 'Registration Enabled' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
  await screen.findByText('Registration not required.');
  expect(screen.getByTestId('arrangement-registration-state')).toHaveTextContent('Not required');
  expect(current.readinessReads()).toBe(3);
  expect(current.state).toMatchObject({ queueReads: 2, requirementReads: 1 });
});

test('[FAILURE] [SG2-39:AC4] [SG2-57:AC2] a failed planning save leaves readiness unchanged and keeps the registration choice', async () => {
  const current = registrationFixture(true);
  await openRegistrationPlanning();
  fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
  await screen.findByText('Planning service unavailable');
  expect(screen.getByRole('button', { name: 'Registration Enabled' })).toBeVisible();
  expect(screen.getByTestId('arrangement-registration-state')).toHaveTextContent('Not required');
  expect(current.readinessReads()).toBe(1);
});

function selectedEquipmentFixture(replies: (RequirementsView | Promise<Response> | number)[]) {
  const item: WorkItem = { ...EVENT, kind: 'equipment', item_id: 51, title: 'Projector',
    status: 'pending', category: 'equipment', assigned_to_me: false,
    details: { quantity: 5, notes: 'Original five-projector notes', equipment_requirements: 'Presentation equipment' } };
  let requirementReads = 0, queueReads = 0;
  const fetch = vi.fn(async (url: string): Promise<Response> => {
    if (url.startsWith('/api/work-queue')) { queueReads++; return Response.json({ items: [item] }); }
    if (url === '/api/equipment-requests?event_id=17') {
      const reply = replies[requirementReads++];
      if (typeof reply === 'number') return Response.json({ error: 'Unavailable' }, { status: reply });
      return reply instanceof Promise ? reply : Response.json(reply);
    }
    throw new Error(`Unexpected selected-equipment fixture URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { reads: () => ({ requirementReads, queueReads }) };
}
function supportView(requests: EquipmentRequirement[]): RequirementsView {
  return { event: { event_id: 17, name: EVENT.title, status: 'planning' }, requests,
    equipment: [{ equipment_id: 3, type: 'Projector' }], venues: [], can_request: false, can_arrange: true };
}
const ORIGINAL_EQUIPMENT = { ...REQUIREMENT, quantity: 5, notes: 'Original five-projector notes' };
const AMENDED_EQUIPMENT = { ...REQUIREMENT, quantity: 3, notes: 'Revised three-projector notes', equipment_type: 'Updated projector', version: 2 };
async function openSupport() {
  render(<WorkQueue role="Technical Support Staff" accessToken="support-token" />);
  fireEvent.click(await screen.findByRole('button', { name: /Projector/ }));
  await screen.findByRole('region', { name: 'Equipment requirements' });
  return screen.getByRole('article', { name: 'Equipment request' });
}
function summaryFact(article: HTMLElement, name: string) {
  return within(article.querySelector('.organisation-detail-facts')!).getByText(name, { selector: 'dt' }).nextElementSibling;
}

test('[NORMAL] [CONFLICT] [SG2-53:AC2] [SG2-41:AC4] refreshing an amended equipment requirement updates the selected request summary by identity rather than the first event requirement', async () => {
  const other = { ...REQUIREMENT, request_id: 99, quantity: 99, notes: 'Unrelated first requirement' };
  const state = selectedEquipmentFixture([supportView([ORIGINAL_EQUIPMENT]), supportView([other, AMENDED_EQUIPMENT])]);
  const article = await openSupport();
  expect(summaryFact(article, 'Quantity requested')).toHaveTextContent('5');
  expect(summaryFact(article, 'Request notes')).toHaveTextContent('Original five-projector notes');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await screen.findByRole('article', { name: 'Equipment requirement: Updated projector' });
  expect(summaryFact(article, 'Quantity requested')).toHaveTextContent(/^3$/);
  expect(summaryFact(article, 'Request notes')).toHaveTextContent('Revised three-projector notes');
  expect(within(article).getByRole('heading', { level: 2 })).toHaveTextContent('Updated projector');
  expect(within(article).queryByText('Original five-projector notes')).not.toBeInTheDocument();
  expect(summaryFact(article, 'Equipment requirements')).toHaveTextContent('Presentation equipment');
  expect(state.reads()).toEqual({ requirementReads: 2, queueReads: 2 });
});

test('[FAILURE] [SG2-53:AC2] [SG2-41:AC4] a failed requirement refresh preserves the selected summary until an authoritative retry succeeds', async () => {
  const state = selectedEquipmentFixture([supportView([ORIGINAL_EQUIPMENT]), 503, supportView([AMENDED_EQUIPMENT])]);
  const article = await openSupport();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await screen.findByRole('alert');
  expect(summaryFact(article, 'Quantity requested')).toHaveTextContent(/^5$/);
  expect(summaryFact(article, 'Request notes')).toHaveTextContent('Original five-projector notes');
  fireEvent.click(screen.getByRole('button', { name: 'Retry equipment requirements' }));
  await screen.findByRole('article', { name: 'Equipment requirement: Updated projector' });
  expect(summaryFact(article, 'Quantity requested')).toHaveTextContent(/^3$/);
  expect(summaryFact(article, 'Request notes')).toHaveTextContent('Revised three-projector notes');
  expect(state.reads()).toEqual({ requirementReads: 3, queueReads: 2 });
});

test.each([{ request_id: 99, event_id: 17 }, { request_id: 51, event_id: 18 }])('[BOUNDARY] [SG2-41:AC4] a requirements response for a different request/event %j cannot substitute it into the selected summary', async identity => {
  selectedEquipmentFixture([supportView([ORIGINAL_EQUIPMENT]), supportView([{ ...REQUIREMENT, ...identity, quantity: 99, notes: 'Different request' }])]);
  const article = await openSupport();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await screen.findByText('Different request');
  expect(summaryFact(article, 'Quantity requested')).toHaveTextContent(/^5$/);
  expect(summaryFact(article, 'Request notes')).toHaveTextContent('Original five-projector notes');
});

function externalPlacementFixture(options: { failRefresh?: boolean; refreshGate?: Promise<Response> } = {}) {
  const base = fixture();
  const placed: EquipmentRequirement = { ...REQUIREMENT, status: 'approved', quantity: 3, shortfall: 0,
    placement_venue_id: 9, placement_venue_name: 'Replacement room', placement_position: 'Front left' };
  base.state.requests = [placed];
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/equipment-requests?event_id=17' && base.state.requirementReads === 1) {
      if (options.failRefresh || options.refreshGate) {
        base.state.requirementReads++;
        return options.refreshGate ?? Response.json({ error: 'Equipment service unavailable' }, { status: 503 });
      }
    }
    if (url === '/api/event-requests/17/arrangements') {
      base.state.readinessReads++;
      const ready = Boolean(base.state.requests[0].placement_venue_id && base.state.requests[0].placement_position);
      return Response.json({ event_id: 17,
        arrangements: [{ key: 'equipment', label: 'Equipment', state: ready ? 'ready' : 'outstanding',
          detail: ready ? '1 equipment request reserved and placed.' : 'Equipment placement is missing.' }],
        outstanding: ready ? [] : ['equipment'], ready_for_confirmation: ready } satisfies EventArrangementsResult);
    }
    return base.fetch(url, init);
  });
  vi.stubGlobal('fetch', fetch);
  return { state: base.state, placed, clearPlacement: () => { base.state.requests = [{ ...placed, placement_venue_id: null, placement_venue_name: null, placement_position: null }]; } };
}

async function openPlacedEquipment() {
  render(<WorkQueue role="Event Coordinator" accessToken="coordinator-token" />);
  fireEvent.click(await screen.findByRole('button', { name: /Planning readiness forum/ }));
  await screen.findByText('1 equipment request reserved and placed.');
  await screen.findByRole('button', { name: 'Refresh equipment requirements' });
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Ready for confirmation');
}

test('[NORMAL] [SG2-53:AC5] [SG2-57:AC1] [SG2-57:AC2] refreshing externally changed placement updates readiness in both directions without discarding the planning draft', async () => {
  const current = externalPlacementFixture();
  await openPlacedEquipment();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Planning Information' }));
  fireEvent.change(screen.getByLabelText('Planning Notes (Internal Coordinator Log)'), { target: { value: 'Keep this unsaved planning note' } });
  current.clearPlacement();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await screen.findByText('Equipment placement is missing.');
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Arrangements outstanding');
  expect(screen.queryByText('1 equipment request reserved and placed.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Planning Notes (Internal Coordinator Log)')).toHaveValue('Keep this unsaved planning note');
  current.state.requests = [current.placed];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await screen.findByText('1 equipment request reserved and placed.');
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Ready for confirmation');
  expect(screen.getByLabelText('Planning Notes (Internal Coordinator Log)')).toHaveValue('Keep this unsaved planning note');
  expect(current.state).toMatchObject({ readinessReads: 3, requirementReads: 3, queueReads: 2 });
});

test('[FAILURE] [SG2-53:AC5] [SG2-57:AC2] a failed external placement refresh does not publish fresh readiness until an authoritative retry succeeds', async () => {
  const current = externalPlacementFixture({ failRefresh: true });
  await openPlacedEquipment();
  current.clearPlacement();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await screen.findByRole('alert');
  expect(current.state.readinessReads).toBe(1);
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Ready for confirmation');
  fireEvent.click(screen.getByRole('button', { name: 'Retry equipment requirements' }));
  await screen.findByText('Equipment placement is missing.');
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Arrangements outstanding');
  expect(current.state).toMatchObject({ readinessReads: 2, requirementReads: 3, queueReads: 2 });
});

test('[CONFLICT] [SG2-53:AC5] [SG2-57:AC2] an aborted equipment refresh cannot refresh or overwrite readiness after the event detail is reloaded', async () => {
  const pending = deferred<Response>();
  const current = externalPlacementFixture({ refreshGate: pending.promise });
  await openPlacedEquipment();
  current.clearPlacement();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await waitFor(() => expect(current.state.requirementReads).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Equipment placement is missing.');
  await screen.findByRole('button', { name: 'Refresh equipment requirements' });
  await act(async () => pending.resolve(Response.json(supportView([current.placed]))));
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent('Arrangements outstanding');
  expect(screen.queryByText('1 equipment request reserved and placed.')).not.toBeInTheDocument();
  expect(current.state).toMatchObject({ readinessReads: 2, requirementReads: 3, queueReads: 3 });
});
