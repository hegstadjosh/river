'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AppPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }
      setReady(true)

      // Send token to iframe once it loads
      const iframe = iframeRef.current
      if (iframe) {
        iframe.onload = () => {
          iframe.contentWindow?.postMessage(
            { type: 'auth-token', token: session.access_token },
            window.location.origin
          )
        }
      }
    }

    checkAuth()

    // Listen for token refresh and forward to iframe
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: 'auth-token', token: session.access_token },
            window.location.origin
          )
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [router])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#17161a' }}
      >
        <p style={{ color: 'rgba(200, 165, 110, 0.4)' }}>loading...</p>
      </div>
    )
  }

  return (
    <div className="relative w-screen h-screen" style={{ background: '#17161a' }}>
      <iframe
        ref={iframeRef}
        src="/viewer/index.html"
        className="w-full h-full border-0"
        allow="fullscreen"
      />
      <button
        onClick={handleLogout}
        className="absolute top-3 right-24 text-xs px-3 py-1 rounded transition-opacity opacity-30 hover:opacity-80 cursor-pointer z-10"
        style={{
          color: 'rgb(200, 165, 110)',
          background: 'rgba(200, 165, 110, 0.1)',
        }}
      >
        sign out
      </button>
    </div>
  )
}
