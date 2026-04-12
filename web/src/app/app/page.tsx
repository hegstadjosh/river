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

    // Listen for sign-out message from iframe
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === 'sign-out') {
        supabase.auth.signOut().then(() => router.push('/'))
      }
    }
    window.addEventListener('message', handleMessage)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('message', handleMessage)
    }
  }, [router])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#17161a' }}>
        <p style={{ color: 'rgba(200, 165, 110, 0.4)' }}>loading...</p>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen" style={{ background: '#17161a' }}>
      <iframe
        ref={iframeRef}
        src="/viewer/index.html"
        className="w-full h-full border-0"
        allow="fullscreen"
      />
    </div>
  )
}
