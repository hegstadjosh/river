import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="min-h-screen" style={{ background: '#17161a' }}>
      {/* ── Nav ────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5" style={{ background: 'rgba(23, 22, 26, 0.85)', backdropFilter: 'blur(12px)' }}>
        <span className="text-lg tracking-widest" style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}>
          River
        </span>
        <div className="flex items-center gap-6">
          <Link href="/mcp" className="text-xs transition-opacity hover:opacity-100" style={{ color: 'rgba(200, 165, 110, 0.4)' }}>
            MCP Setup
          </Link>
          <Link
            href="/login"
            className="text-xs px-4 py-2 rounded-md transition-all"
            style={{ color: 'rgb(200, 165, 110)', border: '1px solid rgba(200, 165, 110, 0.2)', background: 'rgba(200, 165, 110, 0.06)' }}
          >
            sign in
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center min-h-screen px-6 text-center pt-20">
        {/* Ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/3 w-[800px] h-[400px] rounded-full" style={{ background: 'radial-gradient(ellipse, rgba(200, 165, 110, 0.04) 0%, transparent 70%)' }} />
        </div>

        <h1
          className="text-5xl sm:text-7xl leading-tight mb-6 relative"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Time is a river,<br />not a grid.
        </h1>

        <p className="max-w-lg text-base leading-relaxed mb-10 relative" style={{ color: 'rgba(220, 200, 170, 0.7)' }}>
          A spatial task scheduler where tasks are shapes that drift in a current.
          Big ones take up space. Committed ones are vivid. Maybes are wisps.
          Nothing is overdue. Nothing judges you.
        </p>

        <div className="flex gap-4 relative">
          <Link
            href="/login"
            className="px-6 py-3 rounded-lg text-sm font-medium transition-all"
            style={{ background: 'rgba(200, 165, 110, 0.15)', color: 'rgb(200, 165, 110)', border: '1px solid rgba(200, 165, 110, 0.25)' }}
          >
            Start flowing
          </Link>
          <a
            href="https://github.com/josh-hegstad/river"
            className="px-6 py-3 rounded-lg text-sm transition-all"
            style={{ color: 'rgba(200, 165, 110, 0.5)', border: '1px solid rgba(200, 165, 110, 0.1)' }}
          >
            View source
          </a>
        </div>

        {/* Screenshot */}
        <div className="mt-16 max-w-4xl w-full relative">
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(200, 165, 110, 0.1)', boxShadow: '0 0 80px rgba(200, 165, 110, 0.03)' }}>
            <img src="/viewer/screenshots/river-day-view.png" alt="River — tasks flowing in a river of time" className="w-full" />
          </div>
        </div>
      </section>

      {/* ── The Problem ────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 py-32">
        <h2
          className="text-3xl sm:text-4xl mb-8"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Calendars lie to you.
        </h2>
        <div className="space-y-6 text-base leading-relaxed" style={{ color: 'rgba(220, 200, 170, 0.6)' }}>
          <p>
            Grid-based scheduling pretends every hour is the same size. That a 2pm meeting
            and a 2pm creative session require the same kind of attention. That commitment
            is binary — either it&apos;s on the calendar or it doesn&apos;t exist.
          </p>
          <p>
            Todo lists go the other direction — no time dimension at all. Just an ever-growing
            stack of guilt. Or you reach for Gantt charts, which are honest about time but
            treat your day like a construction project.
          </p>
          <p style={{ color: 'rgba(200, 165, 110, 0.8)' }}>
            River lives in the space between. Fluid. Organic. Honest about uncertainty.
          </p>
        </div>
      </section>

      {/* ── Three Dimensions ───────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 py-24">
        <h2
          className="text-3xl sm:text-4xl mb-12"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Three dimensions of a task.
        </h2>

        <div className="grid gap-8 sm:grid-cols-3">
          {[
            {
              name: 'Duration',
              field: 'size',
              description: 'How long something takes. A 10-minute call is a pebble. A 2-hour deep work block is a boulder.',
              visual: '⬤',
              detail: 'mass: 10–240 minutes',
            },
            {
              name: 'Commitment',
              field: 'shape',
              description: 'How certain you are. A wisp at 0.1 — barely a thought. Crystalline at 0.9 — locked in.',
              visual: '◯',
              detail: 'solidity: 0–1 gradient',
            },
            {
              name: 'Energy',
              field: 'color',
              description: 'The cognitive temperature. Cool blue for autopilot. Warm amber for focus. Hot for deep work.',
              visual: '◉',
              detail: 'energy: 0–1 temperature',
            },
          ].map((dim) => (
            <div key={dim.name} className="p-6 rounded-lg" style={{ background: 'rgba(200, 165, 110, 0.03)', border: '1px solid rgba(200, 165, 110, 0.08)' }}>
              <div className="text-2xl mb-3" style={{ color: 'rgba(200, 165, 110, 0.3)' }}>{dim.visual}</div>
              <h3 className="text-sm font-medium mb-2" style={{ color: 'rgb(200, 165, 110)' }}>{dim.name}</h3>
              <p className="text-sm leading-relaxed mb-3" style={{ color: 'rgba(220, 200, 170, 0.5)' }}>
                {dim.description}
              </p>
              <p className="text-xs" style={{ color: 'rgba(200, 165, 110, 0.25)' }}>{dim.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cloud and River ────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 py-24">
        <h2
          className="text-3xl sm:text-4xl mb-8"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          The cloud and the river.
        </h2>
        <div className="space-y-6 text-base leading-relaxed" style={{ color: 'rgba(220, 200, 170, 0.6)' }}>
          <p>
            <span style={{ color: 'rgba(200, 165, 110, 0.8)' }}>Above the surface: the cloud.</span>{' '}
            Unscheduled thoughts float here as wisps. &ldquo;Maybe I should call the dentist.&rdquo;
            &ldquo;Write that blog post someday.&rdquo; No pressure, no date, no guilt.
          </p>
          <p>
            <span style={{ color: 'rgba(200, 165, 110, 0.8)' }}>Below: the river.</span>{' '}
            Things with weight and position in time. They drift with the current, left to right.
            The present is a thin line of amber light.
          </p>
          <p>
            Tasks that drift past the now-line don&apos;t turn red. They don&apos;t become &ldquo;overdue.&rdquo;
            They silently float back up to the cloud. Because sometimes today wasn&apos;t the day,
            and that&apos;s fine.
          </p>
        </div>
      </section>

      {/* ── Claude Integration ─────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 py-24">
        <h2
          className="text-3xl sm:text-4xl mb-8"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Your AI sees your day.
        </h2>
        <div className="space-y-6 text-base leading-relaxed" style={{ color: 'rgba(220, 200, 170, 0.6)' }}>
          <p>
            River is an{' '}
            <a href="https://modelcontextprotocol.io" className="underline" style={{ color: 'rgba(200, 165, 110, 0.7)' }}>MCP server</a>.
            Claude Code can read your schedule, propose rearrangements, and fill your day —
            all through natural conversation.
          </p>
          <p>
            &ldquo;Push everything after 3pm back an hour.&rdquo; Done.
            &ldquo;Show me three ways to fit a workout in.&rdquo; Plan mode activates,
            swim lanes appear, alternatives materialize. Pick the one that feels right.
          </p>
        </div>

        {/* Terminal snippet */}
        <div className="mt-8 rounded-lg overflow-hidden" style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(200, 165, 110, 0.08)' }}>
          <div className="px-4 py-2 text-xs" style={{ background: 'rgba(200, 165, 110, 0.04)', color: 'rgba(200, 165, 110, 0.3)', borderBottom: '1px solid rgba(200, 165, 110, 0.06)' }}>
            Claude Code
          </div>
          <pre className="p-4 text-sm leading-relaxed overflow-x-auto" style={{ color: 'rgba(220, 200, 170, 0.5)' }}>
            <code>{`> give me a chill afternoon — I'm tired

Looking at your river... you have "deep work: auth flow" at 2pm (high energy)
and "review API docs" at 4pm.

I'll rearrange: moving the deep work to tomorrow morning when you're fresh,
sliding "evening walk" up to 3pm, and leaving a gap after lunch.

Your afternoon now: lunch → walk → read chapter 5 → open space.`}</code>
          </pre>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/mcp"
            className="text-sm transition-opacity hover:opacity-100"
            style={{ color: 'rgba(200, 165, 110, 0.5)' }}
          >
            Set up MCP connection &rarr;
          </Link>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center py-32 px-6 text-center">
        <h2
          className="text-4xl sm:text-5xl mb-6"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Start flowing.
        </h2>
        <p className="max-w-md text-sm mb-8" style={{ color: 'rgba(200, 165, 110, 0.4)' }}>
          Tasks are shapes, not checkboxes. Commitment is a gradient, not a promise.
          Nothing judges you. Things simply drift.
        </p>
        <Link
          href="/login"
          className="px-8 py-3 rounded-lg text-sm font-medium transition-all"
          style={{ background: 'rgba(200, 165, 110, 0.15)', color: 'rgb(200, 165, 110)', border: '1px solid rgba(200, 165, 110, 0.25)' }}
        >
          Create your river
        </Link>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="py-8 px-6 text-center text-xs" style={{ color: 'rgba(200, 165, 110, 0.2)' }}>
        River is open source.
      </footer>
    </main>
  )
}
