# Marcus — Task Progress Log

This file is read by the scheduled "Daily Sprint Standup" form-submission routine
(weekdays 3pm SGT). It has two parts:

1. **Checklist** — small, ordered subtasks. The routine picks the next unchecked
   item as "what I'll do today" (one small increment, not everything at once).
2. **Activity log** — dated bullets of what actually got done, appended after real
   coding sessions. The routine also reads `git log` since the last entry here to
   corroborate "what I did yesterday."

Jira tickets: [SG2-27](https://smu-spm-group.atlassian.net/browse/SG2-27) ·
[SG2-28](https://smu-spm-group.atlassian.net/browse/SG2-28) ·
[SG2-29](https://smu-spm-group.atlassian.net/browse/SG2-29)

## Checklist

### SG2-27 — Maintain my profile
- [ ] `server/src/db/` — profile table/query helpers
- [ ] `server/src/routes/profile.ts` — `GET /api/profile`
- [ ] `server/src/routes/profile.ts` — `PUT /api/profile` with validation (invalid contact details rejected with explanation)
- [ ] Internal-user department field included conditionally
- [ ] `server/src/routes/profile.test.ts`
- [ ] `client/src/pages/Profile.tsx` — view + edit form
- [ ] `client/src/Profile.test.tsx`

### SG2-28 — Create an event request
- [ ] Event requests table schema (status: draft/submitted, owner_id, org_id, all form fields, accessibility_needs nullable)
- [ ] `server/src/routes/event-requests.ts` — `POST /api/event-requests` (creates draft, no submission-required-field validation)
- [ ] Tests: partial-data draft succeeds; draft scoped to correct owner/org
- [ ] `client/src/pages/EventRequestForm.tsx` — create mode

### SG2-29 — Keep an event request as a draft
- [ ] `server/src/routes/event-requests.ts` — `PATCH /api/event-requests/:id` (owner + status=draft only)
- [ ] `server/src/routes/event-requests.ts` — `GET /api/event-requests/:id` (reopen)
- [ ] `server/src/routes/event-requests.ts` — `GET /api/event-requests` (list mine, includes status)
- [ ] Coordinator review-queue query excludes `status = 'draft'` (note contract for future story)
- [ ] `client/src/pages/EventRequestForm.tsx` — edit mode reusing create form
- [ ] `client/src/pages/MyEvents.tsx` — list with Draft/Submitted badge

## Activity Log

### 2026-09-08 (Mon)
- Set up GitHub + Jira access, cloned repo, mapped out the three tickets above into
  the checklist. No code written yet.
