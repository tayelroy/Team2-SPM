/**
 * Fixture content for the ConnectSphere mockups. Everything here is static
 * sample data — the screens are a clickable prototype, not wired to the API.
 */

import { color } from '../theme';
import type {
  ActionItem,
  ContentScreen,
  EquipmentRequest,
  EventRecord,
  Notification,
  Role,
  Screen,
  Stat,
  Venue,
} from './types';

export const EVENTS: EventRecord[] = [
  {
    ref: 'E-205',
    name: 'Product Launch — Tideline',
    client: 'Meridian Capital',
    status: 'Draft',
    date: '20 Nov 2026',
    venue: '—',
    attendance: 300,
    coordinator: 'Unassigned',
    purpose:
      'Public launch of the Tideline product line with press and partner attendance.',
  },
  {
    ref: 'E-201',
    name: 'Northbridge Investor Forum',
    client: 'Meridian Capital',
    status: 'Under review',
    date: '12 Oct 2026',
    venue: 'Kelp Room (proposed)',
    attendance: 180,
    coordinator: 'A. Vance',
    purpose:
      'A half-day forum for institutional partners: two keynotes, a panel, and a standing reception.',
  },
  {
    ref: 'E-198',
    name: 'Quarterly Partner Dinner',
    client: 'Northbridge LLP',
    status: 'Confirmed',
    date: '3 Nov 2026',
    venue: 'The Kelp Room',
    attendance: 90,
    coordinator: 'A. Vance',
    purpose: 'Seated dinner for partner firms with a short address.',
  },
  {
    ref: 'E-190',
    name: 'Grad Recruitment Open Day',
    client: 'Internal — People',
    status: 'Planning',
    date: '28 Sep 2026',
    venue: 'Atrium Hall',
    attendance: 240,
    coordinator: 'R. Okafor',
    purpose:
      'Campus recruitment day: talks, stands, and interviews across the morning.',
  },
  {
    ref: 'E-186',
    name: 'Board Strategy Offsite',
    client: 'Internal — Exec',
    status: 'Approved',
    date: '15 Oct 2026',
    venue: 'Meridian Studio',
    attendance: 24,
    coordinator: 'A. Vance',
    purpose: 'Closed-door strategy session with catering and AV recording.',
  },
  {
    ref: 'E-181',
    name: 'Community Sponsorship Night',
    client: 'Harbour Trust',
    status: 'Rejected',
    date: '9 Sep 2026',
    venue: '—',
    attendance: 400,
    coordinator: 'R. Okafor',
    purpose:
      'Sponsorship showcase evening; no venue of sufficient capacity was free.',
  },
];

/** Nav items per role — the mockup scopes navigation, not just data. */
export const NAV: Record<Role, [Screen, string][]> = {
  'Event Organiser': [
    ['dashboard', 'My events'],
    ['form', 'New request'],
    ['detail', 'Event detail'],
    ['change', 'Change request'],
  ],
  'Event Coordinator': [
    ['dashboard', 'Dashboard'],
    ['events', 'All events'],
    ['detail', 'Review'],
    ['venues', 'Venues'],
    ['calendar', 'Calendar'],
    ['equipment', 'Equipment'],
  ],
  'Venue Staff': [
    ['dashboard', 'Dashboard'],
    ['booking', 'Booking requests'],
    ['calendar', 'Availability'],
    ['venues', 'Catalogue'],
  ],
  'Technical Support Staff': [
    ['dashboard', 'Dashboard'],
    ['equipment', 'Equipment requests'],
    ['calendar', 'Schedule'],
  ],
  Attendee: [
    ['dashboard', 'My registrations'],
    ['attendee', 'Event page'],
  ],
};

export const HEAD: Record<
  Role,
  { eyebrow: string; title: string; blurb: string }
> = {
  'Event Organiser': {
    eyebrow: 'Event Organiser · Meridian Capital',
    title: 'Your events',
    blurb:
      'Two requests are moving, one is still a draft. Anything waiting on you is marked below.',
  },
  'Event Coordinator': {
    eyebrow: 'Event Coordinator · A. Vance',
    title: 'Coordination desk',
    blurb:
      'Requests assigned to you, plus venue and equipment arrangements still outstanding.',
  },
  'Venue Staff': {
    eyebrow: 'Venue Staff · Atrium & Harbour',
    title: 'Venue desk',
    blurb:
      'Booking requests awaiting a decision, with overlaps flagged before you approve.',
  },
  'Technical Support Staff': {
    eyebrow: 'Technical Support · AV',
    title: 'Equipment desk',
    blurb:
      'Equipment requests to check and reserve. Reservations reduce availability for overlapping events.',
  },
  Attendee: {
    eyebrow: 'Attendee · J. Halloran',
    title: 'My registrations',
    blurb:
      "Events you can register for and the ones you're already on the list for.",
  },
};

/** Screens whose heading is fixed. The dashboard's comes from HEAD instead. */
export const PAGE_TITLE: Record<ContentScreen, string> = {
  events: 'All events',
  detail: 'Event detail',
  form: 'Event request',
  venues: 'Venue catalogue',
  calendar: 'Venue availability',
  booking: 'Booking approval',
  equipment: 'Equipment requests',
  attendee: 'Event page',
  change: 'Change request',
};

export const PAGE_BLURB: Record<ContentScreen, string> = {
  events:
    'Every event you have access to, with its current status in plain language.',
  detail: 'Full request, activity trail, and the actions available to you.',
  form: 'Save as a draft at any point — nothing is sent until you submit.',
  venues:
    'Filter by date, capacity, accessibility and layout. Suitability is checked as you go.',
  calendar:
    'Available, held, confirmed and blocked days for the selected venue.',
  booking: 'Approve or reject with a reason. Overlaps are detected automatically.',
  equipment:
    'Check availability and reserve. Reserving reduces stock for overlapping events.',
  attendee: 'Confirmed event details, registration, and your current status.',
  change:
    'Ask for a change after submission — the coordinator sees the knock-on impact.',
};

export const STATS: Record<Role, Stat[]> = {
  'Event Organiser': [
    { value: '1', label: 'Draft' },
    { value: '1', label: 'Awaiting review' },
    { value: '1', label: 'Confirmed' },
    { value: '2', label: 'Updates for you' },
  ],
  'Event Coordinator': [
    { value: '3', label: 'Needs review' },
    { value: '5', label: 'Assigned to me' },
    { value: '2', label: 'Venues outstanding' },
    { value: '1', label: 'Equipment conflict' },
  ],
  'Venue Staff': [
    { value: '4', label: 'Booking requests' },
    { value: '1', label: 'Conflicts flagged' },
    { value: '6', label: 'Venues live' },
    { value: '9', label: 'Confirmed this month' },
  ],
  'Technical Support Staff': [
    { value: '5', label: 'Equipment requests' },
    { value: '1', label: 'Shortfall' },
    { value: '12', label: 'Items reserved' },
    { value: '31', label: 'Items in stock' },
  ],
  Attendee: [
    { value: '2', label: 'Registered' },
    { value: '1', label: 'Waiting on confirmation' },
    { value: '3', label: 'Open to register' },
    { value: '0', label: 'Withdrawn' },
  ],
};

export const ACTIONS: Record<Role, ActionItem[]> = {
  'Event Coordinator': [
    {
      title: 'E-201 clarification pending',
      body: 'Catering headcount and stage size still unanswered.',
      dot: color.accent,
      screen: 'detail',
    },
    {
      title: 'Atrium Hall booking overlaps E-190',
      body: 'Requested 10:00–17:00 clashes with a 09:00–13:00 hold.',
      dot: color.accent,
      screen: 'booking',
    },
    {
      title: 'Projector shortfall for E-201',
      body: '2 requested, 1 free in the window.',
      dot: color.accent,
      screen: 'equipment',
    },
    {
      title: 'Change request on E-198',
      body: 'Organiser asked to raise attendance from 90 to 140.',
      dot: color.teal,
      screen: 'change',
    },
  ],
  'Event Organiser': [
    {
      title: 'E-201 — your coordinator has a question',
      body: 'Confirm catering headcount and whether the stage needs a lectern.',
      dot: color.accent,
      screen: 'detail',
    },
    {
      title: 'E-205 is still a draft',
      body: 'Nothing has been sent yet — submit when the details are settled.',
      dot: color.accent,
      screen: 'form',
    },
    {
      title: 'E-198 is confirmed',
      body: 'Venue and equipment are settled; registration is open.',
      dot: color.teal,
      screen: 'detail',
    },
  ],
  'Venue Staff': [
    {
      title: 'Atrium Hall — overlap flagged',
      body: 'E-201 10:00–17:00 clashes with a 09:00–13:00 hold on 12 Oct.',
      dot: color.accent,
      screen: 'booking',
    },
    {
      title: '3 booking requests awaiting a decision',
      body: 'Deepwater Auditorium, Harbour Terrace and Meridian Studio.',
      dot: color.accent,
      screen: 'booking',
    },
    {
      title: 'Maintenance block 24–25 Oct',
      body: 'Atrium Hall is unavailable for those two days.',
      dot: color.slate,
      screen: 'calendar',
    },
  ],
  'Technical Support Staff': [
    {
      title: 'Projector shortfall — E-201',
      body: '2 requested, only 1 free in the 12 Oct window.',
      dot: color.accent,
      screen: 'equipment',
    },
    {
      title: '4 requests awaiting reservation',
      body: 'PA system, hearing loop kit, risers and mic set.',
      dot: color.accent,
      screen: 'equipment',
    },
    {
      title: 'Risers reserved for E-190',
      body: 'Unavailable to other events on 28 Sep.',
      dot: color.teal,
      screen: 'equipment',
    },
  ],
  Attendee: [
    {
      title: 'Registration closes 8 Oct',
      body: 'Northbridge Investor Forum — 42 places left.',
      dot: color.accent,
      screen: 'attendee',
    },
    {
      title: 'Quarterly Partner Dinner is 3 Nov',
      body: "You're registered. Venue: The Kelp Room.",
      dot: color.teal,
      screen: 'attendee',
    },
    {
      title: 'Grad Recruitment Open Day',
      body: "Registration isn't open yet — we'll let you know.",
      dot: color.slate,
      screen: 'dashboard',
    },
  ],
};

export const PRIMARY_ACTION: Record<Role, { label: string; screen: Screen }> = {
  'Event Organiser': { label: 'New event request', screen: 'form' },
  'Event Coordinator': { label: 'Search venues', screen: 'venues' },
  'Venue Staff': { label: 'Open availability', screen: 'calendar' },
  'Technical Support Staff': { label: 'Check availability', screen: 'equipment' },
  Attendee: { label: 'Browse events', screen: 'attendee' },
};

export const PIPELINE = [
  { label: 'Draft', count: 2, pct: '18%' },
  { label: 'Under review', count: 3, pct: '34%' },
  { label: 'Planning', count: 4, pct: '48%' },
  { label: 'Confirmed', count: 7, pct: '76%' },
  { label: 'Completed', count: 9, pct: '92%' },
];

export const STATUS_FILTERS = [
  'All',
  'Draft',
  'Under review',
  'Planning',
  'Confirmed',
];

export const VENUES: Venue[] = [
  {
    name: 'Atrium Hall',
    capacity: 320,
    meta: 'Capacity 320 · Theatre / standing · Level 1',
    tags: ['Step-free', 'Hearing loop', 'Stage', 'Catering kitchen'],
    fit: 'Suitable — capacity and accessibility match E-201',
    suitability: 1,
  },
  {
    name: 'The Kelp Room',
    capacity: 120,
    meta: 'Capacity 120 · Banquet / cabaret · Level 2',
    tags: ['Step-free', 'Dimmable', 'Catering kitchen'],
    fit: 'Too small — 180 expected exceeds capacity 120',
    suitability: 0,
  },
  {
    name: 'Deepwater Auditorium',
    capacity: 500,
    meta: 'Capacity 500 · Tiered theatre · Basement',
    tags: ['Step-free', 'Hearing loop', 'Recording rig'],
    fit: 'Suitable — no hold on 12 Oct',
    suitability: 1,
  },
  {
    name: 'Harbour Terrace',
    capacity: 200,
    meta: 'Capacity 200 · Outdoor standing · Roof',
    tags: ['Covered area', 'Bar'],
    fit: 'Check — outdoor, no hearing loop',
    suitability: 2,
  },
];

export const VENUE_FILTERS = [
  { label: 'Date', value: '12 Oct 2026' },
  { label: 'Time', value: '10:00 – 17:00' },
  { label: 'Min capacity', value: '180' },
  { label: 'Accessibility', value: 'Step-free + loop' },
  { label: 'Layout', value: 'Theatre' },
];

export const EQUIPMENT: EquipmentRequest[] = [
  {
    item: 'PA system — large hall',
    event: 'E-201 Investor Forum',
    qty: '1',
    window: '12 Oct 10:00–17:00',
    avail: '2 of 3 free in this window',
    status: 1,
  },
  {
    item: '4K projector + screen',
    event: 'E-201 Investor Forum',
    qty: '2',
    window: '12 Oct 10:00–17:00',
    avail: 'Only 1 free — overlaps E-190',
    status: 0,
  },
  {
    item: 'Hearing loop kit',
    event: 'E-201 Investor Forum',
    qty: '1',
    window: '12 Oct 10:00–17:00',
    avail: '4 of 5 free',
    status: 1,
  },
  {
    item: 'Staging risers (set of 6)',
    event: 'E-190 Open Day',
    qty: '1',
    window: '28 Sep 08:00–18:00',
    avail: 'Reserved',
    status: 2,
  },
  {
    item: 'Handheld mic set',
    event: 'E-186 Board Offsite',
    qty: '4',
    window: '15 Oct 09:00–16:00',
    avail: '8 of 12 free',
    status: 1,
  },
];

export const EQUIPMENT_STOCK: Stat[] = [
  { value: '31', label: 'Items in stock' },
  { value: '12', label: 'Reserved' },
  { value: '1', label: 'Shortfall' },
  { value: '5', label: 'Open requests' },
];

export const NOTIFICATIONS: Notification[] = [
  {
    title: 'Clarification requested on E-201',
    body: 'A. Vance asked about catering headcount and stage size.',
    when: '12 minutes ago',
    dot: color.accent,
  },
  {
    title: 'Coordinator assigned',
    body: 'A. Vance is now coordinating E-201 Northbridge Investor Forum.',
    when: '1 hour ago',
    dot: color.teal,
  },
  {
    title: 'Booking decision — Atrium Hall',
    body: 'Venue staff flagged an overlap with E-190 and proposed 14:00–21:00.',
    when: '3 hours ago',
    dot: color.accent,
  },
  {
    title: 'E-198 confirmed',
    body: 'Venue and equipment settled. Attendees can now register.',
    when: 'Yesterday',
    dot: color.teal,
  },
  {
    title: 'E-181 rejected',
    body: 'No venue with capacity 400 was available on 9 Sep.',
    when: '2 days ago',
    dot: color.slate,
  },
];

export const ACTIVITY = [
  {
    when: 'Today 09:42',
    who: 'A. Vance (Coordinator)',
    text: 'Requested clarification: confirm catering headcount and whether the stage needs a lectern.',
    dot: color.accent,
  },
  {
    when: 'Yesterday 16:10',
    who: 'System',
    text: 'Suitability check: Kelp Room capacity 120 below expected attendance 180.',
    dot: color.accent,
  },
  {
    when: 'Yesterday 15:58',
    who: 'System',
    text: 'A. Vance assigned as coordinator.',
    dot: color.teal,
  },
  {
    when: '3 Sep 11:20',
    who: 'M. Reyes (Organiser)',
    text: 'Submitted event request.',
    dot: color.teal,
  },
];

export const STATUS_TRAIL = [
  'Draft',
  'Submitted',
  'Under review',
  'Approved',
  'Planning',
  'Confirmed',
];

export const ARRANGEMENTS = [
  { label: 'Venue', state: 'Requested', fg: color.mist },
  { label: 'Equipment', state: '1 conflict', fg: color.mist },
  { label: 'Registration', state: 'Not open', fg: color.silver },
  { label: 'Catering', state: 'Not required', fg: color.slate },
];

export const FORM_FIELDS = [
  {
    label: 'Event name',
    value: 'Northbridge Investor Forum',
    hint: 'Shown to attendees once confirmed',
  },
  { label: 'Purpose', value: 'Institutional partner briefing', hint: '' },
  { label: 'Date', value: '12 October 2026', hint: '' },
  { label: 'Start / end time', value: '10:00 – 17:00', hint: '' },
  {
    label: 'Expected attendance',
    value: '180',
    hint: 'Drives venue suitability checks',
  },
  { label: 'Registration needed', value: 'Yes — closes 8 Oct', hint: '' },
];

export const REQUIREMENT_CHIPS = [
  'Step-free access',
  'Hearing loop',
  'Stage + lectern',
  'Catering',
  'Livestream',
  'Breakout room',
  'Parking',
  'Signage',
];

export const NEXT_STEPS = [
  { n: '01', text: 'A coordinator is assigned within one working day.' },
  {
    n: '02',
    text: "They may ask for clarification — you'll get a notification.",
  },
  {
    n: '03',
    text: 'Once approved, they book a suitable venue and any equipment.',
  },
  {
    n: '04',
    text: "You're notified when the event is confirmed; registration then opens.",
  },
];

export const BOOKING_FACTS = [
  { label: 'Event', value: 'E-201 Northbridge Investor Forum' },
  { label: 'Requested by', value: 'A. Vance (Coordinator)' },
  { label: 'Date', value: '12 Oct 2026' },
  { label: 'Window', value: '10:00 – 17:00' },
  { label: 'Attendance', value: '180 of 320' },
  { label: 'Layout', value: 'Theatre + reception' },
];

export const BOOKING_QUEUE = [
  {
    venue: 'Atrium Hall',
    state: 'Conflict',
    detail: 'E-201 · 12 Oct 10:00–17:00 · overlaps E-190',
    bg: 'rgba(203,255,252,0.16)',
    fg: color.mist,
  },
  {
    venue: 'Deepwater Auditorium',
    state: 'Pending',
    detail: 'E-205 · 20 Nov 09:00–15:00',
    bg: 'rgba(255,255,255,0.09)',
    fg: color.mist,
  },
  {
    venue: 'Harbour Terrace',
    state: 'Pending',
    detail: 'E-198 · 3 Nov 18:00–23:00',
    bg: 'rgba(255,255,255,0.09)',
    fg: color.mist,
  },
  {
    venue: 'Meridian Studio',
    state: 'Approved',
    detail: 'E-186 · 15 Oct 09:00–16:00',
    bg: color.teal,
    fg: color.abyss,
  },
];

export const ATTENDEE_FACTS = [
  { label: 'Date', value: '12 Oct 2026' },
  { label: 'Time', value: '10:00 – 17:00' },
  { label: 'Venue', value: 'Atrium Hall, Level 1' },
  { label: 'Places left', value: '42 of 180' },
];

export const CHANGE_CHIPS = [
  'Date or time',
  'Expected attendance',
  'Venue requirements',
  'Equipment needs',
];

export const IMPACTS = [
  {
    text: "140 guests exceeds The Kelp Room's capacity of 120 — the venue booking must be re-checked.",
    dot: color.accent,
  },
  {
    text: 'Atrium Hall (320) and Harbour Terrace (200) are free on 3 Nov.',
    dot: color.teal,
  },
  {
    text: 'Equipment reservation unchanged; PA and mics cover 140.',
    dot: color.teal,
  },
];

export const FOOTER_LINKS = [
  'Event requests',
  'Venues',
  'Equipment',
  'Registrations',
  'Privacy policy',
];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
