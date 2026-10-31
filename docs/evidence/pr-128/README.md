# UI hotfix evidence

Browser-rendered local component previews captured from the hotfix implementation:

- `event-search-desktop.png`: event search at a 1440 px viewport, showing consistent control spacing and inset dropdown arrows.
- `event-search-mobile.png`: event search at a 390 px viewport, showing single-column controls and inset arrows without horizontal overflow.
- `venue-search-desktop.png`: venue search at a 1440 px viewport, showing shared field spacing and dropdown styling.

These images show the actual form components rendered locally without live account data. Date restrictions are verified by the automated scheduling tests; a static image does not establish validation behavior.

Validation at code commit `98397f459a743d8eebc4f3c608428aa41c6029c2`: 1,831 frontend tests passed with 100% statement, branch, function and line coverage; all 10 affected equipment browser tests passed locally; the full CI run, staging walkthrough and security review passed on GitHub.
