/*
 * ConnectSphere C4 model (C1 context, C2 containers, C3 API components).
 * As of main 4881413 (3 Nov 2026). Every element is traced to its source file
 * in docs/design/c4-notes.md, which also has the export/render commands.
 *
 * Tags: "Week 7" = added for the Week 7 customer changes (built).
 * Everything modelled here is built.
 */
workspace "ConnectSphere" "Event Planning & Venue Booking System - C4 model as of main 4881413 (3 Nov 2026)" {

    model {
        # Roles: ROLES in server/src/auth/policy.ts. Full per-role capability list (PERMISSIONS + screens): c4-notes.md.
        # An account can hold several roles and acts as one per request (SG2-104, X-Acting-Role).
        eventOrganiser = person "Event Organiser" "Raises, edits, submits and deletes own event requests; follows their stage, history, clarifications and confirmation; asks for a change or a cancellation after submitting; sees registrations and sets registration capacity and times (SG2-63/64/67)."
        eventCoordinator = person "Event Coordinator" "Reviews, decides and plans assigned events; requests venues (several per event, change or cancel one) and equipment; accepts or refuses change requests; cancels events; confirms and completes events."
        eventCoordinatorLead = person "Event Coordinator Lead" "Assigns and reassigns coordinators from the unassigned queue (SG2-87, SG2-97); oversees the coordinators and events they assigned (SG2-89)." {
            tags "Week 7"
        }
        safetyOfficer = person "Safety Officer" "Works an own queue of events awaiting an operational safety check and records Approve, Reject or Request Changes with a reason (SG2-91/92/93/94); reads venue safety details and equipment placement." {
            tags "Week 7"
        }
        venueStaff = person "Venue Staff" "Maintains venues incl. setup/turnaround and safety details; deletes unused venues; marks venues unavailable; places holds and changes their expiry; decides venue requests; confirms venues sent back by a safety decision."
        technicalSupportStaff = person "Technical Support Staff" "Maintains equipment, checks availability and reserves it for events; confirms equipment sent back by a safety decision; changes user roles."
        attendee = person "Attendee" "Finds events open for registration, registers, joins the waiting list when an event is full, sees and withdraws own registrations; manages own profile (SG2-59/60/61/62)."

        connectSphere = softwareSystem "ConnectSphere" "Organisers request events; the Lead assigns coordinators; coordinators plan events and book venues and equipment; the Safety Officer checks them; attendees register; venue and support staff manage resources." {

            webApplication = container "Web Application" "React single-page app; one screen per task, role-specific dashboard, a role switcher for multi-role accounts (names the acting role in X-Acting-Role) and, for attendees, FindEvents and MyRegistrations. Served as static files by Vercel (server/public)." "React 18 + TypeScript, Vite"

            apiApplication = container "API Application" "JSON API for every feature; enforces authentication and role permissions on each request. Runs as one Vercel serverless function (server/api/index.js)." "Node.js + Express, TypeScript" {

                authMiddleware = component "requireAuth / requirePermission" "Rejects requests without exactly one Bearer token; resolves caller id and every role held (auth.getUser + account_roles); picks the acting role from X-Acting-Role (SG2-104); checks the route's permission against the policy for that role." "auth/index.ts, auth/supabase.ts, auth/actingRole.ts"
                policy = component "Permission policy" "ROLES (7, two added in SG2-86), PERMISSIONS map action -> roles, INTERNAL_ROLES. Actions without a grant are denied." "auth/policy.ts"

                authRoutes = component "Auth & role routes" "/api/auth/login (rate limited), /logout, /me; PATCH /api/users/:userId/role (change_account_roles: replaces the account's roles; refuses self-changes)." "auth/login.ts, logout.ts, roles.ts"
                eventHandlers = component "Event request handlers" "/api/event-requests: draft CRUD, submit, list/detail, review, clarifications, decision, planning, stage, history, arrangements, confirm, confirmation, complete." "events/*.ts"
                assignment = component "Coordinator assignment" "/api/assignment-queue (SG2-87); GET /assignable and PATCH /:eventId/coordinator, Lead only (SG2-97)." "assignmentQueue/index.ts, events/listAssignable.ts, events/assignCoordinator.ts" {
                    tags "Week 7"
                }
                coordinatorOverview = component "Coordinator oversight" "GET /api/coordinator-overview: the events whose coordinator this Lead assigned (events.coordinator_assigned_by) and each coordinator's active events (SG2-89)." "coordinatorOverview/index.ts, db/coordinatorOverview.ts" {
                    tags "Week 7"
                }
                eventSearch = component "Cross-system event search" "GET /api/event-search and /options: search by name or organisation and filter by date, state, venue, category and coordinator; internal roles only, calls search_events() (SG2-70)." "eventSearch/index.ts, db/eventSearch.ts"
                eventCancellation = component "Event cancellation" "POST /api/event-requests/:eventId/cancellation-request (creating organiser) and PATCH /:eventId/cancel (assigned coordinator): releases venue bookings and holds, cancels open requests, equipment is released by trigger (SG2-67, SG2-56)." "events/cancellation.ts, db/eventCancellation.ts"
                changeRequests = component "Event change requests" "POST/GET /api/event-requests/:eventId/change-requests (organiser raises, both see); .../:changeRequestId/accept and /refuse (coordinator, with impact); POST .../rechecks/:key/settle (SG2-64/65/66)." "events/changeRequests.ts, events/changeImpact.ts, db/changeRequests.ts, db/changeImpact.ts"
                safetyCheck = component "Safety check review" "GET /api/safety-checks (queue); POST .../safety-decision (Approve / Reject / Request Changes), GET .../safety-decisions, POST .../rework; GET /api/safety-rereviews and POST /:reviewId/confirm for the arrangements a Request Changes decision sent back to Venue Staff or Technical Support (SG2-91/92/93). Preparation is only reachable through an Approve decision: safety_approval_gate trigger, confirm_event (SG2-94)." "safetyChecks/index.ts, events/safetyDecisionRoutes.ts, events/safetyRereviewRoutes.ts, db/safetyChecks.ts, db/safetyDecisions.ts, db/safetyRereviews.ts" {
                    tags "Week 7"
                }
                attendeeRegistration = component "Attendee registration & waiting list" "/api/registrable-events: list, detail, POST /:eventId/registrations, POST and DELETE /:eventId/waiting-list; /api/my-registrations: list and POST /:registrationId/withdrawal (SG2-59/60/61/62)." "registrableEvents/index.ts, registrableEvents/registration.ts, myRegistrations/index.ts, db/registrableEvents.ts, db/myRegistrations.ts"
                registrationManagement = component "Registration overview & settings" "GET /api/event-requests/:eventId/registrations (who registered, waiting list); PATCH .../registration-settings and POST .../registration-settings/close, creating organiser only (SG2-63, SG2-61 AC7)." "events/registrationRoutes.ts, events/registrationSettings.ts, events/registrationWindow.ts, db/registrations.ts"
                venueCatalogue = component "Venue catalogue & search" "/api/venues: CRUD (DELETE calls delete_venue(), which soft-deletes an unused venue: SG2-106), layouts, availability calendar, search, suitability; capacity exceptions on requests." "venues/index.ts, layouts.ts, availability.ts, search.ts, suitabilityRoutes.ts"
                venueOperations = component "Venue setup & safety details" "GET/PUT /api/venues/:venueId/operations: setup and turnaround minutes, emergency access, restrictions (SG2-77); the Safety Officer may read them (SG2-77 AC5)." "venues/operations.ts" {
                    tags "Week 7"
                }
                venueBlocks = component "Venue unavailability" "/api/venues/:venueId/blocks: block or mark temporarily unavailable with a reason (SG2-45, SG2-80)." "venues/blocks.ts" {
                    tags "Week 7"
                }
                venueHolds = component "Tentative venue holds" "/api/venue-holds: list, options, notifications, place, release, convert, POST /:holdId/expiry (change_venue_hold_expiry, SG2-106) (SG2-84/85)." "venues/holds.ts" {
                    tags "Week 7"
                }
                venueBooking = component "Venue requests & bookings" "/api/venue-booking-requests: request, list, conflicts, decision, withdraw (SG2-82); /api/venue-bookings: list, release." "venues/bookingRequests.ts, conflicts.ts, bookings.ts"
                venueClashes = component "Venue clashes" "GET /api/venue-clashes: bookings that clash once setup and turnaround apply (SG2-79)." "venues/clashes.ts" {
                    tags "Week 7"
                }
                equipment = component "Equipment" "/api/equipment, /api/equipment-requests (requirements, availability, reservation), /api/equipment-reservations." "equipment/*.ts"
                personal = component "Notification inbox, profile, work queue" "/api/notifications: own notices, /inbox, /read-all, /:source/:id/read and /event, /reminder-preferences (SG2-69); /api/profile; /api/work-queue (internal role queues)." "notifications/, profile/, workQueue/"

                venueReplacement = component "Venue replacement (existing booking routes)" "SG2-81: affected bookings/readiness; POST /api/venue-booking-requests with replaces_booking_id; existing decision RPC atomically approves the new booking and releases the old one." "venues/bookingRequests.ts, db/venueDisruptions.ts, db/venueBookings.ts" {
                    tags "Week 7"
                }

                venueChange = component "Change/cancel one venue" "SG2-83: POST /api/venue-bookings/:bookingId/release (reason; other bookings cancelled only if named in also_cancel) calls release_venue_bookings(); a change is a replacement request carrying change_reason. Venue Staff are notified; Confirmed/Preparation returns to Planning with a venue recheck. Distinct from SG2-81 replacement of an unavailable booking." "venues/bookings.ts, venues/bookingRequests.ts, db/venueBookings.ts; 202610210002_venue_booking_change_cancel.sql" {
                    tags "Week 7"
                }

                userScopedDb = component "User-scoped DB adapters" "Supabase client carrying the caller's own JWT and acting role, so RLS applies; table reads/writes and RPC calls for venues, holds, bookings, equipment, confirmation, cancellation, event search, registrations, safety queue, notifications." "db/user-client.ts + db/venue*.ts, equipment*.ts, eventConfirmation.ts, eventCancellation.ts, eventSearch.ts, registrableEvents.ts, myRegistrations.ts, safetyChecks.ts, notifications.ts, notificationInbox.ts"
                serviceRoleDb = component "Service-role DB adapters" "Supabase client with the service-role key (bypasses RLS); handlers enforce ownership per row. Events, assignment, oversight, work queue, users and roles, audit log, change requests and impact, registration overview and settings, safety decisions and re-reviews, server-raised notices." "db/supabase.ts + db/eventRequests.ts, assignmentQueue.ts, coordinatorOverview.ts, workQueue.ts, users.ts, accountRoles.ts, auditLogs.ts, changeRequests.ts, changeImpact.ts, registrations.ts, safetyDecisions.ts, safetyRereviews.ts, eventNotifications.ts"
            }

            group "Supabase project (managed)" {
                supabaseAuth = container "Supabase Auth" "Email/password sign-in; issues and verifies the JWT access token. Accounts are pre-seeded (no self-registration)." "Supabase Auth (GoTrue)"
                rls = container "Row Level Security" "Policies on public tables limit an authenticated caller to rows their role may see or change (defence in depth behind the API's checks); acting_role() narrows a multi-role account to one role per request." "PostgreSQL RLS policies"
                rpcs = container "SECURITY DEFINER RPCs & triggers" "Concurrency-sensitive writes lock rows and recheck the caller's acting role: decide/withdraw/release bookings, holds, delete_venue, confirm_event, equipment requirements/reservations, registration, waiting list, withdrawal, cancellation, safety queue and decision, change requests, search and notification inbox. Triggers: disruption notices, safety hand-off and approval gate, equipment release on cancellation, attendee change notices, cancelled events stay cancelled." "PL/pgSQL functions"
                database = container "Postgres tables" "public schema (30 tables): events, venues, venue_booking_requests, venue_bookings, venue_holds, venue_unavailability, venue_operations, equipment, notifications, event_audit_logs, account_roles, registrations, waiting_list_entries, event_change_requests, event_safety_decisions, safety_rereviews, notification_reminder_*, ...; private.event_attendee_details." "PostgreSQL (Supabase)" {
                    tags "Database"
                }
                cronJobs = container "Scheduled jobs" "pg_cron: 'venue-hold-deadlines' and 'registration-windows' and 'waiting-list-offers' every minute (process_venue_hold_deadlines, process_registration_windows, process_waiting_list_offers); 'sg2-69-arrangement-reminders' hourly (send_outstanding_arrangement_reminders). Holds warn before expiry (24 h default) and expire." "pg_cron"
            }

            # C2 relationships
            webApplication -> apiApplication "Calls /api/* with the Supabase access token as Bearer (and X-Acting-Role for multi-role accounts)" "JSON/HTTPS"
            apiApplication -> supabaseAuth "Signs users in and out; verifies each Bearer token" "supabase-js, HTTPS"
            apiApplication -> rls "Reads/writes as the caller" "supabase-js, HTTPS"
            apiApplication -> rpcs "Calls RPCs as the caller" "supabase-js, HTTPS"
            apiApplication -> database "Service-role reads/writes (no RLS)" "supabase-js, HTTPS"
            rls -> database "Filters rows by caller's role"
            rpcs -> database "Locks rows, reads and writes"
            cronJobs -> rpcs "Calls the scheduled process_* / send_* functions" "SQL"

            # C3 relationships (API components)
            webApplication -> authMiddleware "Every /api request except login and health" "JSON/HTTPS"
            webApplication -> authRoutes "Signs in / out" "JSON/HTTPS"
            authMiddleware -> policy "Checks the acting role holds the action"
            authMiddleware -> supabaseAuth "auth.getUser(token)" "HTTPS"
            authMiddleware -> rls "Reads caller's account_roles rows" "HTTPS"
            authRoutes -> supabaseAuth "signInWithPassword / signOut" "HTTPS"
            authRoutes -> serviceRoleDb "change_account_roles"

            authMiddleware -> eventHandlers "Passes authorised requests"
            authMiddleware -> assignment "Passes authorised requests"
            authMiddleware -> coordinatorOverview "Passes authorised requests (SG2-89)"
            authMiddleware -> eventSearch "Passes authorised requests (SG2-70)"
            authMiddleware -> eventCancellation "Passes authorised requests (SG2-67)"
            authMiddleware -> changeRequests "Passes authorised requests (SG2-64/65/66)"
            authMiddleware -> safetyCheck "Passes authorised requests (SG2-91/92/93)"
            authMiddleware -> attendeeRegistration "Passes authorised requests (SG2-59/60/61/62)"
            authMiddleware -> registrationManagement "Passes authorised requests (SG2-63)"
            authMiddleware -> venueCatalogue "Passes authorised requests"
            authMiddleware -> venueOperations "Passes authorised requests"
            authMiddleware -> venueBlocks "Passes authorised requests"
            authMiddleware -> venueHolds "Passes authorised requests"
            authMiddleware -> venueBooking "Passes authorised requests"
            authMiddleware -> venueClashes "Passes authorised requests"
            authMiddleware -> equipment "Passes authorised requests"
            authMiddleware -> personal "Passes authorised requests"
            authMiddleware -> venueReplacement "Existing booking permissions (SG2-81)"
            authMiddleware -> venueChange "Passes authorised requests (SG2-83)"

            eventHandlers -> serviceRoleDb "Events, clarifications, audit log, notices"
            eventHandlers -> userScopedDb "confirm_event, confirmation"
            assignment -> serviceRoleDb "Unassigned queue, coordinator, notices"
            coordinatorOverview -> serviceRoleDb "Supervised events, coordinators"
            eventSearch -> userScopedDb "search_events, event_search_options"
            eventCancellation -> userScopedDb "request_event_cancellation, cancel_event"
            changeRequests -> serviceRoleDb "event_change_requests, impact facts, raise / decide / apply / settle RPCs"
            safetyCheck -> userScopedDb "safety_check_queue"
            safetyCheck -> serviceRoleDb "record_safety_decision, rework, safety re-review RPCs"
            attendeeRegistration -> userScopedDb "registrable_events, register_for_event, waiting-list and withdraw RPCs"
            registrationManagement -> serviceRoleDb "event_registration_overview, update_registration_settings"
            venueCatalogue -> userScopedDb "Venues, layouts, availability, delete_venue"
            venueCatalogue -> serviceRoleDb "Suitability, capacity exceptions"
            venueOperations -> userScopedDb "venue_operations"
            venueBlocks -> userScopedDb "venue_unavailability"
            venueHolds -> userScopedDb "Hold RPCs incl. expiry"
            venueBooking -> userScopedDb "decide / withdraw / release RPCs"
            venueBooking -> serviceRoleDb "Requests, conflicts, booking lists"
            venueReplacement -> serviceRoleDb "Affected bookings, replacement requests, readiness"
            venueReplacement -> userScopedDb "Existing decide_venue_booking_request RPC"
            venueChange -> userScopedDb "release_venue_bookings RPC"
            venueChange -> serviceRoleDb "Change (replacement) requests with change_reason"
            venueClashes -> serviceRoleDb "venue_booking_clashes"
            equipment -> userScopedDb "Equipment tables and RPCs"
            personal -> userScopedDb "Own notifications, inbox and reminder RPCs"
            personal -> serviceRoleDb "Profile, work queue"

            userScopedDb -> rls "Table reads and writes" "PostgREST, HTTPS"
            userScopedDb -> rpcs "rpc(...)" "PostgREST, HTTPS"
            serviceRoleDb -> database "Table reads and writes" "PostgREST, HTTPS"
            serviceRoleDb -> rpcs "Service-only rpc(...)" "PostgREST, HTTPS"
        }

        # C1 relationships: what each role does today.
        eventOrganiser -> connectSphere "Raises, submits and tracks event requests; asks for changes and cancellation; manages registration"
        eventCoordinator -> connectSphere "Reviews, plans and books venues and equipment for assigned events; decides change requests; cancels events"
        eventCoordinatorLead -> connectSphere "Assigns and reassigns coordinators; oversees the coordinators they assigned" {
            tags "Week 7"
        }
        safetyOfficer -> connectSphere "Records safety check decisions (Approve, Reject, Request Changes)" {
            tags "Week 7"
        }
        venueStaff -> connectSphere "Manages venues, unavailability, holds and venue requests"
        technicalSupportStaff -> connectSphere "Manages equipment and reservations; changes user roles"
        attendee -> connectSphere "Finds events, registers, joins waiting lists, withdraws; manages own profile"

        # C2 relationships: every role uses the browser app.
        eventOrganiser -> webApplication "Raises and tracks event requests" "HTTPS"
        eventCoordinator -> webApplication "Reviews, plans and books" "HTTPS"
        eventCoordinatorLead -> webApplication "Assigns coordinators; oversight" "HTTPS" {
            tags "Week 7"
        }
        safetyOfficer -> webApplication "Safety queue and decisions" "HTTPS" {
            tags "Week 7"
        }
        venueStaff -> webApplication "Manages venues and venue requests" "HTTPS"
        technicalSupportStaff -> webApplication "Manages equipment; changes roles" "HTTPS"
        attendee -> webApplication "Finds events, registers; own registrations and profile" "HTTPS"
    }

    views {
        properties {
            # Emit the "Week 7" style and the legend in the C4-PlantUML export.
            "c4plantuml.tags" "true"
        }

        systemContext connectSphere "C1_Context" {
            title "C1 System Context - ConnectSphere, as of main 4881413 (3 Nov 2026)"
            include *
            autoLayout tb
        }

        container connectSphere "C2_Containers" {
            title "C2 Containers - ConnectSphere, as of main 4881413 (3 Nov 2026)"
            include *
            autoLayout lr
        }

        # C3 is split over six views so each stays readable on one A4 landscape page.
        # Pages 2-6 omit the middleware's account_roles read (shown on page 1); with it,
        # the smetana layout pushes elements into the title.
        component apiApplication "C3_API_Components" {
            title "C3 Components (1/6) - API Application: request pipeline and auth - as of main 4881413 (3 Nov 2026)"
            include webApplication authRoutes authMiddleware policy serviceRoleDb supabaseAuth rls database
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Events" {
            title "C3 Components (2/6) - API Application: events, assignment, oversight, search, notifications - as of main 4881413 (3 Nov 2026)"
            include webApplication authMiddleware eventHandlers assignment coordinatorOverview eventSearch personal
            include userScopedDb serviceRoleDb rls rpcs database
            exclude "authMiddleware -> rls"
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Changes" {
            title "C3 Components (3/6) - API Application: change requests, cancellation, safety check - as of main 4881413 (3 Nov 2026)"
            include webApplication authMiddleware changeRequests eventCancellation safetyCheck
            include userScopedDb serviceRoleDb rls rpcs database
            exclude "authMiddleware -> rls"
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Registrations" {
            title "C3 Components (4/6) - API Application: attendee registration and waiting list - as of main 4881413 (3 Nov 2026)"
            include webApplication authMiddleware attendeeRegistration registrationManagement
            include userScopedDb serviceRoleDb rls rpcs database cronJobs
            exclude "authMiddleware -> rls"
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Venues" {
            title "C3 Components (5/6) - API Application: venues, unavailability, holds - as of main 4881413 (3 Nov 2026)"
            include webApplication authMiddleware venueCatalogue venueOperations venueBlocks venueHolds
            include userScopedDb serviceRoleDb rls rpcs database cronJobs
            exclude "authMiddleware -> rls"
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Bookings" {
            title "C3 Components (6/6) - API Application: venue bookings, clashes, change/cancel one venue, equipment - as of main 4881413 (3 Nov 2026)"
            include webApplication authMiddleware venueBooking venueClashes venueReplacement venueChange equipment
            include userScopedDb serviceRoleDb rls rpcs database
            exclude "authMiddleware -> rls"
            autoLayout lr
        }

        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
            element "Database" {
                shape cylinder
            }
            element "Week 7" {
                background #f5a623
                color #000000
            }
            relationship "Week 7" {
                color #c47f00
            }
        }
    }
}
