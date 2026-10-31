# UI hotfix evidence

Browser-rendered local component previews captured from the hotfix implementation:

- `event-search-desktop.png`: event search at a 1440 px viewport, showing consistent control spacing and inset dropdown arrows.
- `event-search-mobile.png`: event search at a 390 px viewport, showing single-column controls and inset arrows without horizontal overflow.
- `venue-search-desktop.png`: venue search at a 1440 px viewport, showing shared field spacing and dropdown styling.

These images show the actual form components rendered locally without live account data. Date restrictions are verified by the automated scheduling tests; a static image does not establish validation behavior.

Validation at code commit `98397f459a743d8eebc4f3c608428aa41c6029c2`: 1,831 frontend tests passed with 100% statement, branch, function and line coverage; all 10 affected equipment browser tests passed locally; the full CI run, staging walkthrough and security review passed on GitHub.


## Additional mobile form evidence (review follow-up)

The following screenshots were captured at a **390 × 900 px viewport** from the interactive application served only on loopback, using the isolated in-memory regression fixtures. They show actual loaded form controls rather than static substitutes. The browser clock was fixed to 31 October 2026 at 12:00 SGT and its timezone was UTC; availability timestamps returned by the local API use the fixture server's clock.

| Screenshot | Form state |
| --- | --- |
| `venue-blocks-mobile.png` | Venue block form with Renovation selected and a sample note. |
| `venue-holds-mobile.png` | Tentative hold form with event/venue dropdowns and all three date fields. |
| `venue-request-mobile.png` | Open venue request with the Theatre layout and Singapore-time period. |
| `event-request-mobile.png` | New organiser event request, including required fields, textarea spacing and action buttons. |
| `change-request-mobile.png` | Organiser change request with Event date and time selected. |
| `equipment-availability-mobile.png` | Expanded availability check with its loaded result and start/end fields. |
| `equipment-reservation-mobile.png` | Open reservation form with the suggested period and availability result. |
| `coordinator-assignment-mobile.png` | Coordination lead assignment form with a populated coordinator selector. |

All eight captures were inspected. The document and each captured form had **no horizontal overflow**. Every captured dropdown retained the custom arrow and **44 px right padding**. `mobile-verification.json` records the measured control widths and padding for each form. These screenshots establish mobile appearance; automated tests separately verify date rules, API validation and persistence. No hosted production account data is shown.


## Review follow-up validation scope

The follow-up restores ongoing venue blocks/holds to the existing server contract while preserving future end/expiry checks. New equipment reservation starts must be future instants at both the HTTP boundary and the locked database RPC. The shared end limit preserves valid millisecond periods.

Local frontend verification: all 1,836 tests passed across 108 files with 100% statement, branch, function and line coverage. The client production build passed. Direct-RPC database cases are included in `supabase/tests/equipment_reservations.sql`; their execution is verified by the follow-up CI run linked from the PR. No local database execution is claimed because a database service was unavailable.
