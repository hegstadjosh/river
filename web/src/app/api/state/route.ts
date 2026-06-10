import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/server'
import { WebState } from '@/lib/river/state'

async function getAuthedState() {
  const { data: session } = await auth.getSession()
  if (!session?.user) return null
  return new WebState(session.user.id)
}

export const dynamic = 'force-dynamic'

export async function GET() {
  const state = await getAuthedState()
  if (!state) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const result = await state.look()
  return NextResponse.json(result)
}

export async function POST(request: Request) {
  const state = await getAuthedState()
  if (!state) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any
  try {
    data = await request.json()
    if (!data || typeof data !== 'object') throw new Error('invalid body')
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 })
  }
  const action = data.action as string

  try {
    switch (action) {
      case 'put': {
        const { action: _, ...rest } = data
        await state.putTask(rest)
        if (rest.tags) await state.ensureTaskTags(rest.tags as string[])
        break
      }
      case 'move':
        await state.moveTask(data.id, data.position)
        break
      case 'delete':
        await state.deleteTask(data.id)
        break
      case 'tag_create':
        await state.addKnownTag(data.name)
        break
      case 'tag_delete':
        await state.deleteTag(data.name)
        break
      case 'tag_rename':
        await state.renameTag(data.oldName, data.newName)
        break
      case 'plan_start':
        await state.startPlan(data.window_start, data.window_end)
        break
      case 'plan_end':
        await state.endPlan()
        break
      case 'plan_commit':
        await state.commitLane((data.lane ?? 0) + 1)
        break
      case 'plan_lane_put':
        await state.putTaskInLane((data.lane ?? 0) + 1, data.name, data.position ?? null)
        break
      case 'plan_update_task':
        await state.updateTaskInLane((data.lane ?? 0) + 1, data.task_id, {
          mass: data.mass, solidity: data.solidity, energy: data.energy, position: data.position,
        })
        break
      case 'plan_to_cloud':
        await state.laneToCloud((data.lane ?? 0) + 1, data.task_id)
        break
      case 'plan_add':
        await state.addToLane((data.lane ?? 0) + 1, data.task_id, data.position ?? null, !!data.copy)
        break
      case 'plan_remove':
        await state.removeFromLane((data.lane ?? 0) + 1, data.task_id)
        break
      case 'plan_reposition':
        await state.repositionInLane((data.lane ?? 0) + 1, data.task_id, data.position)
        break
      case 'plan_move':
        await state.moveBetweenLanes(
          (data.from_lane ?? 0) + 1, (data.to_lane ?? 0) + 1, data.task_id, data.position,
        )
        break
      case 'plan_copy':
        await state.copyBetweenLanes(
          (data.from_lane ?? 0) + 1, (data.to_lane ?? 0) + 1, data.task_id, data.position,
        )
        break
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    // Return full state after mutation so viewer updates instantly
    const result = await state.look()
    return NextResponse.json(result)
  } catch (err) {
    console.error('POST /api/state error:', err)
    return NextResponse.json({ error: 'operation failed' }, { status: 400 })
  }
}
