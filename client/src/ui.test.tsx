import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

// Auto-cleanup only registers when vitest runs with globals enabled, which
// this project does not, so unmount between tests explicitly.
afterEach(cleanup);
import {
  Badge,
  Card,
  Chip,
  Dot,
  Eyebrow,
  Fact,
  Field,
  GhostButton,
  GradientButton,
  IconButton,
  ImagePlaceholder,
  Mark,
  Notice,
  NoticeMark,
  ProgressBar,
  RecessedCard,
  StatFigure,
  TextField,
} from './ui';

test('the buttons report their clicks', () => {
  const gradient = vi.fn();
  const ghost = vi.fn();
  const icon = vi.fn();
  const chip = vi.fn();

  render(
    <>
      <GradientButton onClick={gradient}>Submit request</GradientButton>
      <GhostButton onClick={ghost}>Save draft</GhostButton>
      <IconButton label="Open event" onClick={icon}>
        ↗
      </IconButton>
      <Chip bg="#000" bd="#111" fg="#fff" pressed onClick={chip}>
        Catering
      </Chip>
    </>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Catering' }));

  expect(gradient).toHaveBeenCalledOnce();
  expect(ghost).toHaveBeenCalledOnce();
  expect(icon).toHaveBeenCalledOnce();
  expect(chip).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Catering' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('fields preserve labels, descriptions, editable values and read-only reference data', () => {
  render(
    <>
      <Field
        label="Expected attendance"
        defaultValue="180"
        hint="Drives venue suitability checks"
      />
      <Field label="Currently confirmed" defaultValue="90" muted />
      <Field label="Date" defaultValue="12 Oct 2026" onAbyss />
    </>,
  );
  const input = screen.getByLabelText('Expected attendance');
  expect(input).toHaveValue('180');
  expect(screen.getByText('Drives venue suitability checks')).toBeInTheDocument();
  expect(input).toHaveAccessibleDescription('Drives venue suitability checks');
  expect(input).not.toHaveAttribute('readonly');
  expect(screen.getByLabelText('Currently confirmed')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Currently confirmed')).toHaveValue('90');
  expect(screen.getByLabelText('Date')).toHaveValue('12 Oct 2026');
});

test('the text field carries its placeholder', () => {
  render(<TextField label="Why" placeholder="Reason for the change…" rows={4} />);
  expect(screen.getByLabelText('Why')).toHaveAttribute(
    'placeholder',
    'Reason for the change…',
  );
});

test('the presentational primitives render their content', () => {
  render(
    <Card>
      <RecessedCard>
        <Eyebrow>Where things stand</Eyebrow>
        <Badge bg="#000" fg="#fff">
          Confirmed
        </Badge>
        <Fact label="Venue" value="Atrium Hall" />
        <StatFigure value="31" label="Items in stock" size={44} />
        <Notice>
          <NoticeMark size={26} />
        </Notice>
        <Dot tone="#00827c" />
        <ProgressBar pct="48%" />
        <Mark />
        <ImagePlaceholder height="118px" caption="venue photo" />
      </RecessedCard>
    </Card>,
  );

  expect(screen.getByText('Where things stand')).toBeInTheDocument();
  expect(screen.getByText('Confirmed')).toBeInTheDocument();
  expect(screen.getByText('Venue')).toBeInTheDocument();
  expect(screen.getByText('Atrium Hall')).toBeInTheDocument();
  expect(screen.getByText('31')).toBeInTheDocument();
  expect(screen.getByText('venue photo')).toBeInTheDocument();
});
