# Staging acceptance checkpoint — 16 October 2026

The current automated checks and the bounded hosted journeys below passed. **This is not clearance of every Done acceptance criterion.** The refreshed Jira scope contains **53 Done Stories and 7 Done Tasks**. Safety integration, production attendee registration, legitimate downstream lifecycle fixtures and independent human review retain explicit limits.

## Source and automated evidence

Application source: [`16bc79e8572b58c1c45177b6c8728f53482f480b`](https://github.com/tayelroy/Team2-SPM/tree/16bc79e8572b58c1c45177b6c8728f53482f480b). All eight jobs, including the aggregate, passed in [CI run 38851781255](https://github.com/tayelroy/Team2-SPM/actions/runs/38851781255); Vercel reported success. The actual checkout was synthetic merge `396891185e1b50dd07ff3e6817c89f2df6fe1b6d`. Its complete Git tree `6e7c5e00298dff6dceb4d22780408635fb779b60` exactly matches the source head. This is tree equivalence, not a claim that CI literally checked out the head SHA.

Verified job logs record:

- Backend **1,468** and frontend **1,433** tests passed; both applications have **100% statements, branches, functions and lines** coverage.
- Native PostgreSQL/PostgREST integration **12**, release-readiness checks **15**, and browser regression **113** passed. The separate **4** smoke journeys are a subset of those 113, not four additional unique journeys.
- Database execution completed **30 core plus 2 upgrade SQL scripts** and **31 standalone race/control scenarios**. Script counts are not counts of every SQL assertion.
- Source inventory contains **2,421 methods and 779 SQL assertions** across 169 executable test files. Inventory/policy checks **18**, regression-report checks **13**, and automated reviewer tests **19** passed. These counts are different evidence layers, not one acceptance denominator.

CI browser journeys use the real application and local controlled fixtures. They are separate from actual hosted data and the manual business changes below.

## Hosted observations

The historical **0c46** Playwright run passed **7 role cases**, visiting **47 page checkpoints** and recording **94 PNGs and 7 WebMs** at 390/1440px. All images are covered by the visual review: 36 changed originals were directly inspected, and 58 exact SHA/role/page/width matches inherited prior reviewed-image verdicts. No confirmed loading capture, overflow, overlap or unreadable control was found within that recorded scope.

This full role run was **not repeated on 16bc**. The later 16bc targeted Accessibility test passed at desktop width: blank filter returned 4 venues; manual `ramp` returned no matches and displayed the applied criterion; clearing it returned 4. The corrected hint remained truthful. No new phone or whole-source-equivalence claim is made.

The following final manual batches ran through normal hosted UI on **16bc at 1280×720**, using supplied QA accounts. They were not extra automated Playwright cases.

| Batch | Actual result and acceptance scope |
| --- | --- |
| **R1 — existing records** | Owner Organiser2 read rejected event **21**, its reason, coordinator-directed revision guidance and actual rejection actor/time history. The Rejected list filter worked. Coordinator1's removed-assignment notice, Coordinator2's receiving notice and owner notices for event25 were read. Existing zero-buffer venues showed 0/0 and missing safety text as “Not recorded.” Covers selected SG2-31/37/68/77/88 clauses; does not prove hidden-control server refusals or a Safety review. |
| **R2 — one new request** | Event **26**, `QA16OctRemainingAcceptance`, saved and reopened incomplete, listing five missing required fields with submission disabled. Complete values persisted. Submission appeared as Awaiting Assignment to the owner and in the Lead queue with all five required facts. Lead assigned directly to Coordinator2; opening it caused Under Review, separately visible to the owner before approval. Normal approval enabled planning and recorded actor/time/history and owner notices. Closes the previously missing owner-visible SG2-35 AC2 and queue facts/status clauses in SG2-87/100. |
| **R3 — equipment metadata** | The unused **QA 16Oct Status Probe** persisted changed type, description, location and held quantity 2→3 with Operational status. All original fields were restored and reopened exactly. Combined with earlier creation/status evidence, this covers the normal SG2-52 AC1 workflow. |
| **R4 — positive shortfall** | Pending equipment request **5** for event25 changed quantity 1→3. Support saved a shortfall of **1** and arrangement notes; Coordinator2's refresh showed the same values, no placement and Outstanding readiness. Restoring quantity1 and original technical notes cleared arrangement/shortfall/placement back to “Not recorded”; both roles saw the restored Pending request, with no reservations. Covers the previously unobserved nonzero-shortfall SG2-53 AC5 clause. |
| **R5 — independent venues and replacement** | For event26 on **27 November, 13:00–14:00 SGT**, request **28** committed Capacity Room booking **22**. A Maintenance block over that booking succeeded and flagged the event without cancellation. Request **29** independently committed Replacement Room booking **23** despite the other venue's problem. Replacement request **30** remained pending without prematurely releasing22, then approval committed Test Room booking **24**, releasing **only22** and cancelling request28. Bookings23/24 remained Confirmed; all two needed venues and overall arrangements showed Ready. Owner history and coordinator/owner notices recorded the actions. Covers normal occupied-block, replacement and independent multi-venue clauses in SG2-80/81/82. |

### Cleanup at this checkpoint

New bookings **23 and 24 were normally released with reasons**; the follow-up list shows all three new requests Cancelled and bookings22/23/24 Released. That intentional cleanup does not invalidate the earlier Ready observation. Equipment request5 and probe metadata are restored. Fresh readback confirms original booking **16** remains Confirmed on 23 November, 11:00–12:00, and booking **20** remains Confirmed, 12:25–13:25. Event22 remains Ready with one venue and two equipment requests reserved and placed (microphone3 and projector1).

Following explicit action-time confirmation, the new Capacity Room block was removed through normal UI. Readback says the room is available again on 27 November, 13:00–14:00, with no upcoming blocks; the recorded QA journal has no pending restorations. Event26 remains a retained QA request; it was not deleted or forced through later states.

## Limits that remain

- SG2-58 confirmation requires a legitimate Preparation event. Current Safety writers SG2-91–94 remain planned; visible arrangement readiness does not establish Safety approval. SG2-100's literal Safety-readiness clause remains a delivery dependency.
- SG2-58 AC3 depends on production attendee registration SG2-59–63. Attendee prototype screens do not fulfil it. Completion and the Preparation/Confirmed→Planning reversal need legitimate eligible fixtures; no hosted state or time was fabricated.
- Incomplete submission and direct-edit protection were observed as UI prevention. Server refusal, role/ownership denial, null/range and concurrency branches retain their CI/native/API evidence; every such branch is not a new mandatory hosted journey.
- Coordinator2 correctly displays “No phone number on file”; this does not prove a populated contact value. Masked profile phone evidence, Safety projections and venue-audit provenance retain their stated qualifications.
- The seven engineering Tasks require their own repository/design/setup evidence. Branch protection/access, independent PR review, clean setup replay, usability and performance measurements are separate from these business journeys. Automated reviewer tests are not human approval.

The earlier **44-cell Sheet follow-up passed strict native workbook readback**. Final manual observations were then published and independently verified: **94 changed cells across 31 Main rows**, preserving 162 historical cells and 31 source URLs; the **six-cell cleanup follow-up** preserved 17 historical cells and two source URLs. Both strict readbacks passed with zero unexpected value, hyperlink, style, filter, freeze or dimension changes. No new cases or human reviews were invented.

The verified workbook SHA-256 values are native export23 `485b2d436de683ce450b52a535aeb7c9e79d0282e57ddf0f3b29366f4c650ab8` and export25 `ee8f6596fcec06f974c8a2e0fe1b76cd41b0e283f4cdacbcc4896f7279357d62`. The business reconciliation below predates these final Sheet exports; the two final readback proofs supersede its pending-publication note.

## Local evidence index

These are durable **ignored local artifacts**, not files included in the Git commit. The relative links work in the workspace; retain the evidence bundle when sharing this report. SHA-256 values below identify the exact recorded files.

| Evidence | SHA-256 |
| --- | --- |
| [Current CI proof](../output/staging-e2e-2026-10-16/verification/16bc-ci-proof/full-ci-evidence.json) | `a12cbd6c3da55eb9c64a56a7ce6f8c5e09fb1152656f5e1c76efcf6039f0a674` |
| [Historical 0c46 visual review](../output/staging-e2e-2026-10-16/verification/hosted-playwright-0c46-visual-review.json) | `b48bd37fbcc212825804c96556ef6de7e67bbf8ba409ff139e116c52e900c5a5` |
| [16bc targeted hint proof](../output/staging-e2e-2026-10-16/verification/accessibility-hint-16bc-scoped-proof.json) | `1fdccfe990c6c6246981cdf7eba369f20690548b0be2908f3dbc9a5003eb6178` |
| [Owner Under Review](../output/staging-e2e-2026-10-16/verification/done-final26-owner-under-review-16bc.txt) | `6a64445ae08d24662ddd666b014cc3ea54bbaa0812397ae3f95c9f646706e931` |
| [Equipment restored](../output/staging-e2e-2026-10-16/verification/done-final25-shortfall-restored-coordinator-16bc.txt) | `4d3824c4f82877643df28a78f2d918aa9181a53d1eb8fda82748a7e38d7a2b23` |
| [Replacement target and Ready result](../output/staging-e2e-2026-10-16/verification/done-final26-replacement-target-only-ready-16bc.txt) | `7b438b6c4d9f304d5560325e8bfa834b49f61e7f8799b42df88b0b6add25498f` |
| [New bookings released](../output/staging-e2e-2026-10-16/verification/done-final26-new-bookings-released-cleanup-16bc.txt) | `6b1eef5d72f6bb145c502ffd6427a750786393f88d02071e0b5ae82538fc7f12` |
| [44-cell strict Sheet readback](../output/staging-e2e-2026-10-16/verification/spm-16bc-small-native-xlsx-readback.json) | `4625544a11d41b2609e4004dd5ba18b821cc892f05c9896409b72e948efa3cb9` |
| [Original16 preserved](../output/staging-e2e-2026-10-16/verification/done-final22-original-booking16-preserved-16bc.txt) | `1e5df7f88488bc1c3af9a0a48440effe82132aa690eb60171b95022c015e2083` |
| [Original20 preserved](../output/staging-e2e-2026-10-16/verification/done-final25-original-booking20-preserved-16bc.txt) | `8bc719656bfb024008efac07d12f817429181991a1591d0272756d453e349dbe` |
| [Original readiness and equipment preserved](../output/staging-e2e-2026-10-16/verification/done-final22-original-readiness-equipment-preserved-16bc.txt) | `9d3ddb91e8e62f5bbe64e2d4a008a82f800f07a47360f778f768bd88c000cb0d` |
| [New block removal and availability readback](../output/staging-e2e-2026-10-16/verification/done-final26-block-removed-cleanup-16bc.txt) | `a6f598b0354cd0d5eb9a4c5e0d047ecb2e2baefe5e778d69e8d618266fb22abe` |
| [Scoped reconciliation before final Sheet readback](../output/staging-e2e-2026-10-16/verification/done-final-scoped-reconciliation-16bc.json) | `eba3ddb15e23ff6f1857380a0f55bc813a286f3e9d5d94d45b7520e9b2848f52` |
| [Final 94-cell strict Sheet readback](../output/staging-e2e-2026-10-16/verification/spm-finite-16bc-native-xlsx-readback.json) | `bf2872e4241097c366f886448a0411d757188a24ee1e330ea251e9f75432ab43` |
| [Six-cell cleanup strict Sheet readback](../output/staging-e2e-2026-10-16/verification/spm-finite-block-cleanup-16bc-native-xlsx-readback.json) | `70b90018cd4d0182b4e24c05876b7a151efdd3a03cfca4653c7be22119743939` |
