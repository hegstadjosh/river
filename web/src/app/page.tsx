import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="min-h-screen" style={{ background: '#17161a' }}>
      {/* ── Nav ────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-4 sm:py-5" style={{ background: 'rgba(23, 22, 26, 0.85)', backdropFilter: 'blur(12px)' }}>
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
      <section className="relative flex flex-col items-center justify-center min-h-screen px-4 sm:px-6 text-center pt-20">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/3 w-[min(800px,200vw)] h-[400px] rounded-full" style={{ background: 'radial-gradient(ellipse, rgba(200, 165, 110, 0.04) 0%, transparent 70%)' }} />
        </div>

        <p className="text-sm tracking-widest uppercase mb-6 relative" style={{ color: 'rgba(200, 165, 110, 0.5)', letterSpacing: '0.2em' }}>
          Vibe scheduling
        </p>

        <h1
          className="text-3xl sm:text-5xl md:text-7xl leading-tight mb-6 relative"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Time is a river,<br />not a grid.
        </h1>

        <p className="max-w-lg text-base leading-relaxed mb-10 relative" style={{ color: 'rgba(220, 200, 170, 0.7)' }}>
          Let Claude vibecode your schedule.
          Tasks are multidimensional blobs in the current.
          Committed ones are vivid. Maybes are wisps.
        </p>

        <div className="flex gap-4 relative">
          <Link
            href="/login"
            className="px-6 py-3 rounded-lg text-sm font-medium transition-all"
            style={{ background: 'rgba(200, 165, 110, 0.15)', color: 'rgb(200, 165, 110)', border: '1px solid rgba(200, 165, 110, 0.25)' }}
          >
            Start flowing
          </Link>
        </div>

        <div className="mt-10 sm:mt-16 max-w-4xl w-full relative">
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(200, 165, 110, 0.1)', boxShadow: '0 0 80px rgba(200, 165, 110, 0.03)' }}>
            <video
              src="/viewer/screenshots/river-video-demo.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* ── The Problem ────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-32">
        <h2
          className="text-2xl sm:text-3xl md:text-4xl mb-8"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Calendars lie to you.
        </h2>
        <div className="space-y-6 text-base leading-relaxed" style={{ color: 'rgba(220, 200, 170, 0.6)' }}>
          <p>
            Every hour looks the same on a grid. A 2pm meeting and a 2pm creative session
            get the same box. Commitment is binary — on the calendar or it doesn&apos;t exist.
          </p>
          <p>
            Todo lists strip time out entirely. Just a growing stack.
            Gantt charts add it back but make your day feel like a construction project.
          </p>
          <p style={{ color: 'rgba(200, 165, 110, 0.8)' }}>
            River is scheduling by feel. Fluid, spatial, honest about uncertainty.
          </p>
        </div>
      </section>

      {/* ── Three Dimensions ───────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <h2
          className="text-2xl sm:text-3xl md:text-4xl mb-8 sm:mb-12"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Three dimensions of a task.
        </h2>

        <div className="grid gap-8 sm:grid-cols-3">
          {[
            {
              name: 'Duration',
              description: 'A 10-minute call is a pebble. A 2-hour deep work block is a boulder.',
              visual: '⬤',
              detail: 'mass: minutes',
            },
            {
              name: 'Commitment',
              description: 'A wisp at 0.1 — barely a thought. Crystalline at 0.9 — locked in. Never binary.',
              visual: '◯',
              detail: 'solidity: 0–1',
            },
            {
              name: 'Energy',
              description: 'Cool blue for autopilot. Warm amber for focus. Hot red for deep work.',
              visual: '◉',
              detail: 'energy: 0–1',
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
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <h2
          className="text-2xl sm:text-3xl md:text-4xl mb-8"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          The cloud and the river.
        </h2>
        <div className="space-y-6 text-base leading-relaxed" style={{ color: 'rgba(220, 200, 170, 0.6)' }}>
          <p>
            <span style={{ color: 'rgba(200, 165, 110, 0.8)' }}>Above: the cloud.</span>{' '}
            Unscheduled thoughts float as wisps. No pressure, no date. Just possibilities.
          </p>
          <p>
            <span style={{ color: 'rgba(200, 165, 110, 0.8)' }}>Below: the river.</span>{' '}
            Scheduled things drift left to right through time.
            The present is a thin line of amber light.
          </p>
          <p>
            Nothing turns red. Nothing becomes &ldquo;overdue.&rdquo;
            Tasks that drift past now float back to the cloud. Today wasn&apos;t the day — that&apos;s fine.
          </p>
        </div>
      </section>

      {/* ── Claude Integration ─────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <h2
          className="text-2xl sm:text-3xl md:text-4xl mb-8"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Your AI sees your day.
        </h2>
        <div className="space-y-6 text-base leading-relaxed" style={{ color: 'rgba(220, 200, 170, 0.6)' }}>
          <p>
            River is an{' '}
            <a href="https://modelcontextprotocol.io" className="underline" style={{ color: 'rgba(200, 165, 110, 0.7)' }}>MCP server</a>.
            Claude sees your schedule, proposes rearrangements, fills your day —
            all through natural conversation.
          </p>
        </div>

        <div className="mt-8 rounded-lg overflow-hidden" style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(200, 165, 110, 0.08)' }}>
          <div className="px-4 py-2 text-xs" style={{ background: 'rgba(200, 165, 110, 0.04)', color: 'rgba(200, 165, 110, 0.3)', borderBottom: '1px solid rgba(200, 165, 110, 0.06)' }}>
            Claude Code
          </div>
          <pre className="p-4 text-sm leading-relaxed overflow-x-auto" style={{ color: 'rgba(220, 200, 170, 0.5)' }}>
            <code>{`> give me a chill afternoon — I'm tired

Looking at your river... you have "deep work: auth flow" at 2pm
and "review API docs" at 4pm.

Moving deep work to tomorrow morning. Sliding "evening walk" to 3pm.

Your afternoon now: lunch → walk → read → open space.`}</code>
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
      <section className="flex flex-col items-center justify-center py-20 sm:py-32 px-4 sm:px-6 text-center">
        <h2
          className="text-3xl sm:text-4xl md:text-5xl mb-6"
          style={{ color: 'rgb(200, 165, 110)', fontFamily: 'var(--font-display)' }}
        >
          Start flowing.
        </h2>
        <p className="max-w-md text-sm mb-8" style={{ color: 'rgba(200, 165, 110, 0.4)' }}>
          Tasks are shapes, not checkboxes.
          Commitment is a gradient, not a promise you&apos;ll break.
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
      <footer className="py-8 px-4 sm:px-6 text-center text-xs" style={{ color: 'rgba(200, 165, 110, 0.2)' }}>
        River is open source.
      </footer>
    </main>
  )
}
