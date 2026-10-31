# Digits-only numeric fields evidence

Captured from the actual application served on loopback with the isolated
in-memory regression fixtures (`e2e/server.ts`), in the pinned CI image
`mcr.microsoft.com/playwright:v1.63.0-noble`, at commit `450c3f1`. No hosted
account data is shown.

Each field was clicked and typed into one key at a time, so the browser ran
the same keydown and input handling a user's typing does. The screenshot is
taken after typing; the field holds only the digits.

| Screenshots | Field | Typed | Field value |
| --- | --- | --- | --- |
| `equipment-requirement-quantity-mobile.png`, `-desktop.png` | Quantity required (coordinator, Add equipment requirement) | `dasdd-1.5e12` | `1512` |
| `equipment-arrangement-shortfall-mobile.png`, `-desktop.png` | Shortfall quantity (Technical Support, Update equipment arrangement) | `abc-0.5` | `05` |
| `event-request-attendance-mobile.png`, `-desktop.png` | Expected attendance (organiser, New request) | `many-1.5e150` | `15150` |
| `venue-capacity-mobile.png`, `-desktop.png` | Capacity (Venue Staff, Add venue; a `type="number"` field) | `e-+.125` | `125` |

Mobile captures are 390 × 900 px and desktop captures 1440 × 1000 px. None of
the eight pages had horizontal overflow. `verification.json` records the typed
text, the resulting value and the overflow check for each capture.

These images show what reaches the field. Range checks (for example quantity
1 to 2,147,483,647) and server validation are unchanged and are verified by the
automated tests, not by these images.
