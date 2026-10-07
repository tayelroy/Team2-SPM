import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

test.each([false, true])('[CONFLICT] [SG2-36:AC3] a delayed initial thread response preserves a posted reply exactly once (already included: %s)', async includesReply => {
  let load!: (value: ThreadOutcome) => void;
  const earlier = { ...question, clarification_id: 2, message: 'Earlier question', created_at: '2026-09-29T02:00:00.000Z' };
  vi.spyOn(eventRequestsApi, 'fetchClarifications').mockReturnValue(new Promise(resolve => { load = resolve; }));
  vi.spyOn(eventRequestsApi, 'postClarification').mockResolvedValue({ ok: true, clarification: question, status: 'needs_clarification' });
  const onPosted = vi.fn();
  render(<ClarificationThread eventId={9} accessToken="t" canPost prompt="Reply" onPosted={onPosted} />);
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Is the date firm?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Is the date firm?')).toBeVisible();
  expect(onPosted).toHaveBeenCalledWith('needs_clarification');
  await act(async () => load({ ok: true, clarifications: includesReply ? [earlier, question] : [earlier], status: 'needs_clarification' }));
  const messages = within(screen.getByRole('list', { name: 'Messages' })).getAllByRole('listitem');
  expect(messages).toHaveLength(2);
  expect(messages[0]).toHaveTextContent('Earlier question');
  expect(messages[1]).toHaveTextContent('Is the date firm?');
  expect(screen.getByLabelText('Reply')).toHaveValue('');
});

test('[CONFLICT] [SG2-36:AC3] a previous event response cannot replace the current conversation', async () => {
  let load!: (value: ThreadOutcome) => void;
  const current = { ...question, event_id: 10, clarification_id: 3, message: 'Current event question' };
  const fetchThread = vi.spyOn(eventRequestsApi, 'fetchClarifications')
    .mockReturnValueOnce(new Promise(resolve => { load = resolve; }))
    .mockResolvedValue({ ok: true, clarifications: [current], status: 'needs_clarification' });
  const view = render(<ClarificationThread eventId={9} accessToken="t" canPost={false} prompt="Reply" />);
  view.rerender(<ClarificationThread eventId={10} accessToken="t" canPost={false} prompt="Reply" />);
  expect(await screen.findByText('Current event question')).toBeVisible();
  await act(async () => load({ ok: true, clarifications: [question], status: 'needs_clarification' }));
  expect(fetchThread).toHaveBeenCalledWith(9, 't');
  expect(fetchThread).toHaveBeenCalledWith(10, 't');
  expect(screen.getByText('Current event question')).toBeVisible();
  expect(screen.queryByText('Is the date firm?')).not.toBeInTheDocument();
});

test.each(['success', 'failure'] as const)('[CONFLICT] [SG2-36:AC3] a late reply %s from a previous event cannot affect the current conversation', async outcome => {
  let post!: (value: PostOutcome) => void;
  vi.spyOn(eventRequestsApi, 'fetchClarifications').mockResolvedValue({ ok: true, clarifications: [], status: 'under_review' });
  vi.spyOn(eventRequestsApi, 'postClarification').mockReturnValue(new Promise(resolve => { post = resolve; }));
  const onPosted = vi.fn();
  const view = render(<ClarificationThread eventId={9} accessToken="t" canPost prompt="Reply" onPosted={onPosted} />);
  await screen.findByText('No questions have been asked yet.');
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Is the date firm?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  view.rerender(<ClarificationThread eventId={10} accessToken="t" canPost prompt="Reply" onPosted={onPosted} />);
  await screen.findByText('No questions have been asked yet.');
  fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'New event draft' } });
  await act(async () => post(outcome === 'success' ? { ok: true, clarification: question, status: 'needs_clarification' } : { ok: false, message: 'Old event failure' }));
  expect(screen.queryByText('Is the date firm?')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Reply')).toHaveValue('New event draft');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(onPosted).not.toHaveBeenCalled();
});
