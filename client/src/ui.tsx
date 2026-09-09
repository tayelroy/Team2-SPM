/**
 * Shared presentational primitives for the mockup screens.
 *
 * Styles are inline objects rather than CSS classes: the design is a fixed
 * dark theme with no variants to cascade, and keeping each component's styling
 * next to its markup makes the mapping back to the source mockup obvious.
 * Anything that inline styles cannot express — focus rings, placeholders,
 * keyframes — lives in index.css.
 */

import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { color, gradient, label as labelToken, radius, rule, surface } from './theme';

interface WithChildren {
  children: ReactNode;
}

/** Uppercase tracked eyebrow — the system's categorical label. */
export function Eyebrow({ children, style }: WithChildren & { style?: CSSProperties }) {
  return <span style={{ ...labelToken, ...style }}>{children}</span>;
}

/** Raised kelp surface. The default content container. */
export function Card({
  children,
  padding = '36px',
  style,
}: WithChildren & { padding?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: color.kelp,
        borderRadius: radius.card,
        padding,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Sunken panel — one step deeper than the canvas. */
export function RecessedCard({
  children,
  padding = '36px',
  style,
}: WithChildren & { padding?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: color.deep,
        borderRadius: radius.card,
        padding,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Status pill. Colours come from `badgeStyle` in the view model. */
export function Badge({
  children,
  bg,
  fg,
  size = 11,
}: WithChildren & { bg: string; fg: string; size?: number }) {
  return (
    <span
      style={{
        fontSize: `${size}px`,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '5px 9px',
        borderRadius: radius.sm,
        background: bg,
        color: fg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** The signature aurora-gradient CTA. One per view, at most. */
export function GradientButton({
  children,
  onClick,
  style,
}: WithChildren & { onClick?: () => void; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 'none',
        borderRadius: radius.sm,
        padding: '15px 22px',
        background: gradient.aurora,
        color: '#222222',
        fontSize: '14px',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Outlined secondary action. */
export function GhostButton({
  children,
  onClick,
  style,
}: WithChildren & { onClick?: () => void; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: color.deep,
        border: rule.raised,
        borderRadius: radius.sm,
        padding: '15px 22px',
        color: color.platinum,
        fontSize: '14px',
        letterSpacing: '0.06em',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** 32x32 square trigger, normally the ↗ "go to" affordance. */
export function IconButton({
  children,
  onClick,
  label: ariaLabel,
  style,
}: WithChildren & { onClick?: () => void; label: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        background: surface.iconButton,
        border: 'none',
        borderRadius: radius.sm,
        width: '32px',
        height: '32px',
        color: color.platinum,
        fontSize: '14px',
        cursor: 'pointer',
        flex: 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Toggleable chip used for requirements and change categories. */
export function Chip({
  children,
  bg,
  bd,
  fg,
  onClick,
  pressed,
}: WithChildren & {
  bg: string;
  bd: string;
  fg: string;
  onClick?: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      style={{
        background: bg,
        border: `1px solid ${bd}`,
        borderRadius: radius.sm,
        padding: '9px 13px',
        color: fg,
        fontSize: '13px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Labelled text input. The hint is tied to the input with `aria-describedby`
 * rather than nested inside the label, so it is announced as description and
 * does not become part of the field's accessible name.
 */
export function Field({
  label,
  defaultValue,
  hint,
  type,
  placeholder,
  onAbyss,
  muted,
}: {
  label: string;
  defaultValue?: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  /** Use the darker inset fill for fields sitting directly on the canvas. */
  onAbyss?: boolean;
  /** Read-only "for reference" styling. */
  muted?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label htmlFor={id} style={labelToken}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        readOnly={muted}
        aria-describedby={hint ? hintId : undefined}
        style={{
          background: muted
            ? 'rgba(1,29,28,0.4)'
            : onAbyss
              ? 'rgba(1,38,36,0.9)'
              : surface.field,
          border: muted ? '1px solid rgba(255,255,255,0.06)' : rule.control,
          borderRadius: radius.sm,
          padding: '13px 14px',
          color: muted ? color.slate : color.mist,
          fontSize: '14px',
          outline: 'none',
        }}
      />
      {hint ? (
        <span
          id={hintId}
          style={{ fontSize: '12px', lineHeight: 1.4, color: color.slate }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** Labelled multi-line input. */
export function TextField({
  label,
  defaultValue,
  placeholder,
  rows = 3,
}: {
  label: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label htmlFor={id} style={labelToken}>
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        defaultValue={defaultValue}
        placeholder={placeholder}
        style={{
          background: surface.field,
          border: rule.control,
          borderRadius: radius.sm,
          padding: '13px 14px',
          color: color.mist,
          fontSize: '14px',
          lineHeight: 1.43,
          outline: 'none',
          resize: 'vertical',
        }}
      />
    </div>
  );
}

/** A label/value pair — the building block of every facts grid. */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Eyebrow>{label}</Eyebrow>
      <span style={{ fontSize: '16px', lineHeight: 1.4, color: color.mist }}>
        {value}
      </span>
    </div>
  );
}

/** Large phosphor-pink figure over a tracked caption. */
export function StatFigure({
  value,
  label,
  size = 56,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  return (
    <>
      <span
        style={{
          fontSize: `${size}px`,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: '-0.03em',
          color: color.phosphor,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: '13px',
          letterSpacing: '0.055em',
          textTransform: 'uppercase',
          color: color.mist,
        }}
      >
        {label}
      </span>
    </>
  );
}

/** Aqua-bordered callout for conflicts, capacity checks and impact notes. */
export function Notice({
  children,
  style,
}: WithChildren & { style?: CSSProperties }) {
  return (
    <div
      style={{
        border: surface.noticeEdge,
        background: surface.notice,
        borderRadius: radius.card,
        padding: '28px 30px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The square "!" glyph that opens a notice. */
export function NoticeMark({ size = 24 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: radius.sm,
        background: color.accent,
        color: color.abyss,
        fontSize: `${size - 10}px`,
        textAlign: 'center',
        lineHeight: `${size}px`,
        flex: 'none',
      }}
    >
      !
    </div>
  );
}

/** Small status dot used in timelines, action lists and legends. */
export function Dot({ tone, style }: { tone: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: tone,
        flex: 'none',
        ...style,
      }}
    />
  );
}

/** Bioluminescent progress track for the pipeline breakdown. */
export function ProgressBar({ pct }: { pct: string }) {
  return (
    <div
      style={{
        height: '6px',
        borderRadius: radius.sm,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}
    >
      <div style={{ height: '100%', width: pct, background: gradient.biolum }} />
    </div>
  );
}

/** The circular brand mark. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: gradient.biolum,
        flex: 'none',
      }}
    />
  );
}

/** Diagonal-hatch placeholder standing in for photography. */
export function ImagePlaceholder({
  height,
  caption,
}: {
  height: string;
  caption: string;
}) {
  return (
    <div
      style={{
        height,
        borderRadius: radius.sm,
        background:
          'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 8px, rgba(255,255,255,0.02) 8px 16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: '11px',
          letterSpacing: '0.08em',
          color: color.slate,
        }}
      >
        {caption}
      </span>
    </div>
  );
}
