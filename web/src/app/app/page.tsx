'use client'

import { authClient } from '@/lib/auth/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'

export default function AppPage() {
  const [ready, setReady] = useState(false)
  const router = useRouter()

  useEffect(() => {
    async function init() {
      // Preload state from the API so tasks appear on the viewer's first frame.
      // Middleware guarantees a session; a 401 here means it expired mid-flight.
      try {
        const res = await fetch('/api/state')
        if (res.status === 401) { router.push('/login'); return }
        if (res.ok) {
          window._riverPreloadedState = await res.json()
        }
      } catch { /* viewer's own fetchState will retry */ }

      // Check API keys for MCP badge
      fetch('/api/keys')
        .then(r => (r.ok ? r.json() : []))
        .then((keys: { revoked_at: string | null }[]) => {
          window._riverHasApiKeys = keys.some(k => !k.revoked_at)
        })
        .catch(() => { window._riverHasApiKeys = false })

      setReady(true)
    }

    init()
  }, [router])

  function handleSignOut() {
    authClient.signOut().then(() => router.push('/'))
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#17161a' }}>
        <p style={{ color: 'rgba(200, 165, 110, 0.4)' }}>loading...</p>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen" style={{ background: '#1a1614', overflow: 'hidden', touchAction: 'none', position: 'fixed', width: '100%', height: '100%' }}>
      {/* Viewer CSS */}
      <link rel="stylesheet" href="/viewer/style.css" />

      {/* Canvas */}
      <canvas id="river-canvas" />

      {/* Horizon bar */}
      <div id="horizon-bar" className="river-bar">
        <div className="hz-scales">
          <button className="hz-btn" data-hours="6">6h</button>
          <button className="hz-btn active" data-hours="24">day</button>
          <button className="hz-btn" data-hours="96">4d</button>
          <button className="hz-btn" data-hours="168">week</button>
          <button className="hz-btn" data-hours="720">month</button>
          <button className="hz-btn" data-hours="2160">qtr</button>
          <button className="hz-btn" data-hours="8760">year</button>
        </div>
        <div className="hz-nav">
          <button className="hz-arrow" id="hz-prev" title="Previous">&#8249;</button>
          <span className="hz-label" id="hz-label">today</span>
          <button className="hz-arrow" id="hz-next" title="Next">&#8250;</button>
        </div>
      </div>

      <div id="wizard-field" className="river-bar wizard-field hidden">
        <div className="wizard-field-zones" />
      </div>

      {/* Settings menu */}
      <button id="menu-btn" className="menu-btn" title="Settings" suppressHydrationWarning>
        <span className="menu-icon">&#9881;</span>
        <span id="menu-dot" className="menu-dot" />
      </button>
      <div id="menu-sidebar" className="menu-sidebar hidden">
        <a id="menu-mcp" className="menu-item" href="/mcp">
          <span className="menu-item-icon">&#9881;</span>
          MCP Setup
          <span id="menu-mcp-badge" className="menu-badge">set up</span>
        </a>
        <button id="menu-signout" className="menu-item" onClick={handleSignOut}>
          <span className="menu-item-icon">&#8594;</span>
          Sign out
        </button>
      </div>

      <div id="tag-bar" className="tag-bar" />
      <button id="plan-btn" className="plan-btn">plan</button>

      <div id="quick-add-wrap" className="quick-add-wrap hidden">
        <input type="text" id="quick-add" className="quick-add" placeholder="new thought..." spellCheck={false} />
        <div id="quick-add-tags" className="quick-add-tags" />
      </div>

      {/* Detail panel */}
      <div id="panel" className="panel hidden">
        <label className="panel-label">
          Name
          <input type="text" id="panel-name" className="panel-input" spellCheck={false} />
        </label>
        <div className="panel-label">
          <div className="dur-header">
            <span className="dur-title">Duration</span>
            <input type="text" id="panel-dur-input" className="dur-input" spellCheck={false} placeholder="30m" />
          </div>
          <div className="panel-durations" id="panel-durations" />
        </div>
        <div className="panel-times" id="panel-times" style={{ display: 'none' }}>
          <div className="time-group">
            <input type="text" id="panel-start" className="time-pick" spellCheck={false} placeholder="3pm" />
            <input type="datetime-local" id="panel-start-picker" className="time-picker-hidden" />
            <button className="time-icon" id="panel-start-icon" title="Pick time">&#128197;</button>
          </div>
          <span className="time-arrow">&#8594;</span>
          <div className="time-group">
            <input type="text" id="panel-end" className="time-pick" spellCheck={false} placeholder="5pm" />
            <input type="datetime-local" id="panel-end-picker" className="time-picker-hidden" />
            <button className="time-icon" id="panel-end-icon" title="Pick time">&#128197;</button>
          </div>
        </div>
        <label className="panel-label">
          Commitment
          <input type="range" id="panel-solidity" min="0" max="100" defaultValue="10" className="panel-slider" />
        </label>
        <label className="panel-label">
          Energy
          <input type="range" id="panel-energy" min="0" max="100" defaultValue="50" className="panel-slider" />
        </label>
        <label className="panel-label panel-row">
          <input type="checkbox" id="panel-backtocloud" defaultChecked />
          Back to cloud
        </label>
        <div className="panel-label">
          Tags
          <div id="panel-tags" className="panel-tag-checks" />
        </div>
        <div className="panel-actions">
          <button id="panel-copy" className="panel-action">Copy</button>
          <button id="panel-dissolve" className="panel-action panel-action-dissolve">Dissolve</button>
        </div>
      </div>

      {/* Viewer bundle — loaded AFTER DOM is ready */}
      <Script
        src="/viewer/river-bundle.js"
        strategy="afterInteractive"
        onLoad={() => {
          const R = window.River
          if (!R) return

          // Check mobile BEFORE first sync so plan mode is blocked
          if (R.checkMobile) R.checkMobile()
          if (R.isMobile && R.applyMobile) R.applyMobile()

          // Apply preloaded state immediately — tasks appear on first frame
          if (window._riverPreloadedState) {
            R.state = window._riverPreloadedState
            R.sync()
          }

          // Start the polling heartbeat
          if (R.connectSSE) R.connectSSE()

          // Set up MCP badge
          const hasKeys = window._riverHasApiKeys
          const dot = document.getElementById('menu-dot')
          const badge = document.getElementById('menu-mcp-badge')
          if (dot) dot.className = hasKeys ? 'menu-dot' : 'menu-dot active'
          if (badge) badge.className = hasKeys ? 'menu-badge hidden' : 'menu-badge'

          // Hamburger toggle
          const btn = document.getElementById('menu-btn')
          const sidebar = document.getElementById('menu-sidebar')
          if (btn && sidebar) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); sidebar.classList.toggle('hidden') })
            document.addEventListener('click', (e) => {
              if (!sidebar.contains(e.target as Node) && e.target !== btn) sidebar.classList.add('hidden')
            })
          }
        }}
      />
    </div>
  )
}

// Type declarations for window globals
declare global {
  interface Window {
    _riverPreloadedState: Record<string, unknown> | null
    _riverHasApiKeys: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    River: any
  }
}
