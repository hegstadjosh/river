'use client'

import { createClient } from '@/lib/supabase/client'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState } from 'react'

function LoginContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const error = searchParams.get('error')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [message, setMessage] = useState(error ? 'Something went wrong. Please try again.' : '')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const supabase = createClient()

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) {
        setMessage(error.message)
      } else {
        setMessage('Check your email to confirm your account.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage(error.message)
      } else {
        router.push('/app')
      }
    }

    setLoading(false)
  }

  const amber = 'rgb(200, 165, 110)'
  const amberDim = 'rgba(200, 165, 110, 0.5)'
  const amberBg = 'rgba(200, 165, 110, 0.15)'

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#17161a' }}>
      <div className="text-center space-y-8 max-w-sm w-full px-6">
        <div>
          <h1 className="text-3xl font-light tracking-wide mb-2" style={{ color: amber }}>
            River
          </h1>
          <p className="text-sm" style={{ color: amberDim }}>
            vibe scheduling
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            required
            className="w-full py-3 px-4 rounded-lg text-sm outline-none"
            style={{
              background: 'rgba(200, 165, 110, 0.08)',
              color: amber,
              border: '1px solid rgba(200, 165, 110, 0.15)',
            }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            required
            minLength={6}
            className="w-full py-3 px-4 rounded-lg text-sm outline-none"
            style={{
              background: 'rgba(200, 165, 110, 0.08)',
              color: amber,
              border: '1px solid rgba(200, 165, 110, 0.15)',
            }}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-6 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50"
            style={{
              background: amberBg,
              color: amber,
              border: '1px solid rgba(200, 165, 110, 0.25)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(200, 165, 110, 0.25)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = amberBg }}
          >
            {loading ? '...' : mode === 'login' ? 'sign in' : 'create account'}
          </button>
        </form>

        {message && (
          <p className="text-sm" style={{ color: 'rgba(200, 165, 110, 0.7)' }}>
            {message}
          </p>
        )}

        <button
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage('') }}
          className="text-xs cursor-pointer bg-transparent border-none"
          style={{ color: amberDim }}
        >
          {mode === 'login' ? 'need an account? sign up' : 'already have one? sign in'}
        </button>

        <a
          href="/"
          className="block text-xs transition-colors"
          style={{ color: 'rgba(200, 165, 110, 0.3)' }}
        >
          &larr; back
        </a>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
