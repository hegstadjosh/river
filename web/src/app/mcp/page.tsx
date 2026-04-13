'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ApiKey {
  id: string
  name: string
  key?: string
  key_hint?: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export default function McpSetupPage() {
  const router = useRouter()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuthAndLoad()
  }, [])

  async function checkAuthAndLoad() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }
    await loadKeys()
  }

  async function loadKeys() {
    const res = await fetch('/api/keys')
    if (res.ok) {
      const data = await res.json()
      setKeys(data.filter((k: ApiKey) => !k.revoked_at))
    }
    setLoading(false)
  }

  async function createKey() {
    const res = await fetch('/api/keys', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      setNewKey(data.key)
      await loadKeys()
    }
  }

  async function revokeKey(keyId: string) {
    await fetch('/api/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId }),
    })
    setNewKey(null)
    await loadKeys()
  }

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://www.taskriver.dev'
  const sseUrl = `${baseUrl}/api/mcp/sse`
  const displayToken = newKey ?? 'river_YOUR_API_KEY'

  const amber = 'rgb(200, 165, 110)'
  const amberDim = 'rgba(200, 165, 110, 0.5)'
  const amberBg = 'rgba(200, 165, 110, 0.08)'
  const panelBg = 'rgba(200, 165, 110, 0.04)'
  const panelBorder = 'rgba(200, 165, 110, 0.12)'

  const configs = {
    claudeCode: JSON.stringify({
      mcpServers: {
        river: {
          type: 'sse',
          url: sseUrl,
          headers: { Authorization: `Bearer ${displayToken}` },
        },
      },
    }, null, 2),
    codex: JSON.stringify({
      mcpServers: {
        river: {
          type: 'sse',
          url: sseUrl,
          headers: { Authorization: `Bearer ${displayToken}` },
        },
      },
    }, null, 2),
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#17161a' }}>
        <p style={{ color: amberDim }}>loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#17161a', color: amber }}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <a href="/app" className="text-xs mb-8 block" style={{ color: amberDim }}>&larr; back to river</a>

        <h1 className="text-2xl font-light tracking-wide mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          Connect AI Agents
        </h1>
        <p className="text-sm mb-10" style={{ color: amberDim }}>
          River is an MCP server. Connect Claude Code, Codex, or any MCP client that supports SSE
          to see your schedule, propose plans, and rearrange your day with natural language.
        </p>

        {/* What agents can do */}
        <section className="rounded-lg p-5 mb-8" style={{ background: panelBg, border: `1px solid ${panelBorder}` }}>
          <h2 className="text-sm font-medium mb-3">What can an AI agent do?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { q: '"Push that meeting to after lunch"', a: 'Moves tasks in time naturally' },
              { q: '"Give me a chill afternoon"', a: 'Rearranges for low-energy tasks' },
              { q: '"Show me three ways to fit a workout in"', a: 'Plan mode: compare alternatives' },
              { q: '"What does my week look like?"', a: 'Reads the full river state' },
            ].map((item) => (
              <div key={item.q} className="text-xs p-3 rounded" style={{ background: 'rgba(200, 165, 110, 0.03)' }}>
                <p className="italic mb-1" style={{ color: amber }}>{item.q}</p>
                <p style={{ color: amberDim }}>{item.a}</p>
              </div>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: 'rgba(200, 165, 110, 0.3)' }}>
            6 tools: look, put, move, sweep, plan, branch
          </p>
        </section>

        {/* API Key */}
        <section className="rounded-lg p-5 mb-8" style={{ background: panelBg, border: `1px solid ${panelBorder}` }}>
          <h2 className="text-sm font-medium mb-3">API Key</h2>

          {newKey && (
            <div className="mb-4 p-3 rounded" style={{ background: 'rgba(200, 165, 110, 0.1)', border: `1px solid rgba(200, 165, 110, 0.2)` }}>
              <p className="text-xs mb-2" style={{ color: amberDim }}>
                Copy this key now — it won&apos;t be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs flex-1 break-all" style={{ color: amber }}>{newKey}</code>
                <button
                  onClick={() => copy('newKey', newKey)}
                  className="text-xs px-2 py-1 rounded cursor-pointer"
                  style={{ background: amberBg, color: amber }}
                >
                  {copied === 'newKey' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {keys.length > 0 ? (
            <div className="space-y-2 mb-3">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded" style={{ background: amberBg }}>
                  <div>
                    <span style={{ color: amber }}>river_{'•'.repeat(8)}{k.key_hint || ''}</span>
                    {k.last_used_at && (
                      <span className="ml-2" style={{ color: 'rgba(200, 165, 110, 0.3)' }}>
                        used {new Date(k.last_used_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => revokeKey(k.id)}
                    className="cursor-pointer"
                    style={{ color: amberDim }}
                  >
                    revoke
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs mb-3" style={{ color: amberDim }}>
              No API keys yet. Generate one to connect.
            </p>
          )}

          <button
            onClick={createKey}
            className="text-xs px-4 py-2 rounded cursor-pointer transition-colors"
            style={{ background: amberBg, color: amber, border: `1px solid ${panelBorder}` }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(200, 165, 110, 0.15)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = amberBg }}
          >
            Generate New API Key
          </button>
        </section>

        {/* Config blocks */}
        <ConfigBlock
          title="Claude Code"
          description="Add to .mcp.json or Claude Code settings"
          config={configs.claudeCode}
          configKey="claudeCode"
          copied={copied}
          onCopy={copy}
          amber={amber}
          amberDim={amberDim}
          panelBg={panelBg}
          panelBorder={panelBorder}
        />

        <ConfigBlock
          title="Codex"
          description="Add to your Codex MCP config. Same format works with any MCP client that supports SSE transport."
          config={configs.codex}
          configKey="codex"
          copied={copied}
          onCopy={copy}
          amber={amber}
          amberDim={amberDim}
          panelBg={panelBg}
          panelBorder={panelBorder}
        />
      </div>
    </div>
  )
}

function ConfigBlock({
  title, description, config, configKey, copied, onCopy,
  amber, amberDim, panelBg, panelBorder,
}: {
  title: string; description: string; config: string; configKey: string
  copied: string | null; onCopy: (key: string, text: string) => void
  amber: string; amberDim: string; panelBg: string; panelBorder: string
}) {
  return (
    <section className="rounded-lg p-5 mb-6" style={{ background: panelBg, border: `1px solid ${panelBorder}` }}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-medium" style={{ color: amber }}>{title}</h2>
          <p className="text-xs" style={{ color: amberDim }}>{description}</p>
        </div>
        <button
          onClick={() => onCopy(configKey, config)}
          className="text-xs px-2 py-1 rounded cursor-pointer self-start sm:shrink-0"
          style={{ border: `1px solid ${panelBorder}`, color: amberDim }}
        >
          {copied === configKey ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded p-3 text-xs" style={{ background: 'rgba(0,0,0,0.3)', color: amberDim }}>
        <code>{config}</code>
      </pre>
    </section>
  )
}
