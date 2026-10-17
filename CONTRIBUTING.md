# Contributing

How the team branches, commits and merges (SOP §3.1, Definition of Done v2.1).

## Branches

Branch from the latest `main`, one branch per story or bug:

```
feature/SG2-<id>-<short-description>   e.g. feature/SG2-57-event-outstanding-arrangements
bugfix/SG2-<id>-<short-description>    e.g. bugfix/SG2-26-coordinator-menu
```

Merge or rebase `main` into your branch regularly so conflicts surface early.

## Commits

Every commit title starts with the Jira story ID in square brackets, then a
conventional-commit type and optional scope:

```
[SG2-<id>] <type>(<scope>): <imperative summary, lowercase, no full stop>
```

Types: `feat`, `fix`, `test`, `docs`, `chore` (merges, inventory refreshes,
tooling), `style`. Leave a blank line, then a body: why the change was needed,
key decisions, what changed per area, and how it was verified.

## Pull requests

- Title the PR `[SG2-<id>] <summary>` and fill in every section of
  `.github/pull_request_template.md` (Test Case Inventory, DoD checklist,
  verification evidence).
- `main` is protected: a PR needs one approving review and a green
  **Build and test** check before it can merge.
- The reviewer posts the sign-off in `docs/test-peer-review-template.md`;
  a plain "LGTM" does not count.
- Tag every test with its category and AC, e.g.
  `[BOUNDARY] [SG2-39:AC2] rejects an event title of 256 characters`, and run
  `npm run test:inventory:update` after adding or renaming tests.
- Run `npm run ci` before pushing. Squash-merge once approved and delete the branch.
