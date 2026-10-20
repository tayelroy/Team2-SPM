import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  closeRegistrationNow,
  fetchRegistrations,
  saveRegistrationSettings,
  type RegistrationResult,
  type RegistrationSettingsInput,
  type RegistrationView,
} from '../api/registrations';
import type { RegistrationWindow } from '../api/eventConfirmation';
import { isoToSgtLocal, sgtToIso } from '../venues/searchApi';
import { formatSgtTimestamp } from './EventAuditDrawer';

type Props = { eventId: number; accessToken: string };

/** Where registration stands, in the organiser's and coordinator's words. */
export const REGISTRATION_STATE: Record<RegistrationWindow, string> = {
  not_required: 'This event does not take registrations.',
  not_confirmed: 'Registration opens to attendees once the event is confirmed.',
  not_yet_open: 'Registration has not opened yet.',
  open: 'Registration is open.',
  closed: 'Registration has closed.',
};

const MAX_CAPACITY = 2_147_483_647;

/**
 * SG2-63: the registration picture for an organiser of the event's
 * organisation or its assigned coordinator (AC1–AC4), and the creating
 * organiser's settings: capacity and opening and closing times, closing early,
 * and reopening or extending by a later closing time (AC5–AC7). Everyone else
 * sees the settings read-only (AC8).
 */
export default function RegistrationPanel(props: Props) {
  return <Panel key={`${props.eventId}:${props.accessToken}`} {...props} />;
}

function Panel({ eventId, accessToken }: Props) {
  const [view, setView] = useState<RegistrationView | null>(null);
  const [failure, setFailure] = useState<{ status: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setFailure(null);
    void fetchRegistrations(eventId, accessToken, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setView(result.view);
      else setFailure({ status: result.status, message: result.message });
    });
    return () => controller.abort();
  }, [eventId, accessToken, attempt]);

  // 404: this caller has no part in the event's registrations.
  if (failure?.status === 404) return null;
  return (
    <section aria-label="Registration" data-testid="registration-panel" className="organisation-detail-panel registration-panel">
      <h3>Registration</h3>
      {failure ? (
        <div className="registration-row">
          <p role="alert" className="organisation-detail-hint">{failure.message}</p>
          <button type="button" className="organisation-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </div>
      ) : view ? (
        <Picture view={view} eventId={eventId} accessToken={accessToken} onChanged={setView} />
      ) : (
        <p role="status" className="organisation-detail-hint">Loading registrations…</p>
      )}
    </section>
  );
}

function Picture({ view, eventId, accessToken, onChanged }: {
  view: RegistrationView; eventId: number; accessToken: string; onChanged: (view: RegistrationView) => void;
}) {
  if (!view.registration_needed) return <p className="organisation-detail-hint">{REGISTRATION_STATE.not_required}</p>;
  const time = (iso: string | null) => (iso ? formatSgtTimestamp(iso) : 'Not set');
  return (
    <>
      <p className="registration-state" data-window={view.window}>{REGISTRATION_STATE[view.window]}</p>
      <dl className="registration-facts">
        <div><dt>Registered</dt><dd data-testid="registration-count">{view.registered_count}</dd></div>
        <div><dt>Capacity</dt><dd>{view.registration_capacity ?? 'Not set'}</dd></div>
        <div><dt>Places remaining</dt><dd data-testid="registration-remaining">{view.places_remaining ?? 'No capacity set'}</dd></div>
        <div><dt>Opens</dt><dd>{time(view.registration_opens_at)}</dd></div>
        <div><dt>Closes</dt><dd>{time(view.registration_closes_at)}</dd></div>
      </dl>
      {view.capacity_warnings.length > 0 ? <Warnings warnings={view.capacity_warnings} /> : null}
      <Attendees view={view} />
      {view.can_edit ? (
        <SettingsForm view={view} eventId={eventId} accessToken={accessToken} onChanged={onChanged} />
      ) : (
        <p className="organisation-detail-hint">Only the organiser who created this event can change its registration settings.</p>
      )}
    </>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <ul className="registration-warnings" aria-label="Capacity warnings">
      {warnings.map((warning) => <li key={warning}>{warning}</li>)}
    </ul>
  );
}

function Attendees({ view }: { view: RegistrationView }) {
  return (
    <div className="registration-attendees">
      <h4>Registered attendees</h4>
      {view.attendees.length === 0 ? (
        <p className="organisation-detail-hint">No one has registered yet.</p>
      ) : (
        <ul aria-label="Registered attendees">
          {view.attendees.map((attendee) => (
            <li key={attendee.registration_id} className="registration-attendee">
              <strong>{attendee.name}</strong>
              {attendee.organisation ? <span>{attendee.organisation}</span> : null}
              {view.contact_details_visible ? (
                <>
                  <span>{attendee.email ? <EmailAddress email={attendee.email} /> : 'No email on record'}</span>
                  <span>{attendee.phone ?? 'No phone on record'}</span>
                </>
              ) : null}
              <span className="organisation-detail-hint">Registered {formatSgtTimestamp(attendee.registered_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {!view.contact_details_visible && view.attendees.length > 0 ? (
        <p className="organisation-detail-hint">
          Contact details are shown only to the organiser who created this event and its coordinator.
        </p>
      ) : null}
    </div>
  );
}

/** Only something shaped like an email address becomes a mailto link; anything else is plain text. */
const EMAIL_SHAPE = /^[^@\s:/]+@[^@\s:/]+\.[^@\s:/]+$/;

function EmailAddress({ email }: { email: string }) {
  return EMAIL_SHAPE.test(email) ? <a href={`mailto:${email}`}>{email}</a> : <>{email}</>;
}

/** What the form holds, as typed: capacity text and Singapore-time datetime-local values. */
interface Draft { capacity: string; opens: string; closes: string }

const draftOf = (view: RegistrationView): Draft => ({
  capacity: view.registration_capacity === null ? '' : String(view.registration_capacity),
  opens: view.registration_opens_at ? isoToSgtLocal(view.registration_opens_at) : '',
  closes: view.registration_closes_at ? isoToSgtLocal(view.registration_closes_at) : '',
});

/** Only what differs from the stored settings is sent; null clears a setting. */
function changesOf(view: RegistrationView, draft: Draft): RegistrationSettingsInput {
  const stored = draftOf(view);
  const changes: RegistrationSettingsInput = {};
  if (draft.capacity.trim() !== stored.capacity) {
    changes.registration_capacity = draft.capacity.trim() === '' ? null : Number(draft.capacity.trim());
  }
  if (draft.opens !== stored.opens) changes.registration_opens_at = draft.opens ? sgtToIso(draft.opens) : null;
  if (draft.closes !== stored.closes) changes.registration_closes_at = draft.closes ? sgtToIso(draft.closes) : null;
  return changes;
}

function problemsOf(draft: Draft, view: RegistrationView): string[] {
  const registered = view.registered_count;
  const problems: string[] = [];
  // Once confirmed, a setting that is set stays set; closing early is the way to stop registration.
  const stored = draftOf(view);
  if (view.status === 'confirmed' && (['capacity', 'opens', 'closes'] as const)
    .some((field) => stored[field] !== '' && draft[field].trim() === '')) {
    problems.push('Capacity and opening and closing times cannot be cleared once the event is confirmed. Close registration early instead.');
  }
  const capacity = draft.capacity.trim();
  if (capacity !== '' && !(/^\d+$/.test(capacity) && Number(capacity) >= 1 && Number(capacity) <= MAX_CAPACITY)) {
    problems.push('Capacity must be a whole number of at least 1.');
  } else if (capacity !== '' && Number(capacity) < registered) {
    // Nobody already registered loses their place (capacity is at least 1, so two or more here).
    problems.push(`${registered} people are already registered, so the capacity cannot be lower than ${registered}.`);
  }
  if (draft.opens && draft.closes && sgtToIso(draft.closes) <= sgtToIso(draft.opens)) {
    problems.push('Registration must close after it opens.');
  }
  return problems;
}

function SettingsForm({ view, eventId, accessToken, onChanged }: {
  view: RegistrationView; eventId: number; accessToken: string; onChanged: (view: RegistrationView) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(view));
  const [busy, setBusy] = useState(false);
  // State updates land on the next render, so a second click in the same tick
  // would still see busy as false; the ref closes that gap.
  const inFlight = useRef(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const changes = changesOf(view, draft);
  const changed = Object.keys(changes).length > 0;
  // AC7: the warning follows the capacity being typed, before it is saved.
  const typed = /^\d+$/.test(draft.capacity.trim()) ? Number(draft.capacity.trim()) : null;
  const warnings = typed !== null && typed !== view.registration_capacity
    ? view.venues.filter((venue) => venue.capacity !== null && typed > venue.capacity)
      .map((venue) => `A capacity of ${typed} is more than ${venue.name} holds (${venue.capacity}).`)
    : [];

  const finish = (result: RegistrationResult, done: string) => {
    inFlight.current = false;
    setBusy(false);
    if (result.ok) {
      onChanged(result.view);
      setDraft(draftOf(result.view));
      setNotice(done);
    } else {
      setProblems(result.details.length > 0 ? [result.message, ...result.details] : [result.message]);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setNotice('');
    const found = problemsOf(draft, view);
    setProblems(found);
    if (found.length > 0 || !changed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    finish(await saveRegistrationSettings(eventId, accessToken, changes), 'Registration settings saved.');
  };

  // The button is disabled while anything is saving; marking the request in
  // flight stops a form submit landing straight after it.
  const closeNow = async () => {
    inFlight.current = true;
    setNotice('');
    setProblems([]);
    setBusy(true);
    finish(await closeRegistrationNow(eventId, accessToken), 'Registration is closed.');
  };

  return (
    <form className="registration-form" aria-label="Registration settings" onSubmit={(event) => void save(event)} noValidate>
      <h4>Registration settings</h4>
      <div className="registration-fields">
        <label>
          Capacity
          <input type="number" min={1} inputMode="numeric" value={draft.capacity} disabled={busy}
            onChange={(event) => setDraft({ ...draft, capacity: event.target.value })} />
        </label>
        <label>
          Opens (Singapore time)
          <input type="datetime-local" value={draft.opens} disabled={busy}
            onChange={(event) => setDraft({ ...draft, opens: event.target.value })} />
        </label>
        <label>
          Closes (Singapore time)
          <input type="datetime-local" value={draft.closes} disabled={busy}
            onChange={(event) => setDraft({ ...draft, closes: event.target.value })} />
        </label>
      </div>
      {warnings.length > 0 ? <Warnings warnings={warnings} /> : null}
      {view.window === 'closed' ? (
        <p className="organisation-detail-hint">Registration has closed. Set a later closing time and save to reopen it.</p>
      ) : null}
      {view.window === 'open' ? (
        <p className="organisation-detail-hint">Set a later closing time to extend registration, or close it now.</p>
      ) : null}
      {problems.length > 0 ? (
        <ul role="alert" className="registration-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      ) : null}
      {notice ? <p role="status" className="organisation-detail-hint">{notice}</p> : null}
      <div className="registration-row">
        <button type="submit" className="organisation-button organisation-button-primary" disabled={busy || !changed}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {view.window === 'open' ? (
          <button type="button" className="organisation-button" disabled={busy} onClick={() => void closeNow()}>
            Close registration now
          </button>
        ) : null}
      </div>
    </form>
  );
}
