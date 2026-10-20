-- SG2-70: hand-picked categories for the events already in the live project,
-- so the category filter has a realistic spread to demonstrate. NOT a
-- migration and NOT run by CI. Run it by hand (Supabase SQL Editor or psql)
-- after 202610200003_event_search.sql, which has already given every event a
-- category inferred from its name (mostly Other for these test events).
--
-- Each row is matched on both its id and its name as read on 2026-10-20, so it
-- cannot touch any other event; anything renamed since is left as it is. It
-- only sets a category, so re-running it changes nothing more. It does not
-- write event_audit_logs: it is a one-off data correction, not an organiser's
-- edit. See docs/release-readiness.md.
begin;

with picked(event_id, name, category) as (values
  (10, 'Meridian Capital Q4 Client & Investor Forum', 'conference'),
  (13, 'Test Draft', 'seminar'),
  (17, 'Test Event #2', 'workshop'),
  (18, 'sprint2', 'workshop'),
  (19, 'QA 15Oct Workflow', 'training'),
  (20, 'QA 15Oct Complete Request', 'seminar'),
  (21, 'QA 15Oct Reasoned Rejection', 'networking'),
  (22, 'QA 15Oct Phone Request', 'seminar'),
  (23, 'QA 16Oct Audit Probe', 'training'),
  (25, 'QA 16Oct Separate Organisation Access', 'conference'),
  (26, 'QA16OctRemainingAcceptance', 'workshop'),
  (27, 'E2E16-LC Lifecycle Forum', 'conference'),
  (29, 'E2E16-VN Main', 'conference'),
  (30, 'E2E16-VN Over', 'networking'),
  (31, 'E2E16-VN Second', 'seminar'),
  (32, 'E2E16-EQ Gala', 'social'),
  (33, 'E2E16-EQ Simple', 'workshop'),
  (34, 'E2E16-EQ Overlap', 'social'),
  (35, 'E2E16-LC Reject Probe', 'training'),
  (37, 'E2E16-AU Queue Probe', 'networking')
)
update public.events e
  set category = picked.category
  from picked
  where e.event_id = picked.event_id and e.name = picked.name
    and e.category is distinct from picked.category;

commit;
