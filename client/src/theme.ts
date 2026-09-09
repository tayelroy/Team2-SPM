/**
 * Auros design tokens — the "abyssal terminal" palette behind the ConnectSphere
 * mockups. Depth comes from the teal surface stack (deep -> abyss -> kelp),
 * never from shadows, so there is deliberately no elevation scale here.
 */

export const color = {
  /** Page canvas. */
  abyss: '#012624',
  /** Recessed surface — sits below the canvas. */
  deep: '#011d1c',
  /** Raised card surface. */
  kelp: '#003734',
  /** Cool off-white for emphasised body copy. */
  mist: '#edfffe',
  /** Headings, nav, icon strokes. */
  platinum: '#ffffff',
  /** Secondary body text. */
  silver: '#bbc7c6',
  /** Tertiary / low-emphasis text. */
  slate: '#707777',
  /** Large statistics only — never body text. */
  phosphor: '#fde9ff',
  /** Pale aqua highlight. */
  accent: '#cbfffc',
  /** Saturated teal for confirmed states. */
  teal: '#00827c',
} as const;

export const gradient = {
  /** Primary CTA fill: cyan -> white -> pink. */
  aurora:
    'linear-gradient(90deg, rgb(203,255,252) 0%, rgb(237,255,254) 26.25%, rgb(255,253,250) 47.57%, rgb(250,209,255) 88.96%)',
  /** Brand mark and progress fills: teal -> pale aqua. */
  biolum: 'linear-gradient(90deg, rgb(0,130,124) 0%, rgb(203,255,252) 100%)',
} as const;

/** The complete shape vocabulary — 6px for controls, 16px for cards. */
export const radius = {
  sm: '6px',
  card: '16px',
} as const;

export const rule = {
  /** Hairline between rows and sections. */
  faint: '1px solid rgba(255,255,255,0.07)',
  /** Card and header borders. */
  edge: '1px solid rgba(255,255,255,0.08)',
  /** Input and secondary-button borders. */
  control: '1px solid rgba(255,255,255,0.1)',
  /** Slightly brighter border for raised secondary buttons. */
  raised: '1px solid rgba(255,255,255,0.14)',
} as const;

export const surface = {
  /** Inset field background on a kelp card. */
  field: 'rgba(1,29,28,0.7)',
  /** Inset field background on the abyss canvas. */
  fieldOnAbyss: 'rgba(1,38,36,0.8)',
  /** Nested row inside a kelp card. */
  sunken: 'rgba(1,29,28,0.55)',
  /** Table header strip. */
  tableHead: 'rgba(1,29,28,0.6)',
  /** Small square icon buttons. */
  iconButton: 'rgba(3,81,75,0.5)',
  /** Callout panel — capacity checks, overlaps, impact summaries. */
  notice: 'rgba(0,130,124,0.18)',
  /** Border for the callout panel above. */
  noticeEdge: '1px solid rgba(203,255,252,0.45)',
} as const;

export const layout = {
  maxWidth: '1440px',
  gutter: '28px',
  cardPadding: '36px',
} as const;

/**
 * Uppercase tracked label — the signature "instrumentation" treatment used for
 * every eyebrow, field label and column heading.
 */
export const label = {
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: color.silver,
} as const;
