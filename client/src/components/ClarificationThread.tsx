import { useEffect, useId, useRef, useState } from 'react';
import { fetchClarifications, postClarification, type Clarification } from '../api/eventRequests';

function when(value: string) {
  return new Date(value).toLocaleString('en-SG', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore', hour12: false,
  });
}

/**
 * The clarification exchange on an event (SG2-36), shared by the
 * coordinator's queue and the organiser's event page so both sides read the
 * same record.
 *
 * `canPost` decides whether a reply box is offered; the server still decides
 * who may actually post. `onPosted` reports the status the server returned,
 * because a coordinator's first question also moves the request back to the
 * organiser.
 */
export default function ClarificationThread({
  eventId,
  accessToken,
  canPost,
  prompt,
  onPosted,
}: {
  eventId: number;
  accessToken: string;
  canPost: boolean;
  /** Label for the reply box, which differs for a question and an answer. */
  prompt: string;
  onPosted?: (status: string) => void;
}) {
  const fieldId = useId();
  const [messages, setMessages] = useState<Clarification[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const threadRef = useRef({ active: true, posted: [] as Clarification[] });

  useEffect(() => {
    const thread = { active: true, posted: [] as Clarification[] };
    threadRef.current = thread;
    setMessages(null);
    setLoadError('');
    setSending(false);
    setSendError('');
    setDraft('');
    fetchClarifications(eventId, accessToken).then(result => {
      if (!thread.active) return;
      if (result.ok) {
        // A reply may finish posting while this initial snapshot is in flight.
        // Keep the server order and append replies absent from that snapshot.
        const messagesById = new Map(result.clarifications.map(message => [message.clarification_id, message]));
        for (const message of thread.posted) messagesById.set(message.clarification_id, message);
        setMessages([...messagesById.values()]);
      }
      else setLoadError(result.message);
    });
    return () => { thread.active = false; };
  }, [eventId, accessToken]);

  async function send() {
    const thread = threadRef.current;
    setSendError('');
    setSending(true);
    const result = await postClarification(eventId, draft, accessToken);
    if (!thread.active) return;
    setSending(false);
    if (!result.ok) {
      setSendError(result.message);
      return;
    }
    thread.posted.push(result.clarification);
    setMessages(current => [...(current ?? []), result.clarification]);
    setDraft('');
    onPosted?.(result.status);
  }

  return <section className="organisation-detail-intro" aria-label="Clarification conversation">
    <h3>Clarification</h3>
    {loadError ? <p role="alert" className="work-queue-empty">{loadError}</p>
      : messages === null ? <p role="status">Loading the conversation…</p>
        : messages.length === 0 ? <p className="work-queue-empty">No questions have been asked yet.</p>
          : <ol className="organisation-detail-facts" aria-label="Messages">
            {messages.map(item => <li key={item.clarification_id}>
              <strong>{item.sender_name ?? 'Unknown sender'}</strong>
              <span className="organisation-detail-hint"> · {when(item.created_at)}</span>
              <p className="organisation-detail-description">{item.message}</p>
            </li>)}
          </ol>}
    {canPost && !loadError && <>
      <label htmlFor={fieldId}>{prompt}</label>
      <textarea id={fieldId} rows={3} value={draft} onChange={event => setDraft(event.target.value)} />
      {sendError && <p role="alert" className="work-queue-empty">{sendError}</p>}
      <button type="button" className="organisation-button" disabled={sending} onClick={send}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </>}
  </section>;
}
