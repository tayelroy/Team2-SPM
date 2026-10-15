import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import WorkQueue from './WorkQueue';
import type { WorkItem } from '../api/workQueue';
import type { EquipmentRequirement, RequirementsView } from '../api/equipmentRequirements';
import type { EventArrangementsResult } from '../api/eventRequests';

// Reservation forms have a separate public-component suite. Keep the real
// requirements, readiness, planning drawer and queue together in this suite.
vi.mock('../components/EquipmentReservations', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
