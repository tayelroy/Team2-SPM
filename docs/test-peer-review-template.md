# Test Case Peer Review & Sign-Off

Copy this template into a PR review comment after inspecting the test methods and current CI evidence. A bare “LGTM” does not satisfy the supplied DoD.

Reviewer: @…
Feature / story: …
Traceability target: …
Reviewed head SHA: …
CI run evidence: …

## 1. Test Case Inventory Audit & Tag Verification

| Test method / file / scenario | Category tag | AC mapped | Reviewer verification notes |
| --- | --- | --- | --- |
| | `[NORMAL]` | | Exact returned or stored success values |
| | `[BOUNDARY]` | | Exact limit and adjacent accepted/rejected values |
| | `[CONFLICT]` | | Duplicate action, stale state or competing arrangement; resulting state and side effects |
| | `[FAILURE]` | | Unauthorized input/provider failure; safe response and refused side effects |

List any AC that has only partial supporting evidence or no implemented path. Check both the story-to-method matrix and each method's mapping; a tag alone is insufficient.

## 2. TDD & Quality Checklist

- [ ] Public seam: API, exported service, component workflow or SQL policy; no private implementation assertion.
- [ ] Independent oracle: literal expected outputs or independently specified fixtures.
- [ ] Category completeness: all four categories are meaningful for the feature; exceptions are explained.
- [ ] Determinism: clocks/data are controlled, no timing sleeps, no shared persistent records, no retries hiding failures.
- [ ] Side effects: denied/conflicting operations preserve stored state or make zero writes where required.
- [ ] Coverage: 100% per application file for statements, branches, functions and lines on the reviewed head.
- [ ] Historical test-first claims have evidence, or the PR explicitly makes no such claim.
- [ ] Known implementation gaps and environment limits have been assessed.

## 3. Review Verdict

**APPROVED**: explain why the reviewed scope satisfies the DoD and identify any separately tracked feature gaps.

**CHANGES REQUESTED**: list the specific method, missing AC or assertion that needs correction.

Choose one verdict after the audit. Author validation does not substitute for an independent review.
