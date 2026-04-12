// Web state layer — all River operations using Supabase
// Direct port of src/state.ts + src/db/* from SQLite to Supabase query builder

import { type SupabaseClient } from '@supabase/supabase-js'
import {
  type Task,
  type TaskWithPosition,
  type LookResult,
  type PlanState,
  type PlanLaneInfo,
  DEFAULT_MASS,
  DEFAULT_SOLIDITY,
  positionToAnchor,
  taskWithPosition,
  rowToTask,
} from './schema'

const LANE_PREFIX = '_plan_lane_'
function laneBranchName(lane: number): string {
  return `${LANE_PREFIX}${lane}`
}

export class WebState {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
  ) {}

  // ── Meta helpers ───────────────────────────────────────────────

  private async getMeta(key: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('meta')
      .select('value')
      .eq('user_id', this.userId)
      .eq('key', key)
      .single()
    return data?.value ?? null
  }

  private async setMeta(key: string, value: string): Promise<void> {
    await this.supabase.from('meta').upsert({
      user_id: this.userId,
      key,
      value,
    })
  }

  private async deleteMeta(key: string): Promise<void> {
    await this.supabase
      .from('meta')
      .delete()
      .eq('user_id', this.userId)
      .eq('key', key)
  }

  // ── Timeline helpers ───────────────────────────────────────────

  private async getMainTimelineId(): Promise<string> {
    const { data } = await this.supabase
      .from('timelines')
      .select('id')
      .eq('user_id', this.userId)
      .eq('name', 'main')
      .single()
    return data!.id
  }

  private async currentTimelineId(): Promise<string> {
    const id = await this.getMeta('current_timeline_id')
    return id!
  }

  async ensureUser(): Promise<void> {
    // Check if main timeline exists — if not, create initial data
    const { data } = await this.supabase
      .from('timelines')
      .select('id')
      .eq('user_id', this.userId)
      .eq('name', 'main')
      .maybeSingle()

    if (!data) {
      const id = crypto.randomUUID()
      await this.supabase.from('timelines').insert({
        id,
        user_id: this.userId,
        name: 'main',
        created: new Date().toISOString(),
      })
      await this.setMeta('current_timeline_id', id)
    }
  }

  // ── Task CRUD ──────────────────────────────────────────────────

  async putTask(input: Record<string, unknown>): Promise<Task> {
    const timelineId = await this.currentTimelineId()

    let anchor: string | null | undefined = undefined
    if (input.position !== undefined) {
      anchor =
        input.position === null ? null : positionToAnchor(input.position as number)
    }

    if (input.id) {
      // Update existing
      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.mass !== undefined) updates.mass = input.mass
      if (anchor !== undefined) updates.anchor = anchor
      if (input.solidity !== undefined) updates.solidity = input.solidity
      if (input.energy !== undefined) updates.energy = input.energy
      if (input.fixed !== undefined) updates.fixed = input.fixed
      if (input.alive !== undefined) {
        if (input.alive === true) {
          await this.supabase
            .from('tasks')
            .update({ alive: false })
            .eq('user_id', this.userId)
            .eq('timeline_id', timelineId)
            .eq('alive', true)
        }
        updates.alive = input.alive
      }
      if (input.tags !== undefined) updates.tags = input.tags
      if (input.cloud_x !== undefined) updates.cloud_x = input.cloud_x
      if (input.cloud_y !== undefined) updates.cloud_y = input.cloud_y
      if (input.river_y !== undefined) updates.river_y = input.river_y

      if (Object.keys(updates).length > 0) {
        await this.supabase
          .from('tasks')
          .update(updates)
          .eq('id', input.id)
          .eq('user_id', this.userId)
          .eq('timeline_id', timelineId)
      }

      const { data } = await this.supabase
        .from('tasks')
        .select('*')
        .eq('id', input.id)
        .eq('user_id', this.userId)
        .single()
      return rowToTask(data!)
    } else {
      // Create new
      if (input.alive === true) {
        await this.supabase
          .from('tasks')
          .update({ alive: false })
          .eq('user_id', this.userId)
          .eq('timeline_id', timelineId)
          .eq('alive', true)
      }

      const id = crypto.randomUUID()
      const row = {
        id,
        user_id: this.userId,
        timeline_id: timelineId,
        name: (input.name as string) || 'untitled',
        mass: (input.mass as number) ?? DEFAULT_MASS,
        anchor: anchor ?? null,
        solidity: (input.solidity as number) ?? DEFAULT_SOLIDITY,
        energy: (input.energy as number) ?? 0.5,
        fixed: (input.fixed as boolean) ?? false,
        alive: (input.alive as boolean) ?? false,
        tags: (input.tags as string[]) ?? [],
        created: new Date().toISOString(),
        cloud_x: (input.cloud_x as number) ?? null,
        cloud_y: (input.cloud_y as number) ?? null,
        river_y: (input.river_y as number) ?? null,
      }

      await this.supabase.from('tasks').insert(row)
      return rowToTask(row)
    }
  }

  async deleteTask(id: string): Promise<void> {
    const timelineId = await this.currentTimelineId()
    await this.supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', this.userId)
      .eq('timeline_id', timelineId)
  }

  // ── Move ───────────────────────────────────────────────────────

  async moveTask(id: string, position: number | null): Promise<void> {
    const anchor = position === null ? null : positionToAnchor(position)
    const timelineId = await this.currentTimelineId()
    await this.supabase
      .from('tasks')
      .update({ anchor })
      .eq('id', id)
      .eq('user_id', this.userId)
      .eq('timeline_id', timelineId)
  }

  // ── Recirculate ────────────────────────────────────────────────

  private async recirculate(): Promise<void> {
    const timelineId = await this.currentTimelineId()
    const now = new Date().toISOString()

    // Find non-fixed, non-alive tasks that have drifted past
    const { data: pastTasks } = await this.supabase
      .from('tasks')
      .select('id')
      .eq('user_id', this.userId)
      .eq('timeline_id', timelineId)
      .not('anchor', 'is', null)
      .lt('anchor', now)
      .eq('fixed', false)
      .eq('alive', false)

    if (pastTasks && pastTasks.length > 0) {
      const ids = pastTasks.map((t: { id: string }) => t.id)
      await this.supabase
        .from('tasks')
        .update({ anchor: null, solidity: 0.0 })
        .eq('user_id', this.userId)
        .eq('timeline_id', timelineId)
        .in('id', ids)
    }
  }

  // ── Look (full state read) ─────────────────────────────────────

  async look(): Promise<LookResult> {
    await this.recirculate()

    const timelineId = await this.currentTimelineId()
    const now = new Date()
    const nowIso = now.toISOString()

    const { data: riverRows } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', this.userId)
      .eq('timeline_id', timelineId)
      .not('anchor', 'is', null)
      .order('anchor', { ascending: true })

    const { data: cloudRows } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', this.userId)
      .eq('timeline_id', timelineId)
      .is('anchor', null)

    const river = (riverRows ?? []).map((r: Record<string, unknown>) =>
      taskWithPosition(rowToTask(r)),
    )
    const cloud = (cloudRows ?? []).map((r: Record<string, unknown>) =>
      taskWithPosition(rowToTask(r)),
    )

    // Breathing room
    const endOf4h = new Date(now.getTime() + 4 * 3_600_000)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)

    const tasksNext4h = river.filter(
      (t) => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOf4h,
    )
    const tasksRestOfDay = river.filter(
      (t) => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOfDay,
    )

    const usedNext4h = tasksNext4h.reduce((sum, t) => sum + t.mass, 0)
    const usedRestOfDay = tasksRestOfDay.reduce((sum, t) => sum + t.mass, 0)
    const minutesUntilEndOfDay = (endOfDay.getTime() - now.getTime()) / 60_000

    // Plan state
    const planState = await this.getPlanState()
    let plan = undefined
    if (planState.active) {
      const enrichedLanes = await Promise.all(
        planState.lanes.map(async (lane) => {
          const tasks = await this.getLaneTasks(lane.number)
          return { ...lane, tasks: [...tasks.river, ...tasks.cloud] }
        }),
      )
      plan = { ...planState, lanes: enrichedLanes }
    }

    // Known tags
    const knownTags = await this.getKnownTags()

    return {
      river,
      cloud,
      breathing_room: {
        next_4h: Math.max(0, 240 - usedNext4h),
        rest_of_day: Math.max(0, minutesUntilEndOfDay - usedRestOfDay),
      },
      now: nowIso,
      timeline: 'main',
      known_tags: knownTags,
      plan,
    }
  }

  // ── Tags ───────────────────────────────────────────────────────

  async getKnownTags(): Promise<string[]> {
    const raw = await this.getMeta('known_tags')
    return raw ? JSON.parse(raw).sort() : []
  }

  async addKnownTag(tag: string): Promise<void> {
    const tags = await this.getKnownTags()
    if (!tags.includes(tag)) {
      tags.push(tag)
      await this.setMeta('known_tags', JSON.stringify(tags))
    }
  }

  async ensureTaskTags(taskTags: string[] | undefined): Promise<void> {
    if (!taskTags) return
    for (const tag of taskTags) await this.addKnownTag(tag)
  }

  // ── Plan Mode ──────────────────────────────────────────────────

  async startPlan(windowStart: string, windowEnd: string): Promise<void> {
    const existing = await this.getMeta('plan_mode')
    if (existing === 'true') throw new Error('Plan mode already active')

    const mainId = await this.getMainTimelineId()
    const now = new Date().toISOString()

    for (let i = 1; i <= 5; i++) {
      const branchName = laneBranchName(i)
      const branchId = crypto.randomUUID()

      await this.supabase.from('timelines').insert({
        id: branchId,
        user_id: this.userId,
        name: branchName,
        parent_id: mainId,
        created: now,
      })

      // Lane 1: snapshot of main river tasks in the window
      if (i === 1) {
        const { data: tasks } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', this.userId)
          .eq('timeline_id', mainId)
          .not('anchor', 'is', null)
          .gte('anchor', windowStart)
          .lte('anchor', windowEnd)

        if (tasks && tasks.length > 0) {
          const inserts = tasks.map((t: Record<string, unknown>) => ({
            id: crypto.randomUUID(),
            user_id: this.userId,
            timeline_id: branchId,
            name: t.name,
            mass: t.mass,
            anchor: t.anchor,
            solidity: t.solidity,
            energy: t.energy,
            fixed: t.fixed,
            alive: t.alive,
            tags: t.tags,
            created: t.created,
            cloud_x: t.cloud_x,
            cloud_y: t.cloud_y,
            river_y: t.river_y,
          }))
          await this.supabase.from('tasks').insert(inserts)
        }
      }
    }

    await this.setMeta('plan_mode', 'true')
    await this.setMeta('plan_window_start', windowStart)
    await this.setMeta('plan_window_end', windowEnd)
  }

  async endPlan(): Promise<void> {
    await this.cleanupPlan()
  }

  async commitLane(lane: number): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const mainId = await this.getMainTimelineId()
    const windowStart = await this.getMeta('plan_window_start')
    const windowEnd = await this.getMeta('plan_window_end')
    if (!windowStart || !windowEnd) throw new Error('Plan window not defined')

    // Delete main tasks in the window
    await this.supabase
      .from('tasks')
      .delete()
      .eq('user_id', this.userId)
      .eq('timeline_id', mainId)
      .not('anchor', 'is', null)
      .gte('anchor', windowStart)
      .lte('anchor', windowEnd)

    // Move lane tasks to main
    await this.supabase
      .from('tasks')
      .update({ timeline_id: mainId })
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)

    await this.cleanupPlan()
  }

  async getPlanState(): Promise<PlanState> {
    const active = (await this.getMeta('plan_mode')) === 'true'
    if (!active)
      return { active: false, window_start: null, window_end: null, lanes: [] }

    const windowStart = await this.getMeta('plan_window_start')
    const windowEnd = await this.getMeta('plan_window_end')
    const lanes: PlanLaneInfo[] = []

    for (let i = 1; i <= 5; i++) {
      const branchName = laneBranchName(i)
      const { data: branch } = await this.supabase
        .from('timelines')
        .select('id')
        .eq('user_id', this.userId)
        .eq('name', branchName)
        .maybeSingle()

      if (branch) {
        const { count } = await this.supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', this.userId)
          .eq('timeline_id', branch.id)

        const label = await this.getMeta(`plan_lane_${i}_label`)

        lanes.push({
          number: i,
          label,
          taskCount: count ?? 0,
          branchName,
          readonly: false,
        })
      }
    }

    return { active, window_start: windowStart, window_end: windowEnd, lanes }
  }

  async getLaneTasks(
    lane: number,
  ): Promise<{ river: TaskWithPosition[]; cloud: TaskWithPosition[] }> {
    const branchId = await this.getLaneBranchId(lane).catch(() => null)
    if (!branchId) return { river: [], cloud: [] }

    const { data: riverRows } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)
      .not('anchor', 'is', null)
      .order('anchor', { ascending: true })

    const { data: cloudRows } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)
      .is('anchor', null)

    return {
      river: (riverRows ?? []).map((r: Record<string, unknown>) => taskWithPosition(rowToTask(r))),
      cloud: (cloudRows ?? []).map((r: Record<string, unknown>) => taskWithPosition(rowToTask(r))),
    }
  }

  // ── Lane manipulation ──────────────────────────────────────────

  async putTaskInLane(lane: number, name: string, position: number | null): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const anchor = position != null ? positionToAnchor(position) : null
    await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(),
      user_id: this.userId,
      timeline_id: branchId,
      name,
      mass: DEFAULT_MASS,
      anchor,
      solidity: DEFAULT_SOLIDITY,
      energy: 0.5,
      fixed: false,
      alive: false,
      tags: [],
      created: new Date().toISOString(),
    })
  }

  async updateTaskInLane(
    lane: number,
    taskId: string,
    updates: { mass?: number; solidity?: number; energy?: number; position?: number },
  ): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const patch: Record<string, unknown> = {}
    if (updates.mass !== undefined) patch.mass = updates.mass
    if (updates.solidity !== undefined) patch.solidity = updates.solidity
    if (updates.energy !== undefined) patch.energy = updates.energy
    if (updates.position !== undefined) patch.anchor = positionToAnchor(updates.position)
    if (Object.keys(patch).length === 0) return
    await this.supabase
      .from('tasks')
      .update(patch)
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)
  }

  async removeFromLane(lane: number, taskId: string): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    await this.supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)
  }

  async repositionInLane(lane: number, taskId: string, position: number): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    await this.supabase
      .from('tasks')
      .update({ anchor: positionToAnchor(position) })
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)
  }

  async laneToCloud(lane: number, taskId: string): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const { data: source } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)
      .single()
    if (!source) throw new Error(`Task ${taskId} not found in lane ${lane}`)

    const mainId = await this.getMainTimelineId()
    await this.supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', branchId)

    await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(),
      user_id: this.userId,
      timeline_id: mainId,
      name: source.name,
      mass: source.mass,
      anchor: null,
      solidity: source.solidity,
      energy: source.energy,
      fixed: source.fixed,
      alive: source.alive,
      tags: source.tags,
      created: source.created,
    })
  }

  async addToLane(
    lane: number,
    taskId: string,
    position: number | null,
    copy: boolean,
  ): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const mainId = await this.getMainTimelineId()

    // Find the source task (check main timeline first, then lanes)
    let source: Record<string, unknown> | null = null
    let sourceTimeline = mainId

    const { data: mainTask } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', mainId)
      .maybeSingle()

    if (mainTask) {
      source = mainTask
    } else {
      for (let i = 1; i <= 5; i++) {
        const bid = await this.getLaneBranchId(i).catch(() => null)
        if (!bid) continue
        const { data } = await this.supabase
          .from('tasks')
          .select('*')
          .eq('id', taskId)
          .eq('user_id', this.userId)
          .eq('timeline_id', bid)
          .maybeSingle()
        if (data) {
          source = data
          sourceTimeline = bid
          break
        }
      }
    }
    if (!source) throw new Error(`Task ${taskId} not found`)

    const anchor =
      position != null ? positionToAnchor(position) : (source.anchor as string | null)

    await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(),
      user_id: this.userId,
      timeline_id: branchId,
      name: source.name,
      mass: source.mass,
      anchor,
      solidity: source.solidity,
      energy: source.energy,
      fixed: source.fixed,
      alive: source.alive,
      tags: source.tags,
      created: source.created,
    })

    if (!copy) {
      await this.supabase
        .from('tasks')
        .delete()
        .eq('id', taskId)
        .eq('user_id', this.userId)
        .eq('timeline_id', sourceTimeline)
    }
  }

  async moveBetweenLanes(
    fromLane: number,
    toLane: number,
    taskId: string,
    position: number,
  ): Promise<void> {
    const fromBranchId = await this.getLaneBranchId(fromLane)
    const toBranchId = await this.getLaneBranchId(toLane)
    const { data: source } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', fromBranchId)
      .single()
    if (!source) throw new Error(`Task ${taskId} not found in lane ${fromLane}`)

    await this.supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', fromBranchId)

    await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(),
      user_id: this.userId,
      timeline_id: toBranchId,
      name: source.name,
      mass: source.mass,
      anchor: positionToAnchor(position),
      solidity: source.solidity,
      energy: source.energy,
      fixed: source.fixed,
      alive: source.alive,
      tags: source.tags,
      created: source.created,
    })
  }

  async copyBetweenLanes(
    fromLane: number,
    toLane: number,
    taskId: string,
    position: number,
  ): Promise<void> {
    const fromBranchId = await this.getLaneBranchId(fromLane)
    const toBranchId = await this.getLaneBranchId(toLane)
    const { data: source } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', this.userId)
      .eq('timeline_id', fromBranchId)
      .single()
    if (!source) throw new Error(`Task ${taskId} not found in lane ${fromLane}`)

    await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(),
      user_id: this.userId,
      timeline_id: toBranchId,
      name: source.name,
      mass: source.mass,
      anchor: positionToAnchor(position),
      solidity: source.solidity,
      energy: source.energy,
      fixed: source.fixed,
      alive: source.alive,
      tags: source.tags,
      created: source.created,
    })
  }

  // ── Private helpers ────────────────────────────────────────────

  private async getLaneBranchId(lane: number): Promise<string> {
    const { data } = await this.supabase
      .from('timelines')
      .select('id')
      .eq('user_id', this.userId)
      .eq('name', laneBranchName(lane))
      .single()
    if (!data) throw new Error(`Lane ${lane} branch not found`)
    return data.id
  }

  private async cleanupPlan(): Promise<void> {
    for (let i = 1; i <= 5; i++) {
      const branchName = laneBranchName(i)
      const { data: branch } = await this.supabase
        .from('timelines')
        .select('id')
        .eq('user_id', this.userId)
        .eq('name', branchName)
        .maybeSingle()

      if (branch) {
        await this.supabase
          .from('tasks')
          .delete()
          .eq('user_id', this.userId)
          .eq('timeline_id', branch.id)

        await this.supabase
          .from('timeline_tasks')
          .delete()
          .eq('user_id', this.userId)
          .eq('timeline_id', branch.id)

        await this.supabase
          .from('timelines')
          .delete()
          .eq('id', branch.id)
          .eq('user_id', this.userId)
      }

      await this.deleteMeta(`plan_lane_${i}_label`)
    }

    await this.deleteMeta('plan_mode')
    await this.deleteMeta('plan_window_start')
    await this.deleteMeta('plan_window_end')

    const mainId = await this.getMainTimelineId()
    await this.setMeta('current_timeline_id', mainId)
  }
}
