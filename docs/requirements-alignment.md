# Release 1 requirements alignment (SG2-96)

The C4, class, data, sequence and status models, and their editable sources, are in [`docs/design/`](design/) and were refreshed to main 4881413 on 3 Nov 2026. Earlier snapshots were attached to [PR #115's design-evidence comment](https://github.com/tayelroy/Team2-SPM/pull/115#issuecomment-6411646334).

Reviewed on 26 Oct 2026 and re-checked against main 4881413 (3 Nov 2026), which has all 23 Sprint 4 stories merged. Sources: the Week 4 Project Instructions (the 20 core features), the Week 7 Customer Changes (#1–#6), the clarification sessions 1–3 and the Week 9 answers, live Jira descriptions read on 26 Oct, and the merged implementation. Implementation status below does not assert a later Jira status change. Evidence IDs are scenarios in [`regression-cases.json`](regression-cases.json); the 26 Oct local post-merge results are recorded in [`regression-evidence-2026-10-26.md`](regression-evidence-2026-10-26.md) and describe that earlier branch, not main 4881413.

**Summary.** All 20 of the 20 core features and all six Week 7 changes are built and have automated coverage. The last three core features, which were partly built on 26 Oct, are complete: attendee registration (SG2-59–63, including the waiting list SG2-61 and withdrawal SG2-62), event change requests (SG2-64–66, including the coordinator's accept or refuse decision SG2-65) and notifications (SG2-68, 69, 102, including notices to registered attendees about event changes). Hosted post-merge regression and sign-off for main 4881413 is not recorded in this repository.

**Delivery trace.** The earlier b7e2b1a review checked 102 merged pull requests. SG2-29 (drafts) arrived with SG2-28's PR #18 and SG2-30's #75; the 10 closed-but-unmerged PRs were earlier attempts later re-opened and merged (SG2-23, 27, 30, 43), two CI-only experiments, a revert and a stand-up log. Since that review the remaining Sprint 4 stories have merged: PR #112 (SG2-60), #114 (SG2-64), #109 (SG2-59), #118 (SG2-62), #119 (SG2-65), #121 (SG2-102), #122 (SG2-61) and others, up to PR #129 at main 4881413; `git log --merges` on that commit lists 91 merge commits titled "Merge pull request".

## Core features (Week 4 Project Instructions)

| # | Feature | Stories | Status | Evidence |
|---|---|---|---|---|
| 1 | User Authorisation and Authentication | SG2-23, 24, 25, 26, 86, 90, 104 | Built | PW-AUTH-01, SG2-26-P01, SG2-90-P01, SG2-104-P01, DB-MULTI-ROLE-01 |
| 2 | Event Request Creation | SG2-28, 105 | Built | SG2-28-P01, SG2-105-P01 |
| 3 | Draft Event Requests | SG2-29, 32 | Built | SG2-29-P01, SG2-32-P01 |
| 4 | Event Review and Approval | SG2-35, 36, 37 | Built | SG2-35-P01, SG2-36-F01, SG2-37-P01 |
| 5 | Coordinator Assignment | SG2-33, 34, 87, 88, 89, 97 | Built (Week 7 #5) | SG2-88-P01, SG2-89-P01, SG2-97-P01 |
| 6 | Event Status Management | SG2-31, 38, 58, 67, 100 | Built | SG2-100-P01, SG2-58-N01, SG2-67-C01 |
| 7 | Event Information Management | SG2-39, 40, 41, 70 | Built | SG2-39-DB-PLANNING-DETAILS, SG2-40-C01, SG2-41-P01, SG2-70-P01 |
| 8 | Venue Catalogue | SG2-42, 43, 77, 106 | Built | SG2-42-P01, DB-LAYOUT-01, SG2-77-P01, SG2-106-INT01 |
| 9 | Venue Availability Calendar | SG2-44, 78 | Built | SG2-44-P01, SG2-78-P01 |
| 10 | Venue Search and Filtering | SG2-46 | Built | SG2-46-P01 |
| 11 | Venue Suitability Checking | SG2-47 | Built | SG2-47-P01, SG2-47-CAPACITY-DISCOVERY-01 |
| 12 | Venue Booking Request | SG2-48, 82, 83, 84 | Built | SG2-48-P01, SG2-82-P01, SG2-83-P01, SG2-84-P01 |
| 13 | Venue Booking Approval | SG2-49, 51 | Built | SG2-49-P01, SG2-51-P01 |
| 14 | Booking Conflict Detection | SG2-45, 50, 78, 79, 80, 81, 98 | Built | SG2-50-P01, SG2-79-P01, SG2-80-P01, SG2-98-P01 |
| 15 | Equipment Request Management | SG2-53, 57 | Built | SG2-53-C01, REG-EQUIPMENT-SUMMARY-AND-READINESS-REFRESH |
| 16 | Equipment Availability Checking | SG2-52, 54 | Built | SG2-52-C01, SG2-54-P01 |
| 17 | Equipment Reservation | SG2-55, 56 | Built | SG2-55-C01, SG2-56-DB01 |
| 18 | Attendee Registration | SG2-59, 60, 61, 62, 63 | Built | SG2-59-P01, SG2-59-N01, SG2-60-P01, SG2-60-N01, SG2-61-P01, SG2-61-N01, SG2-62-P01, SG2-62-P02, SG2-62-N01, SG2-63-P01. An attendee finds events open for registration, registers with contact details and needs, receives confirmation and cannot register twice; joins the waiting list when the event is full (first come first served); and sees and withdraws their own registrations. The organiser sees who registered and sets capacity and times. See [`registrations.md`](registrations.md). |
| 19 | Event Change Requests | SG2-64, 65, 66 | Built | SG2-64-P01, SG2-64-N01, SG2-64-C01, SG2-64-DB01, SG2-65-P01, SG2-65-P02, SG2-65-N01, SG2-65-DB01, SG2-66-F01, SG2-66-DB01. Organisers raise persisted requests and the assigned coordinator is notified; both can view them. The coordinator sees the impact, then accepts through SG2-66 (confirmed-event lock, return to Planning) or refuses with a reason; the decider, time and reason are recorded and the organiser is notified; see [`change-requests.md`](change-requests.md) and [`change-impact.md`](change-impact.md). |
| 20 | Notification System | SG2-68, 69, 102 | Built | SG2-68-F01, SG2-69-API01, SG2-102-P01, SG2-102-N01. In-app notices, the inbox and reminders are built, including SG2-64's coordinator change-request notice and SG2-102's notice to each registered attendee when an event's date or confirmed venues change; see [`notifications.md`](notifications.md). |

## Week 7 customer changes

| # | Change | Stories | Status | Evidence |
|---|---|---|---|---|
| 1 | Venue setup and turnaround time | SG2-77, 78, 79 | Built | SG2-77-P01, SG2-78-P01, SG2-79-P01 |
| 2 | Venue becomes unavailable after booking | SG2-80, 81, 98 | Built | SG2-80-P01, SG2-81-HOTFIX-NOTIFICATION-CONTRACT |
| 3 | Multiple venues for one event | SG2-82, 83 | Built | SG2-82-P01, SG2-83-P01 |
| 4 | Tentative venue holds expire | SG2-84, 85, 106 | Built | SG2-84-P01, SG2-85-P01, SMOKE-HOLD-EXPIRY-01 |
| 5 | Event Coordinator Lead role | SG2-86, 87, 88, 89, 90, 97, 100 | Built | SG2-87 cases, SG2-88-P01, SG2-89-P01, SG2-90-P01 |
| 6 | Operational safety check | SG2-86, 91, 92, 93, 94, 100 | Built | SG2-91-P01, SG2-92-INT01, SG2-93-INT01, SG2-94-DB01, SG2-96-E2E01, SG2-96-INT01 |

## Clarifications

| Clarification | Status |
|---|---|
| One account may hold several roles (15 Oct) | Built: SG2-104 |
| Venue Staff may delete a venue and change a hold's expiry (15 Oct; Week 9: Venue Staff set and update the hold duration) | Built: SG2-106 |
| Once Preparation or Confirmed, details are read-only; an accepted significant change returns the event to Planning and every check runs again (15 Oct; Week 9) | Built: SG2-66, SG2-94 AC3 |
| Reminders about outstanding arrangements (15 Oct) | Built: SG2-69 |
| Waiting list, first come first served (15 Oct) | Built: SG2-61 |
| Organisers cannot edit after submission; edits go through the coordinator (Week 9) | Built: organisers raise and view persisted change requests and cannot edit a submitted request directly, including during clarification (SG2-64); the coordinator sees the impact and accepts (SG2-66) or refuses with a reason (SG2-65). |
| A failed safety check sends the event back to planning (Week 9) | Built in two steps: Reject records the reason and moves the event to `safety_rejected`; the coordinator's rework (SG2-92 AC4) returns it to Planning. Request Changes returns it to Planning directly (SG2-93). Worth confirming with the customer that the two-step Reject is acceptable. |
| The Safety Officer approves rather than enters data, and the system records comments (Week 9) | Built: decisions keep the reason and who decided (SG2-92) |
| Several Leads, each seeing every unassigned event; the Lead can reassign (Week 9) | Built: SG2-87/88 |
| Self-registration is out of scope (Week 9) | Respected: accounts are pre-seeded; no signup route |
| Multi-session events are separate venue requests within one event (Week 9) | Built: SG2-82 |

## Non-functional requirements

See [`nfr-capacity-review.md`](nfr-capacity-review.md) for performance, scalability (year-3 volumes and concurrent users), the per-role walkthrough and maintainability (adding a role or a status, also in [`design/c4-notes.md`](design/c4-notes.md#extensibility-adding-a-role-or-a-status-sg2-96-nfr)). Security and auditability are covered by SG2-25/26/90 and SG2-40.
