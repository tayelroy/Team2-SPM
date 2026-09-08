export default function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
        alignItems: 'center',
        gap: '2rem',
        padding: '4vw 6vw',
      }}
    >
      <div>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            fontSize: '0.75rem',
            color: 'var(--color-accent)',
            marginBottom: '1.25rem',
          }}
        >
          Event Planning &amp; Venue Booking
        </p>
        <h1
          style={{
            fontSize: 'clamp(3.5rem, 9vw, 7.5rem)',
            lineHeight: 0.92,
            color: 'var(--color-ink)',
            marginLeft: '-0.05em',
          }}
        >
          ConnectSphere
        </h1>
        <p
          style={{
            marginTop: '1.75rem',
            maxWidth: '34ch',
            fontSize: '1.05rem',
            color: 'var(--color-ink-soft)',
          }}
        >
          Event requests, venues, and equipment — coordinated in one place instead of five
          spreadsheets and a shared inbox.
        </p>
        <a
          href="/register"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.6rem',
            marginTop: '2.5rem',
            padding: '0.9rem 1.6rem',
            backgroundColor: 'var(--color-ink)',
            color: 'var(--color-bg)',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.95rem',
            borderRadius: '999px',
            transition: 'transform 160ms ease, box-shadow 160ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 10px 24px -12px rgba(23, 19, 15, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          Register an account
          <span aria-hidden="true">&rarr;</span>
        </a>
      </div>

      <div
        style={{
          justifySelf: 'end',
          borderLeft: '1px solid var(--color-line)',
          paddingLeft: '2.5rem',
          maxWidth: '22ch',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '4rem',
            lineHeight: 1,
            color: 'var(--color-line)',
          }}
        >
          01
        </p>
        <p style={{ marginTop: '1rem', color: 'var(--color-ink-soft)', fontSize: '0.95rem' }}>
          Request, coordinate, and confirm — without five spreadsheets doing it separately.
        </p>
      </div>
    </main>
  );
}
