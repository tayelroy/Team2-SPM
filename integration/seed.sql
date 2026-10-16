-- Synthetic identities only; run in the disposable integration database.
insert into auth.users(id) values
('ee000000-0000-4000-8000-000000000001'),
('ee000000-0000-4000-8000-000000000002'),
('ee000000-0000-4000-8000-000000000003'),
('ee000000-0000-4000-8000-000000000004'),
('ee000000-0000-4000-8000-000000000005'),
('ee000000-0000-4000-8000-000000000006') on conflict do nothing;
insert into public.users(user_id,name,role_id,organisation) values
('ee000000-0000-4000-8000-000000000001','Integration organiser',1,'Integration organisation'),
('ee000000-0000-4000-8000-000000000002','Integration coordinator',2,null),
('ee000000-0000-4000-8000-000000000003','Integration lead',6,null),
('ee000000-0000-4000-8000-000000000004','Integration venue staff',3,null),
('ee000000-0000-4000-8000-000000000005','Integration support',4,null),
('ee000000-0000-4000-8000-000000000006','Integration other coordinator',2,null)
on conflict do nothing;
insert into public.account_roles(user_id,role) values
('ee000000-0000-4000-8000-000000000001','event_organiser'),
('ee000000-0000-4000-8000-000000000002','event_coordinator'),
('ee000000-0000-4000-8000-000000000003','event_coordinator_lead'),
('ee000000-0000-4000-8000-000000000004','venue_staff'),
('ee000000-0000-4000-8000-000000000005','technical_support_staff'),
('ee000000-0000-4000-8000-000000000006','event_coordinator') on conflict do nothing;
