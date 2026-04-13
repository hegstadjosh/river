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

      // Query Supabase DIRECTLY for preload — no API route, no cold start
      const uid = session.user.id

      const tidPromise = Promise.resolve(
        supabase
          .from('meta').select('value')
          .eq('user_id', uid).eq('key', 'current_timeline_id')
          .single()
          .then(({ data }) => data?.value ?? null)
      ).catch(() => null)

      const statePromise = tidPromise.then(async (tid) => {
        if (!tid) return null
        const now = new Date()
        const nowIso = now.toISOString()

        const [riverRes, cloudRes, tagsRes, planRes] = await Promise.all([
          supabase.from('tasks').select('*')
            .eq('user_id', uid).eq('timeline_id', tid)
            .not('anchor', 'is', null).order('anchor', { ascending: true }),
          supabase.from('tasks').select('*')
            .eq('user_id', uid).eq('timeline_id', tid)
            .is('anchor', null),
          supabase.from('meta').select('value')
            .eq('user_id', uid).eq('key', 'known_tags').maybeSingle(),
          supabase.from('meta').select('value')
            .eq('user_id', uid).eq('key', 'plan_mode').maybeSingle(),
        ])

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const withPos = (t: any) => ({
          ...t,
          position: t.anchor ? (new Date(t.anchor).getTime() - Date.now()) / 3600000 : null,
          tags: t.tags || [],
        })

        const river = (riverRes.data ?? []).map(withPos)
        const cloud = (cloudRes.data ?? []).map(withPos)

        const endOf4h = new Date(now.getTime() + 4 * 3600000)
        const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999)
        const usedNext4h = river.filter(t => t.anchor && new Date(t.anchor as string) >= now && new Date(t.anchor as string) <= endOf4h)
          .reduce((s, t) => s + (t.mass as number), 0)
        const usedRoD = river.filter(t => t.anchor && new Date(t.anchor as string) >= now && new Date(t.anchor as string) <= endOfDay)
          .reduce((s, t) => s + (t.mass as number), 0)

        return {
          river, cloud,
          breathing_room: { next_4h: Math.max(0, 240 - usedNext4h), rest_of_day: Math.max(0, (endOfDay.getTime() - now.getTime()) / 60000 - usedRoD) },
          now: nowIso, timeline: 'main',
          known_tags: tagsRes.data ? JSON.parse(tagsRes.data.value).sort() : [],
          plan: planRes.data?.value === 'true' ? { active: true } : undefined,
        }
      }).catch(() => null)

      const iframe = iframeRef.current
      if (iframe) {
        iframe.onload = async () => {
          const [preloadedState, timelineId] = await Promise.all([statePromise, tidPromise])
          iframe.contentWindow?.postMessage(
            { type: 'auth-token', token: session.access_token, state: preloadedState, userId: uid, timelineId },
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
