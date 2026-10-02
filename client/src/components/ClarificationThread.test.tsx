import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import ClarificationThread from './ClarificationThread';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type ThreadOutcome = Awaited<ReturnType<typeof eventRequestsApi.fetchClarifications>>;
type PostOutcome = Awaited<ReturnType<typeof eventRequestsApi.postClarification>>;

const question = {
  clarification_id: 1, event_id: 9, sender_id: 'c1', sender_name: 'Casey',
  message: 'Is the date firm?', created_at: '2026-09-30T02:00:00.000Z',
};

test('[NORMAL] [SG2-36:AC3] shows a loading state, then each message with its sender and Singapore time', async () => {
  vi.spyOn(eventRequestsApi, 'fetchClarifications').mockResolvedValue({ ok: true, clarifications: [question], status: 'needs_clarification' });
  render(<ClarificationThread eventId={9} accessToken="t" canPost={false} prompt="Reply" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading the conversation');
  const list = await screen.findByRole('list', { name: 'Messages' });
  expect(list).toHaveTextContent('Casey');
  expect(list).toHaveTextContent('Is the date firm?');
  expect(list).toHaveTextContent(/30 Sept? 2026, 10:00/);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-36:AC3] a thread that cannot load says so and offers no reply box', async () => {
  vi.spyOn(eventRequestsApi, 'fetchClarifications').mockResolvedValue({ ok: false, message: 'This request is not one you are part of.' });
  render(<ClarificationThread eventId={9} accessToken="t" canPost prompt="Reply" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('not one you are part of');
  expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-36:AC1] the send button disables while a message is in flight and works without a listener', async () => {
  vi.spyOn(eventRequestsApi, 'fetchClarifications').mockResolvedValue({ ok: true, clarifications: [], status: 'under_review' });
  let settle!: (value: PostOutcome) => void;
  vi.spyOn(eventRequestsApi, 'postClarification').mockReturnValue(new Promise(resolve => { settle = resolve; }));
  render(<ClarificationThread eventId={9} accessToken="t" canPost prompt="Reply" />);
  await screen.findByText('No questions have been asked yet.');
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Is the date firm?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await act(async () => settle({ ok: true, clarification: question, status: 'needs_clarification' }));
  expect(screen.getByText('Is the date firm?')).toBeVisible();
  expect(screen.getByLabelText('Reply')).toHaveValue('');
});

test('[BOUNDARY] [SG2-36:AC3] a reply posted before the thread finishes loading is still kept', async () => {
  let load!: (value: ThreadOutcome) => void;
  vi.spyOn(eventRequestsApi, 'fetchClarifications').mockReturnValue(new Promise(resolve => { load = resolve; }));
  vi.spyOn(eventRequestsApi, 'postClarification').mockResolvedValue({ ok: true, clarification: question, status: 'needs_clarification' });
  const onPosted = vi.fn();
  render(<ClarificationThread eventId={9} accessToken="t" canPost prompt="Reply" onPosted={onPosted} />);
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Is the date firm?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Is the date firm?')).toBeVisible();
  expect(onPosted).toHaveBeenCalledWith('needs_clarification');
  await act(async () => load({ ok: true, clarifications: [question], status: 'needs_clarification' }));
});

test('[BOUNDARY] [SG2-36:AC3] a thread that finishes loading after the screen closes is ignored', async () => {
  let load!: (value: ThreadOutcome) => void;
  const fetchThread = vi.spyOn(eventRequestsApi, 'fetchClarifications').mockReturnValue(new Promise(resolve => { load = resolve; }));
  const { unmount } = render(<ClarificationThread eventId={9} accessToken="t" canPost={false} prompt="Reply" />);
  unmount();
  await act(async () => load({ ok: true, clarifications: [question], status: 'needs_clarification' }));
  expect(fetchThread).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Is the date firm?')).not.toBeInTheDocument();
});
