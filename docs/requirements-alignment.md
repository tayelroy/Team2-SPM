# Release 1 requirements alignment (SG2-96)

Read on 26 Oct 2026 against main b7e2b1a plus the SG2-96 branch. Sources: the Week 4 Project Instructions (the 20 core features), the Week 7 Customer Changes (#1–#6), the clarification sessions 1–3 and the Week 9 answers, and live Jira statuses on 26 Oct. Evidence IDs are scenarios in [`regression-cases.json`](regression-cases.json); the 26 Oct regression run is recorded in [`regression-evidence-2026-10-26.md`](regression-evidence-2026-10-26.md).

**Summary.** 17 of the 20 core features and all six Week 7 changes are built and covered. Three core features are partly built; their remaining stories are To Do in Jira: attendee registration (SG2-60/61/62), event change requests (SG2-64/65) and attendee notices about event changes (SG2-102).

**Delivery trace.** All 102 merged pull requests were checked on 26 Oct. Every Done story has merged code: SG2-29 (drafts) arrived with SG2-28's PR #18 and SG2-30's #75. The 10 closed-but-unmerged PRs are earlier attempts later re-opened and merged (SG2-23, 27, 30, 43), two CI-only experiments, a revert and a stand-up log. Two Sprint 4 PRs are open: #112 (SG2-60) and #114 (SG2-64).

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
| 18 | Attendee Registration | SG2-59, 63 built; **SG2-60 in review (PR #112)**; **SG2-61, 62 To Do** | **Partly built** | SG2-59-P01, SG2-63-P01. Registering, refusal when full with the first-come-first-served waiting list (15 Oct), and seeing and withdrawing a registration are not built. The attendee's My registrations and Event page still show the prototype's sample data until then. |
| 19 | Event Change Requests | SG2-66 built; **SG2-64 in review (PR #114)**; **SG2-65 To Do** | **Partly built** | SG2-66-F01, SG2-66-DB01. The impact check, the confirmed-event lock and the return to Planning are built, but change requests come from an in-memory source (`server/src/changeRequests/mockChangeRequests.ts`), so an organiser cannot raise one and a coordinator cannot decide one. |
| 20 | Notification System | SG2-68, 69 built; **SG2-102 To Do** | **Mostly built** | SG2-68-F01, SG2-69-API01. In-app notices and reminders are built; notices to registered attendees about event changes wait on SG2-102 (and on registration itself). |

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
| Waiting list, first come first served (15 Oct) | **To Do**: SG2-61 |
| Organisers cannot edit after submission; edits go through the coordinator (Week 9) | Direct edits are refused (SG2-37/39); the change-request route is **To Do** (SG2-64/65) |
| A failed safety check sends the event back to planning (Week 9) | Built in two steps: Reject records the reason and moves the event to `safety_rejected`; the coordinator's rework (SG2-92 AC4) returns it to Planning. Request Changes returns it to Planning directly (SG2-93). Worth confirming with the customer that the two-step Reject is acceptable. |
| The Safety Officer approves rather than enters data, and the system records comments (Week 9) | Built: decisions keep the reason and who decided (SG2-92) |
| Several Leads, each seeing every unassigned event; the Lead can reassign (Week 9) | Built: SG2-87/88 |
| Self-registration is out of scope (Week 9) | Respected: accounts are pre-seeded; no signup route |
| Multi-session events are separate venue requests within one event (Week 9) | Built: SG2-82 |

## Non-functional requirements

See [`nfr-capacity-review.md`](nfr-capacity-review.md) for performance, scalability (year-3 volumes and concurrent users), the per-role walkthrough and maintainability (adding a role or a status, also in [`design/c4-notes.md`](design/c4-notes.md#extensibility-adding-a-role-or-a-status-sg2-96-nfr)). Security and auditability are covered by SG2-25/26/90 and SG2-40.
