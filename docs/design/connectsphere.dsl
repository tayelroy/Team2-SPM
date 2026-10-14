/*
 * ConnectSphere C4 model (C1 context, C2 containers, C3 API components).
 * As of main 1d1e336 (14 Oct 2026). Every element is traced to its source file
 * in docs/design/c4-notes.md, which also has the export/render commands.
 *
 * Tags: "Week 7" = added for the Week 7 customer changes (built);
 *       "Planned" = not built yet, the description names the Jira story.
 */
workspace "ConnectSphere" "Event Planning & Venue Booking System - C4 model as of main 1d1e336 (14 Oct 2026)" {

    model {
        # Roles: ROLES in server/src/auth/policy.ts. Full per-role capability list (PERMISSIONS + screens): c4-notes.md.
        eventOrganiser = person "Event Organiser" "Raises, edits, submits and deletes own event requests; follows their stage, history, clarifications and confirmation."
        eventCoordinator = person "Event Coordinator" "Reviews, decides and plans assigned events; requests venues (several per event) and equipment; confirms and completes events."
        eventCoordinatorLead = person "Event Coordinator Lead" "Assigns and reassigns coordinators from the unassigned queue (SG2-87, SG2-97)." {
            tags "Week 7"
        }
        safetyOfficer = person "Safety Officer" "Placeholder desk today; read-only stage, history and equipment placement via the API. Safety checks planned (SG2-91/92)." {
            tags "Week 7"
        }
        venueStaff = person "Venue Staff" "Maintains venues incl. setup/turnaround and safety details; marks venues unavailable; places holds; decides venue requests."
        technicalSupportStaff = person "Technical Support Staff" "Maintains equipment, checks availability and reserves it for events; changes user roles."
        attendee = person "Attendee" "Own profile only; event screens are a mock-data prototype, not wired to the API."

        connectSphere = softwareSystem "ConnectSphere" "Organisers request events; the Lead assigns coordinators; coordinators plan events and book venues and equipment; venue and support staff manage resources." {

            webApplication = container "Web Application" "React single-page app; one screen per task, role-specific dashboard. Served as static files by Vercel (server/public)." "React 18 + TypeScript, Vite"

            apiApplication = container "API Application" "JSON API for every feature; enforces authentication and role permissions on each request. Runs as one Vercel serverless function (server/api/index.js)." "Node.js + Express, TypeScript" {

                authMiddleware = component "requireAuth / requirePermission" "Rejects requests without exactly one Bearer token; resolves caller id and role (auth.getUser + account_roles); checks the route's permission against the policy." "auth/index.ts, auth/supabase.ts"
                policy = component "Permission policy" "ROLES (7, two added in SG2-86), PERMISSIONS map action -> roles, INTERNAL_ROLES. Actions without a grant are denied." "auth/policy.ts"

                authRoutes = component "Auth & role routes" "/api/auth/login (rate limited), /logout, /me; PATCH /api/users/:userId/role." "auth/login.ts, logout.ts, roles.ts"
                eventHandlers = component "Event request handlers" "/api/event-requests: draft CRUD, submit, list/detail, review, clarifications, decision, planning, stage, history, arrangements, confirm, confirmation, complete." "events/*.ts"
                assignment = component "Coordinator assignment" "/api/assignment-queue (SG2-87); GET /assignable and PATCH /:eventId/coordinator, Lead only (SG2-97)." "assignmentQueue/index.ts, events/listAssignable.ts, events/assignCoordinator.ts" {
                    tags "Week 7"
                }
                venueCatalogue = component "Venue catalogue & search" "/api/venues: CRUD, layouts, availability calendar, search, suitability; capacity exceptions on requests." "venues/index.ts, layouts.ts, availability.ts, search.ts, suitabilityRoutes.ts"
                venueOperations = component "Venue setup & safety details" "GET/PUT /api/venues/:venueId/operations: setup and turnaround minutes, emergency access, restrictions (SG2-77)." "venues/operations.ts" {
                    tags "Week 7"
                }
                venueBlocks = component "Venue unavailability" "/api/venues/:venueId/blocks: block or mark temporarily unavailable with a reason (SG2-45, SG2-80)." "venues/blocks.ts" {
                    tags "Week 7"
                }
                venueHolds = component "Tentative venue holds" "/api/venue-holds: list, options, notifications, place, release, convert (SG2-84/85)." "venues/holds.ts" {
                    tags "Week 7"
                }
                venueBooking = component "Venue requests & bookings" "/api/venue-booking-requests: request, list, conflicts, decision, withdraw (SG2-82); /api/venue-bookings: list, release." "venues/bookingRequests.ts, conflicts.ts, bookings.ts"
                venueClashes = component "Venue clashes" "GET /api/venue-clashes: bookings that clash once setup and turnaround apply (SG2-79)." "venues/clashes.ts" {
                    tags "Week 7"
                }
                equipment = component "Equipment" "/api/equipment, /api/equipment-requests (requirements, availability, reservation), /api/equipment-reservations." "equipment/*.ts"
                personal = component "Notifications, profile, work queue" "/api/notifications (own notices), /api/profile, /api/work-queue (internal role queues)." "notifications/, profile/, workQueue/"

                safetyCheck = component "Safety check review" "Planned SG2-91/92/93/94: Safety Officer passes, rejects or requests changes for events awaiting_safety_check. Statuses exist (SG2-100); no route or writer yet." "not built" {
                    tags "Planned"
                }
                venueReplacement = component "Venue replacement" "Planned SG2-81 (replace an unavailable venue) and SG2-83 (change or cancel one venue of several). Not built." "not built" {
                    tags "Planned"
                }

                userScopedDb = component "User-scoped DB adapters" "Supabase client carrying the caller's own JWT, so RLS applies; table reads/writes and RPC calls for venues, holds, bookings, equipment, confirmation, notifications." "db/user-client.ts + db/venue*.ts, equipment*.ts, eventConfirmation.ts, notifications.ts"
                serviceRoleDb = component "Service-role DB adapters" "Supabase client with the service-role key (bypasses RLS); handlers enforce ownership per row. Events, assignment, work queue, users and roles, audit log, server-raised notices." "db/supabase.ts + db/eventRequests.ts, assignmentQueue.ts, workQueue.ts, users.ts, accountRoles.ts, auditLogs.ts, eventNotifications.ts"
            }

            group "Supabase project (managed)" {
                supabaseAuth = container "Supabase Auth" "Email/password sign-in; issues and verifies the JWT access token. Accounts are pre-seeded (no self-registration)." "Supabase Auth (GoTrue)"
                rls = container "Row Level Security" "Policies on public tables limit an authenticated caller to rows their role may see or change (defence in depth behind the API's checks)." "PostgreSQL RLS policies"
                rpcs = container "SECURITY DEFINER RPCs & triggers" "Concurrency-sensitive writes lock rows and recheck the caller's role: decide/withdraw/release bookings, holds, confirm_event, equipment requirements/reservations; triggers flag disruptions and clashes." "PL/pgSQL functions"
                database = container "Postgres tables" "public schema: events, venues, venue_booking_requests, venue_bookings, venue_holds, venue_unavailability, venue_operations, equipment, notifications, event_audit_logs, account_roles, ..." "PostgreSQL (Supabase)" {
                    tags "Database"
                }
                holdCron = container "Hold-deadline job" "pg_cron job 'venue-hold-deadlines' every minute: select process_venue_hold_deadlines(); warns before expiry (24 h default) and expires holds." "pg_cron" {
                    tags "Week 7"
                }
            }

            # C2 relationships
            webApplication -> apiApplication "Calls /api/* with the Supabase access token as Bearer" "JSON/HTTPS"
            apiApplication -> supabaseAuth "Signs users in and out; verifies each Bearer token" "supabase-js, HTTPS"
            apiApplication -> rls "Reads/writes as the caller" "supabase-js, HTTPS"
            apiApplication -> rpcs "Calls RPCs as the caller" "supabase-js, HTTPS"
            apiApplication -> database "Service-role reads/writes (no RLS)" "supabase-js, HTTPS"
            rls -> database "Filters rows by caller's role"
            rpcs -> database "Locks rows, reads and writes"
            holdCron -> rpcs "Calls process_venue_hold_deadlines() every minute" "SQL"

            # C3 relationships (API components)
            webApplication -> authMiddleware "Every /api request except login and health" "JSON/HTTPS"
            webApplication -> authRoutes "Signs in / out" "JSON/HTTPS"
            authMiddleware -> policy "Checks role holds the action"
            authMiddleware -> supabaseAuth "auth.getUser(token)" "HTTPS"
            authMiddleware -> rls "Reads caller's account_roles row" "HTTPS"
            authRoutes -> supabaseAuth "signInWithPassword / signOut" "HTTPS"
            authRoutes -> serviceRoleDb "Updates account_roles"

            authMiddleware -> eventHandlers "Passes authorised requests"
            authMiddleware -> assignment "Passes authorised requests"
            authMiddleware -> venueCatalogue "Passes authorised requests"
            authMiddleware -> venueOperations "Passes authorised requests"
            authMiddleware -> venueBlocks "Passes authorised requests"
            authMiddleware -> venueHolds "Passes authorised requests"
            authMiddleware -> venueBooking "Passes authorised requests"
            authMiddleware -> venueClashes "Passes authorised requests"
            authMiddleware -> equipment "Passes authorised requests"
            authMiddleware -> personal "Passes authorised requests"
            authMiddleware -> safetyCheck "SG2-91/92" {
                tags "Planned"
            }
            authMiddleware -> venueReplacement "SG2-81/83" {
                tags "Planned"
            }

            eventHandlers -> serviceRoleDb "Events, clarifications, audit log, notices"
            eventHandlers -> userScopedDb "confirm_event, confirmation"
            assignment -> serviceRoleDb "Unassigned queue, coordinator, notices"
            venueCatalogue -> userScopedDb "Venues, layouts, availability"
            venueCatalogue -> serviceRoleDb "Suitability, capacity exceptions"
            venueOperations -> userScopedDb "venue_operations"
            venueBlocks -> userScopedDb "venue_unavailability"
            venueHolds -> userScopedDb "Hold RPCs"
            venueBooking -> userScopedDb "decide / withdraw / release RPCs"
            venueBooking -> serviceRoleDb "Requests, conflicts, booking lists"
            venueClashes -> serviceRoleDb "venue_booking_clashes"
            equipment -> userScopedDb "Equipment tables and RPCs"
            personal -> userScopedDb "Own notifications"
            personal -> serviceRoleDb "Profile, work queue"

            userScopedDb -> rls "Table reads and writes" "PostgREST, HTTPS"
            userScopedDb -> rpcs "rpc(...)" "PostgREST, HTTPS"
            serviceRoleDb -> database "Table reads and writes" "PostgREST, HTTPS"
        }

        # C1 relationships: what each role does today; planned ones dashed.
        eventOrganiser -> connectSphere "Raises, submits and tracks event requests"
        eventCoordinator -> connectSphere "Reviews, plans and books venues and equipment for assigned events"
        eventCoordinatorLead -> connectSphere "Assigns and reassigns coordinators from the unassigned queue" {
            tags "Week 7"
        }
        eventCoordinatorLead -> connectSphere "Oversight of coordinators (planned, SG2-89)" {
            tags "Planned"
        }
        safetyOfficer -> connectSphere "Signs in; read-only stage, history, equipment placement" {
            tags "Week 7"
        }
        safetyOfficer -> connectSphere "Records safety check decisions (planned, SG2-91/92)" {
            tags "Planned"
        }
        venueStaff -> connectSphere "Manages venues, unavailability, holds and venue requests"
        technicalSupportStaff -> connectSphere "Manages equipment and reservations; changes user roles"
        attendee -> connectSphere "Signs in; manages own profile"

        # C2 relationships: every role uses the browser app.
        eventOrganiser -> webApplication "Raises and tracks event requests" "HTTPS"
        eventCoordinator -> webApplication "Reviews, plans and books" "HTTPS"
        eventCoordinatorLead -> webApplication "Assigns coordinators" "HTTPS" {
            tags "Week 7"
        }
        eventCoordinatorLead -> webApplication "Oversight (planned, SG2-89)" {
            tags "Planned"
        }
        safetyOfficer -> webApplication "Signs in; placeholder desk" "HTTPS" {
            tags "Week 7"
        }
        safetyOfficer -> webApplication "Safety check decisions (planned, SG2-91/92)" {
            tags "Planned"
        }
        venueStaff -> webApplication "Manages venues and venue requests" "HTTPS"
        technicalSupportStaff -> webApplication "Manages equipment; changes roles" "HTTPS"
        attendee -> webApplication "Signs in; own profile" "HTTPS"
    }

    views {
        properties {
            # Emit the "Week 7"/"Planned" styles and the legend in the C4-PlantUML export.
            "c4plantuml.tags" "true"
        }

        systemContext connectSphere "C1_Context" {
            title "C1 System Context - ConnectSphere, as of main 1d1e336 (14 Oct 2026)"
            include *
            autoLayout tb
        }

        container connectSphere "C2_Containers" {
            title "C2 Containers - ConnectSphere, as of main 1d1e336 (14 Oct 2026)"
            include *
            autoLayout lr
        }

        # C3 is split over four views so each stays readable on one A4 landscape page.
        # Pages 2-4 omit the middleware's account_roles read (shown on page 1); with it,
        # the smetana layout pushes elements into the title.
        component apiApplication "C3_API_Components" {
            title "C3 Components (1/4) - API Application: request pipeline and auth - as of main 1d1e336 (14 Oct 2026)"
            include webApplication authRoutes authMiddleware policy serviceRoleDb supabaseAuth rls database
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Events" {
            title "C3 Components (2/4) - API Application: events, assignment, safety - as of main 1d1e336 (14 Oct 2026)"
            include webApplication authMiddleware eventHandlers assignment personal safetyCheck
            include userScopedDb serviceRoleDb rls rpcs database
            exclude "authMiddleware -> rls"
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Venues" {
            title "C3 Components (3/4) - API Application: venues, unavailability, holds - as of main 1d1e336 (14 Oct 2026)"
            include webApplication authMiddleware venueCatalogue venueOperations venueBlocks venueHolds
            include userScopedDb serviceRoleDb rls rpcs database holdCron
            exclude "authMiddleware -> rls"
            autoLayout lr
        }

        component apiApplication "C3_API_Components_Bookings" {
            title "C3 Components (4/4) - API Application: venue bookings, clashes, equipment - as of main 1d1e336 (14 Oct 2026)"
            include webApplication authMiddleware venueBooking venueClashes venueReplacement equipment
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
            element "Planned" {
                background #DDDDDD
                color #555555
                border dashed
            }
            relationship "Week 7" {
                color #c47f00
            }
            relationship "Planned" {
                style dashed
                color #888888
            }
        }
    }
}
