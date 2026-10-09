import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import EquipmentRequirements from './EquipmentRequirements';
import { EquipmentRequirementsError, loadEquipmentRequirements, saveEquipmentArrangement, saveEquipmentRequirement, type EquipmentRequirement, type RequirementsView } from '../api/equipmentRequirements';
vi.mock('../api/equipmentRequirements', async original => ({ ...await original<typeof import('../api/equipmentRequirements')>(), loadEquipmentRequirements: vi.fn(), saveEquipmentRequirement: vi.fn(), saveEquipmentArrangement: vi.fn() }));
const record: EquipmentRequirement = { request_id: 11, event_id: 7, equipment_id: 3, equipment_type: 'Microphone', quantity: 4, notes: 'Wireless', status: 'pending', arrangement_notes: null, shortfall: null, placement_venue_id: null, placement_venue_name: null, placement_position: null, version: 2 };
const view: RequirementsView = { event: { event_id: 7, name: 'Forum', status: 'approved' }, requests: [record], equipment: [{ equipment_id: 3, type: 'Microphone' }, { equipment_id: 4, type: 'Projector' }], venues: [{ venue_id: 9, name: 'Main hall' }], can_request: true, can_arrange: false };
const arranged = { ...record, arrangement_notes: 'Two ready', shortfall: 2, placement_venue_id: 9, placement_venue_name: 'Main hall', placement_position: 'Stage left' };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadEquipmentRequirements).mockResolvedValue(view); vi.mocked(saveEquipmentRequirement).mockResolvedValue(view); vi.mocked(saveEquipmentArrangement).mockResolvedValue({ ...view, can_request: false, can_arrange: true, requests: [arranged] }); });
afterEach(cleanup);
async function open(data = view) {
  vi.mocked(loadEquipmentRequirements).mockResolvedValue(data);
  const rendered = render(<EquipmentRequirements eventId={7} accessToken="token" />);
  await screen.findByRole('region', { name: 'Equipment requirements' });
  return rendered;
}
async function requestForm(edit = false) {
  await open(); fireEvent.click(screen.getByRole('button', { name: edit ? 'Edit requirement for Microphone' : 'Add equipment requirement' }));
}
async function arrangementForm(item = record) {
  await open({ ...view, can_request: false, can_arrange: true, requests: [item] });
  fireEvent.click(screen.getByRole('button', { name: 'Update arrangement for Microphone' }));
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function fillRequirement(quantity = '5', notes = '  Two spares  ') { change('Equipment type', '4'); change('Quantity required', quantity); change('Technical notes', notes); }
function submit(name = 'Add equipment requirement') { fireEvent.submit(screen.getByRole('form', { name })); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('[FAILURE] [SG2-53:AC1] unsigned callers cannot fetch or change event requirements', () => {
  render(<EquipmentRequirements eventId={7} />);
  expect(screen.getByText('Sign in to view equipment requirements.')).toBeVisible();
  expect(loadEquipmentRequirements).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
test('[NORMAL] [SG2-53:AC1] [SG2-53:AC5] [SG2-53:AC6] renders current quantities, updates, shortfall and explicit absent placement without granting edits to read-only viewers', async () => {
  await open({ ...view, can_request: false, requests: [record, { ...arranged, request_id: 12, equipment_type: 'Projector', notes: null, shortfall: 0 }] });
  expect(loadEquipmentRequirements).toHaveBeenCalledWith(7, 'token', expect.any(AbortSignal));
  const microphone = within(screen.getByRole('article', { name: 'Equipment requirement: Microphone' }));
  expect(microphone.getByText('4')).toBeVisible(); expect(microphone.getByText('Wireless')).toBeVisible();
  expect(microphone.getAllByText('Not recorded')).toHaveLength(4);
  const projector = within(screen.getByRole('article', { name: 'Equipment requirement: Projector' }));
  for (const text of ['Two ready', '0', 'Main hall', 'Stage left', 'Not recorded']) expect(projector.getByText(text)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Add equipment requirement' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Edit requirement|Update arrangement/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh equipment requirements' }));
  await screen.findByRole('article', { name: 'Equipment requirement: Microphone' }); expect(loadEquipmentRequirements).toHaveBeenCalledTimes(2);
});
test('[BOUNDARY] [SG2-53:AC1] [SG2-53:AC4] an empty event adds equipment and renders the full server result with trimmed technical notes', async () => {
  await open({ ...view, requests: [] });
  expect(screen.getByText('No equipment requirements recorded.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add equipment requirement' })); fillRequirement(); submit();
  expect(await screen.findByRole('status')).toHaveTextContent('Equipment requirement saved.');
  expect(saveEquipmentRequirement).toHaveBeenCalledExactlyOnceWith(7, 'token', expect.any(AbortSignal), { equipment_id: 4, quantity: 5, notes: 'Two spares' }, null);
  expect(screen.getByRole('article', { name: 'Equipment requirement: Microphone' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Add equipment requirement' }));
  expect(screen.queryByText('Equipment requirement saved.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('form')).not.toBeInTheDocument();
});
test('[NORMAL] [SG2-53:AC2] amendment prefills all values, warns of arrangement reset and sends the original versioned record', async () => {
  await open({ ...view, requests: [arranged] }); fireEvent.click(screen.getByRole('button', { name: 'Edit requirement for Microphone' }));
  expect(screen.getByLabelText('Equipment type')).toHaveValue('3'); expect(screen.getByLabelText('Quantity required')).toHaveValue('4'); expect(screen.getByLabelText('Technical notes')).toHaveValue('Wireless');
  expect(screen.getByText(/Saving changes clears the previous arrangement update, shortfall and placement/)).toBeVisible();
  fillRequirement('8', '   '); submit('Edit equipment requirement'); await screen.findByText('Equipment requirement saved.');
  expect(saveEquipmentRequirement).toHaveBeenCalledWith(7, 'token', expect.any(AbortSignal), { equipment_id: 4, quantity: 8, notes: null }, arranged);
  expect(screen.getByRole('article', { name: 'Equipment requirement: Microphone' })).toHaveTextContent('Not recorded');
});
test('[FAILURE] [SG2-53:AC2] closed requests expose no item mutation even when event capability flags are true', async () => {
  await open({ ...view, can_arrange: true, requests: [{ ...record, status: 'approved' }] });
  expect(screen.queryByRole('button', { name: /Edit requirement|Update arrangement/ })).not.toBeInTheDocument();
});
test.each(['1', '2147483647'])('[BOUNDARY] [SG2-53:AC3] positive inclusive quantity %s and exactly 2000 Unicode code points are accepted', async quantity => {
  await requestForm(); fillRequirement(quantity, ` ${'🎤'.repeat(2000)} `); submit(); await screen.findByText('Equipment requirement saved.');
  expect(saveEquipmentRequirement).toHaveBeenCalledWith(7, 'token', expect.any(AbortSignal), { equipment_id: 4, quantity: Number(quantity), notes: '🎤'.repeat(2000) }, null);
});
test.each(['', '0', '-1', '1.5', '1e3', '2147483648'])('[FAILURE] [BOUNDARY] [SG2-53:AC3] quantity %s is rejected without dispatch', async quantity => {
  await requestForm(); fillRequirement(quantity); submit(); expect(screen.getByRole('alert')).toHaveTextContent('whole-number quantity from 1'); expect(saveEquipmentRequirement).not.toHaveBeenCalled();
});
test('[FAILURE] [SG2-53:AC1] missing equipment and excessive notes remain editable and clearing validation permits dispatch', async () => {
  await requestForm(); submit(); expect(screen.getByRole('alert')).toBeVisible(); expect(saveEquipmentRequirement).not.toHaveBeenCalled();
  fillRequirement('5', 'x'.repeat(2001)); submit(); expect(saveEquipmentRequirement).not.toHaveBeenCalled();
  fillRequirement(); submit(); await screen.findByText('Equipment requirement saved.'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('[NORMAL] [SG2-53:AC5] [SG2-53:AC6] Technical Support records arrangement progress, shortfall and placement, then sees saved values', async () => {
  await arrangementForm();
  expect(screen.getByLabelText('Shortfall quantity')).toHaveValue(''); expect(screen.getByLabelText('Placement venue')).toHaveValue('');
  change('Arrangement notes', ' Two ready '); change('Shortfall quantity', '2'); change('Placement venue', '9'); change('Placement position', ' Stage left '); submit('Update equipment arrangement');
  await screen.findByText('Equipment arrangement saved.');
  expect(saveEquipmentArrangement).toHaveBeenCalledWith(7, 'token', expect.any(AbortSignal), { arrangement_notes: 'Two ready', shortfall: 2, placement_venue_id: 9, placement_position: 'Stage left' }, record);
  for (const text of ['Two ready', 'Main hall', 'Stage left', '2']) expect(screen.getByText(text, { exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Add equipment requirement' })).not.toBeInTheDocument();
});
test('[BOUNDARY] [SG2-53:AC5] [SG2-53:AC6] a saved arrangement prefills fields and accepts fully covered zero with placement cleared', async () => {
  await arrangementForm(arranged);
  expect(screen.getByLabelText('Arrangement notes')).toHaveValue('Two ready'); expect(screen.getByLabelText('Shortfall quantity')).toHaveValue('2');
  expect(screen.getByLabelText('Placement venue')).toHaveValue('9'); expect(screen.getByLabelText('Placement position')).toHaveValue('Stage left');
  change('Arrangement notes', ' '); change('Shortfall quantity', '0'); change('Placement venue', ''); change('Placement position', ' '); submit('Update equipment arrangement'); await screen.findByText('Equipment arrangement saved.');
  expect(saveEquipmentArrangement).toHaveBeenCalledWith(7, 'token', expect.any(AbortSignal), { arrangement_notes: null, shortfall: 0, placement_venue_id: null, placement_position: null }, arranged);
});
test('[BOUNDARY] [SG2-53:AC5] [SG2-53:AC6] total shortfall and the exact Unicode text limits are accepted', async () => {
  await arrangementForm(); change('Shortfall quantity', '4'); change('Arrangement notes', '🎤'.repeat(2000)); change('Placement venue', '9'); change('Placement position', '席'.repeat(2000)); submit('Update equipment arrangement'); await screen.findByText('Equipment arrangement saved.');
  expect(saveEquipmentArrangement).toHaveBeenCalledWith(7, 'token', expect.any(AbortSignal), { shortfall: 4, arrangement_notes: '🎤'.repeat(2000), placement_venue_id: 9, placement_position: '席'.repeat(2000) }, record);
});
test.each([
  ['Shortfall quantity', ''], ['Shortfall quantity', '-1'], ['Shortfall quantity', '0.5'], ['Shortfall quantity', '5'],
  ['Arrangement notes', 'x'.repeat(2001)], ['Placement position', 'x'.repeat(2001)],
  ['Placement position', 'Position without venue'], ['Placement venue', '9'],
])('[FAILURE] [BOUNDARY] [SG2-53:AC5] [SG2-53:AC6] invalid %s is refused and can be corrected', async (field, value) => {
  await arrangementForm(); change('Shortfall quantity', '0'); change(field, value); submit('Update equipment arrangement');
  expect(screen.getByRole('alert')).toHaveTextContent('both placement fields or neither'); expect(saveEquipmentArrangement).not.toHaveBeenCalled();
  change('Shortfall quantity', '0'); change('Arrangement notes', ''); change('Placement venue', ''); change('Placement position', ''); submit('Update equipment arrangement'); await screen.findByText('Equipment arrangement saved.');
});
test.each([new EquipmentRequirementsError(503), new Error('Private transport error')])('[FAILURE] [SG2-53:AC1] load errors are safe and retry fetches the event again', async failure => {
  vi.mocked(loadEquipmentRequirements).mockRejectedValueOnce(failure); render(<EquipmentRequirements eventId={7} accessToken="token" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading equipment requirements');
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof EquipmentRequirementsError ? failure.message : 'Unable to load equipment requirements. Please try again.');
  expect(screen.queryByText('Private transport error')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Retry equipment requirements' }));
  expect(await screen.findByRole('article')).toBeVisible(); expect(loadEquipmentRequirements).toHaveBeenCalledTimes(2);
});
test.each([new EquipmentRequirementsError(400), new Error('Private transport error')])('[FAILURE] [SG2-53:AC1] save errors retain all inputs and allow retry without leaking internal errors', async failure => {
  await requestForm(); fillRequirement(); vi.mocked(saveEquipmentRequirement).mockRejectedValueOnce(failure); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof EquipmentRequirementsError ? failure.message : 'Your changes are still in the form.');
  expect(screen.getByLabelText('Equipment type')).toHaveValue('4'); expect(screen.getByLabelText('Quantity required')).toHaveValue('5'); expect(screen.getByLabelText('Technical notes')).toHaveValue('  Two spares  ');
  expect(screen.queryByText('Private transport error')).not.toBeInTheDocument(); submit(); await screen.findByText('Equipment requirement saved.'); expect(saveEquipmentRequirement).toHaveBeenCalledTimes(2);
});
test.each([401, 403, 404])('[FAILURE] [SG2-53:AC1] denied or inaccessible mutation HTTP %i clears stale event data and controls', async status => {
  await requestForm(true); vi.mocked(saveEquipmentRequirement).mockRejectedValue(new EquipmentRequirementsError(status)); submit('Edit equipment requirement');
  expect(await screen.findByRole('alert')).toHaveTextContent(new EquipmentRequirementsError(status).message);
  expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
});
test('[CONFLICT] [SG2-53:AC2] a stale or duplicate save retains values, blocks repeat submission and explicitly reloads requirements', async () => {
  await requestForm(true); change('Quantity required', '9'); vi.mocked(saveEquipmentRequirement).mockRejectedValue(new EquipmentRequirementsError(409)); submit('Edit equipment requirement');
  await screen.findByRole('alert'); expect(screen.getByLabelText('Quantity required')).toHaveValue('9'); expect(screen.getByRole('button', { name: 'Save equipment requirement' })).toBeDisabled();
  submit('Edit equipment requirement'); expect(saveEquipmentRequirement).toHaveBeenCalledTimes(1);
  vi.mocked(loadEquipmentRequirements).mockResolvedValue({ ...view, requests: [{ ...record, quantity: 8, version: 3 }] }); fireEvent.click(screen.getByRole('button', { name: 'Reload requirements' }));
  await screen.findByRole('article'); fireEvent.click(screen.getByRole('button', { name: 'Edit requirement for Microphone' }));
  expect(screen.getByLabelText('Quantity required')).toHaveValue('8'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('form')).not.toBeInTheDocument();
});
test('[CONFLICT] [SG2-53:AC1] simultaneous submits send one mutation and disable inputs and cancel while saving', async () => {
  await requestForm(); fillRequirement(); const pending = deferred<RequirementsView>(); vi.mocked(saveEquipmentRequirement).mockReturnValue(pending.promise);
  const form = screen.getByRole('form'); act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  expect(saveEquipmentRequirement).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(); expect(screen.getByLabelText('Equipment type')).toBeDisabled();
  submit(); expect(saveEquipmentRequirement).toHaveBeenCalledTimes(1); await act(async () => pending.resolve(view)); expect(screen.getByText('Equipment requirement saved.')).toBeVisible();
});
test.each(['resolve', 'reject'] as const)('[CONFLICT] [SG2-53:AC1] a late load %s cannot expose a previous event after event identity changes', async outcome => {
  const pending = deferred<RequirementsView>(); vi.mocked(loadEquipmentRequirements).mockReturnValueOnce(pending.promise).mockResolvedValue({ ...view, requests: [] });
  const rendered = render(<EquipmentRequirements eventId={7} accessToken="token" />); const signal = vi.mocked(loadEquipmentRequirements).mock.calls[0][2];
  rendered.rerender(<EquipmentRequirements eventId={8} accessToken="token" />); expect(signal.aborted).toBe(true); await screen.findByText('No equipment requirements recorded.');
  await act(async () => { if (outcome === 'resolve') pending.resolve(view); else pending.reject(new Error('Old event error')); });
  expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test.each(['resolve', 'reject'] as const)('[CONFLICT] [SG2-53:AC2] a late save %s after account changes is aborted and cannot alter the current view', async outcome => {
  const rendered = await open(); fireEvent.click(screen.getByRole('button', { name: 'Add equipment requirement' })); fillRequirement(); const pending = deferred<RequirementsView>(); vi.mocked(saveEquipmentRequirement).mockReturnValue(pending.promise); submit();
  const signal = vi.mocked(saveEquipmentRequirement).mock.calls[0][2]; vi.mocked(loadEquipmentRequirements).mockResolvedValue({ ...view, requests: [] }); rendered.rerender(<EquipmentRequirements eventId={7} accessToken="other-token" />);
  expect(signal.aborted).toBe(true); await screen.findByText('No equipment requirements recorded.');
  await act(async () => { if (outcome === 'resolve') pending.resolve(view); else pending.reject(new EquipmentRequirementsError(403)); });
  expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByText('Equipment requirement saved.')).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-54:AC1] support availability remains available on a confirmed event without arrangement edit permission', async () => {
  vi.mocked(loadEquipmentRequirements).mockResolvedValue({ ...view, can_request: false, can_arrange: false, event: { ...view.event, status: 'confirmed' } });
  render(<EquipmentRequirements eventId={7} accessToken="token" canCheckAvailability />);
  expect(await screen.findByRole('button', { name: 'Check availability for Microphone' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Update arrangement for Microphone' })).not.toBeInTheDocument();
});
