import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import EquipmentForm from './EquipmentForm';
import type { EquipmentRecord } from '../api/equipment';

const record: EquipmentRecord = { equipment_id: 7, type: 'Microphone', description: 'Wireless handheld',
  location: 'Store A', quantity_held: 8, operational_status: 'operational', available_quantity: 8, version: 2 };
afterEach(cleanup);
function open(overrides: Partial<React.ComponentProps<typeof EquipmentForm>> = {}) {
  const props = { equipment: null, saving: false, error: '', conflict: false,
    onSave: vi.fn(), onCancel: vi.fn(), onReload: vi.fn(), ...overrides };
  render(<EquipmentForm {...props} />);
  return props;
}
function fill(values: { type?: string; description?: string; location?: string; quantity?: string; status?: string } = {}) {
  const data = { type: 'Microphone', description: 'Wireless handheld', location: 'Store A', quantity: '8', status: 'operational', ...values };
  fireEvent.change(screen.getByLabelText('Equipment type'), { target: { value: data.type } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: data.description } });
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: data.location } });
  fireEvent.change(screen.getByLabelText('Quantity held'), { target: { value: data.quantity } });
  fireEvent.change(screen.getByLabelText('Operational status'), { target: { value: data.status } });
}
function submit(name = 'Add equipment') { fireEvent.submit(screen.getByRole('form', { name })); }

test('[NORMAL] [SG2-52:AC1] a new form labels all required fields and trims submitted text', () => {
  const props = open();
  expect(screen.getByRole('heading', { name: 'Add equipment' })).toBeInTheDocument();
  for (const name of ['Equipment type', 'Description', 'Location']) expect(screen.getByLabelText(name)).toHaveValue('');
  expect(screen.getByLabelText('Quantity held')).toHaveValue(null);
  expect(screen.getByLabelText('Operational status')).toHaveValue('operational');
  fill({ type: '  Microphone  ', description: ' Wireless handheld ', location: ' Store A ' }); submit();
  expect(props.onSave).toHaveBeenCalledWith({ type: 'Microphone', description: 'Wireless handheld', location: 'Store A', quantity_held: 8, operational_status: 'operational' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
});

test('[NORMAL] [SG2-52:AC1,AC2] editing prefills persisted values and saves changed status', () => {
  const props = open({ equipment: record });
  expect(screen.getByRole('heading', { name: 'Edit equipment' })).toBeInTheDocument();
  expect(screen.getByLabelText('Equipment type')).toHaveValue('Microphone');
  expect(screen.getByLabelText('Description')).toHaveValue('Wireless handheld');
  expect(screen.getByLabelText('Location')).toHaveValue('Store A');
  expect(screen.getByLabelText('Quantity held')).toHaveValue(8);
  expect(screen.getByRole('option', { name: 'Operational' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Damaged' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Under maintenance' })).toBeInTheDocument();
  fill({ type: 'Projector', description: 'Ceiling unit', location: 'Hall B', quantity: '5', status: 'maintenance' }); submit('Edit equipment');
  expect(props.onSave).toHaveBeenCalledWith({ type: 'Projector', description: 'Ceiling unit', location: 'Hall B', quantity_held: 5, operational_status: 'maintenance' });
});

test.each(['0', '2147483647'])('[BOUNDARY] [SG2-52:AC1] quantity %s is accepted at the inclusive limit', quantity => {
  const props = open(); fill({ quantity }); submit();
  expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ quantity_held: Number(quantity) }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-52:AC1] exact text limits count Unicode code points and accept required whitespace trimming', () => {
  const props = open();
  fill({ type: ` ${'🎤'.repeat(255)} `, description: 'D'.repeat(2000), location: 'L'.repeat(2000) }); submit();
  expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ type: '🎤'.repeat(255), description: 'D'.repeat(2000), location: 'L'.repeat(2000) }));
});

test.each([
  ['type', '   '], ['description', ''], ['location', ' '],
  ['type', 'T'.repeat(256)], ['description', 'D'.repeat(2001)], ['location', 'L'.repeat(2001)],
  ['quantity', ''], ['quantity', '-1'], ['quantity', '1.5'], ['quantity', '1e3'], ['quantity', '2147483648'],
])('[BOUNDARY] [SG2-52:AC1] invalid %s is rejected before dispatch', (field, value) => {
  const props = open(); fill({ [field]: value }); submit();
  expect(props.onSave).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Complete every field.');
  expect(screen.getByRole('alert')).toHaveTextContent('Quantity must be a whole number from 0 to 2,147,483,647.');
});

test('[FAILURE] [SG2-52:AC1] correcting an invalid form clears the validation alert on successful dispatch', () => {
  const props = open(); submit();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fill(); submit();
  expect(props.onSave).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[CONFLICT] [SG2-52:AC1] an in-flight save prevents duplicate submission and cancellation', () => {
  const props = open({ equipment: record, saving: true }); submit('Edit equipment');
  expect(props.onSave).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Equipment type')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
});

test('[CONFLICT] [SG2-52:AC1] a stale version preserves the form and offers reload or cancel without saving', () => {
  const props = open({ equipment: record, conflict: true, error: 'This record changed while you were editing.' });
  submit('Edit equipment');
  expect(props.onSave).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Equipment type')).toHaveValue('Microphone');
  expect(screen.getByLabelText('Equipment type')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('This record changed while you were editing.');
  expect(screen.getByRole('button', { name: 'Save equipment' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload records' }));
  expect(props.onReload).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
});
