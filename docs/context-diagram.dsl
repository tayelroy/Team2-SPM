workspace "ConnectSphere" "Event Planning & Venue Booking System — C1/C2 model" {

    model {
        eventOrganiser         = person "Event Organiser" "Raises, edits, submits and tracks event requests."
        eventCoordinator       = person "Event Coordinator" "Reviews event requests and checks venue availability." {
            tags "Planned"
        }
        venueStaff             = person "Venue Staff" "Manages venue records and availability."
        technicalSupportStaff  = person "Technical Support Staff" "Administers user accounts and roles." {
            tags "Planned"
        }
        attendee               = person "Attendee" "Views event and venue information." {
            tags "Planned"
        }

        connectSphere = softwareSystem "ConnectSphere" "Lets organisers request events, coordinators and venue staff manage bookings, and attendees view events." {

            webApplication = container "Web Application" "Delivers the ConnectSphere experience to all user roles in the browser." "React 18 + TypeScript (Vite SPA)"

            apiApplication = container "API Application" "Provides event, venue and user functionality via a JSON/HTTPS API; enforces authentication and role-based permissions." "Node.js + Express (TypeScript)"

            database = container "Supabase" "Stores application data and manages user identity and authentication." "Supabase (PostgreSQL + Auth)" {
                tags "Database"
            }

            webApplication -> apiApplication "Makes API calls to" "JSON/HTTPS"
            apiApplication -> database "Reads and writes application data, and verifies user identity against" "HTTPS/REST (Supabase client SDK)"
        }

        eventOrganiser        -> connectSphere "Submits, edits and tracks event requests"
        eventCoordinator      -> connectSphere "Reviews event requests and checks venue availability (planned, Sprint 2)" {
            tags "Planned"
        }
        venueStaff            -> connectSphere "Manages venue records and availability"
        technicalSupportStaff -> connectSphere "Administers user accounts and roles (planned, beyond current sprints)" {
            tags "Planned"
        }
        attendee              -> connectSphere "Views event and venue information (planned, Sprint 3-4)" {
            tags "Planned"
        }

        eventOrganiser        -> webApplication "Submits, edits and tracks event requests"
        eventCoordinator      -> webApplication "Reviews event requests and checks venue availability (planned, Sprint 2)" {
            tags "Planned"
        }
        venueStaff            -> webApplication "Manages venue records and availability"
        technicalSupportStaff -> webApplication "Administers user accounts and roles (planned, beyond current sprints)" {
            tags "Planned"
        }
        attendee              -> webApplication "Views event and venue information (planned, Sprint 3-4)" {
            tags "Planned"
        }
    }

    views {
        systemContext connectSphere "C1_Context" {
            include *
            autoLayout
        }

        container connectSphere "C2_Containers" {
            include *
            autoLayout
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
            element "Database" {
                shape cylinder
            }
            element "Planned" {
                background #ffffff
                color #999999
                border dashed
            }
            relationship "Planned" {
                style dashed
                color #999999
            }
        }
    }
}
