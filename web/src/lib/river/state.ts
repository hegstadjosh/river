// Web state layer — all River operations using Supabase
// Optimized: parallel queries, cached timeline ID, minimal roundtrips

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
  private _timelineId: string | null = null

  constructor(
    private supabase: SupabaseClient,
    private userId: string,
  ) {}

  // ── Cached timeline ID ─────────────────────────────────────────

  private async getTimelineId(): Promise<string> {
    if (this._timelineId) return this._timelineId
    const { data } = await this.supabase
      .from('meta')
      .select('value')
      .eq('user_id', this.userId)
      .eq('key', 'current_timeline_id')
      .single()
    this._timelineId = data?.value ?? null
    return this._timelineId!
  }

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
    const { error } = await this.supabase.from('meta').upsert({ user_id: this.userId, key, value })
    if (error) throw new Error(`Failed to set meta '${key}': ${error.message}`)
  }

  private async deleteMeta(key: string): Promise<void> {
    await this.supabase.from('meta').delete().eq('user_id', this.userId).eq('key', key)
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

  async ensureUser(): Promise<void> {
    const { data } = await this.supabase
      .from('timelines')
      .select('id')
      .eq('user_id', this.userId)
      .eq('name', 'main')
      .maybeSingle()

    if (!data) {
      const id = crypto.randomUUID()
      const { error } = await this.supabase.from('timelines').insert({
        id, user_id: this.userId, name: 'main', created: new Date().toISOString(),
      })
      if (error) throw new Error(`Failed to create main timeline: ${error.message}`)
      await this.setMeta('current_timeline_id', id)
      this._timelineId = id
    } else {
      this._timelineId = data.id
      // Ensure meta entry exists
      const { data: meta } = await this.supabase
        .from('meta')
        .select('value')
        .eq('user_id', this.userId)
        .eq('key', 'current_timeline_id')
        .maybeSingle()
      if (!meta) {
        await this.setMeta('current_timeline_id', data.id)
      }
    }
  }

  // ── Task CRUD ──────────────────────────────────────────────────

  async putTask(input: Record<string, unknown>): Promise<Task> {
    const timelineId = await this.getTimelineId()

    let anchor: string | null | undefined = undefined
    if (input.position !== undefined) {
      anchor = input.position === null ? null : positionToAnchor(input.position as number)
    }

    if (input.id) {
      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.mass !== undefined) updates.mass = input.mass
      if (anchor !== undefined) updates.anchor = anchor
      if (input.solidity !== undefined) updates.solidity = input.solidity
      if (input.energy !== undefined) updates.energy = input.energy
      if (input.fixed !== undefined) updates.fixed = input.fixed
      if (input.alive !== undefined) updates.alive = input.alive
      if (input.tags !== undefined) updates.tags = input.tags
      if (input.cloud_x !== undefined) updates.cloud_x = input.cloud_x
      if (input.cloud_y !== undefined) updates.cloud_y = input.cloud_y
      if (input.river_y !== undefined) updates.river_y = input.river_y

      if (Object.keys(updates).length > 0) {
        const { error } = await this.supabase
          .from('tasks')
          .update(updates)
          .eq('id', input.id)
          .eq('user_id', this.userId)
          .eq('timeline_id', timelineId)
        if (error) throw new Error(`Failed to update task ${input.id}: ${error.message}`)
      }

      const { data } = await this.supabase
        .from('tasks').select('*').eq('id', input.id).eq('user_id', this.userId).single()
      if (!data) throw new Error(`Task ${input.id} not found after update`)
      return rowToTask(data)
    } else {
      const id = crypto.randomUUID()
      const row = {
        id, user_id: this.userId, timeline_id: timelineId,
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
      const { error } = await this.supabase.from('tasks').insert(row)
      if (error) throw new Error(`Failed to create task: ${error.message}`)
      return rowToTask(row)
    }
  }

  async deleteTask(id: string): Promise<void> {
    const timelineId = await this.getTimelineId()
    const { error } = await this.supabase.from('tasks').delete()
      .eq('id', id).eq('user_id', this.userId).eq('timeline_id', timelineId)
    if (error) throw new Error(`Failed to delete task ${id}: ${error.message}`)
  }

  async moveTask(id: string, position: number | null): Promise<void> {
    const anchor = position === null ? null : positionToAnchor(position)
    const timelineId = await this.getTimelineId()
    const { error } = await this.supabase.from('tasks').update({ anchor })
      .eq('id', id).eq('user_id', this.userId).eq('timeline_id', timelineId)
    if (error) throw new Error(`Failed to move task ${id}: ${error.message}`)
  }

  // ── Look (full state read) — PARALLELIZED ──────────────────────

  async look(options?: { horizon?: number; id?: string; cloud?: boolean }): Promise<LookResult> {
    const timelineId = await this.getTimelineId()
    const now = new Date()
    const nowIso = now.toISOString()

    // Run ALL queries in parallel — this is the key optimization
    const [
      riverResult,
      cloudResult,
      recirculateResult,
      planModeResult,
      planWindowStartResult,
      planWindowEndResult,
      knownTagsResult,
    ] = await Promise.all([
      // 1. River tasks
      this.supabase.from('tasks').select('*')
        .eq('user_id', this.userId).eq('timeline_id', timelineId)
        .not('anchor', 'is', null).order('anchor', { ascending: true }),
      // 2. Cloud tasks
      this.supabase.from('tasks').select('*')
        .eq('user_id', this.userId).eq('timeline_id', timelineId)
        .is('anchor', null),
      // 3. Find past tasks to recirculate (non-fixed, non-alive, past anchor)
      this.supabase.from('tasks').select('id')
        .eq('user_id', this.userId).eq('timeline_id', timelineId)
        .not('anchor', 'is', null).lt('anchor', nowIso)
        .eq('fixed', false).eq('alive', false),
      // 4-6. Plan state meta (3 keys in parallel)
      this.getMeta('plan_mode'),
      this.getMeta('plan_window_start'),
      this.getMeta('plan_window_end'),
      // 7. Known tags
      this.getMeta('known_tags'),
    ])

    // Fire-and-forget recirculation update (don't block response)
    const pastTasks = recirculateResult.data
    if (pastTasks && pastTasks.length > 0) {
      const ids = pastTasks.map((t: { id: string }) => t.id)
      void this.supabase.from('tasks')
        .update({ anchor: null, solidity: 0.0 })
        .eq('user_id', this.userId).eq('timeline_id', timelineId)
        .in('id', ids)
    }

    const river = (riverResult.data ?? []).map((r: Record<string, unknown>) => taskWithPosition(rowToTask(r)))
    const cloud = (cloudResult.data ?? []).map((r: Record<string, unknown>) => taskWithPosition(rowToTask(r)))

    // Handle filtered lookups
    if (options?.id) {
      const match = [...river, ...cloud].find(t => t.id === options.id)
      return {
        river: match && match.position !== null ? [match] : [],
        cloud: match && match.position === null ? [match] : [],
        breathing_room: { next_4h: 0, rest_of_day: 0 },
        now: nowIso,
        timeline: 'main',
        known_tags: [],
      }
    }

    let filteredRiver = river
    let filteredCloud = cloud
    if (options?.cloud) {
      filteredRiver = []
    }
    if (options?.horizon !== undefined) {
      filteredRiver = filteredRiver.filter(t => t.position !== null && t.position <= options.horizon!)
    }

    // Breathing room (computed from already-fetched data)
    const endOf4h = new Date(now.getTime() + 4 * 3_600_000)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)
    const usedNext4h = river.filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOf4h).reduce((s, t) => s + t.mass, 0)
    const usedRestOfDay = river.filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOfDay).reduce((s, t) => s + t.mass, 0)
    const minutesUntilEndOfDay = (endOfDay.getTime() - now.getTime()) / 60_000

    // Plan state
    const planActive = planModeResult === 'true'
    let plan = undefined
    if (planActive) {
      // Fetch lane data — parallelize lane queries
      const lanePromises = []
      for (let i = 1; i <= 4; i++) {
        lanePromises.push(this.getLaneFast(i))
      }
      const laneResults = await Promise.all(lanePromises)
      const lanes = laneResults.filter(l => l !== null)
      plan = {
        active: true,
        window_start: planWindowStartResult,
        window_end: planWindowEndResult,
        lanes,
      }
    }

    let knownTags: string[] = []
    if (knownTagsResult) {
      try { knownTags = JSON.parse(knownTagsResult).sort() } catch { knownTags = [] }
    }

    return {
      river: filteredRiver, cloud: filteredCloud,
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

  // Fast lane fetch — single query for both branch ID and tasks
  private async getLaneFast(lane: number): Promise<(PlanLaneInfo & { tasks: TaskWithPosition[] }) | null> {
    const branchName = laneBranchName(lane)
    const { data: branch } = await this.supabase
      .from('timelines').select('id')
      .eq('user_id', this.userId).eq('name', branchName).maybeSingle()
    if (!branch) return null

    const [tasksResult, labelResult] = await Promise.all([
      this.supabase.from('tasks').select('*')
        .eq('user_id', this.userId).eq('timeline_id', branch.id),
      this.getMeta(`plan_lane_${lane}_label`),
    ])

    const allTasks = (tasksResult.data ?? []).map((r: Record<string, unknown>) => taskWithPosition(rowToTask(r)))

    return {
      number: lane,
      label: labelResult,
      taskCount: allTasks.length,
      branchName,
      readonly: false,
      tasks: allTasks,
    }
  }

  // ── Clear ──────────────────────────────────────────────────────

  async clear(timeRange?: { start?: number; end?: number }): Promise<number> {
    const timelineId = await this.getTimelineId()

    if (timeRange && (timeRange.start !== undefined || timeRange.end !== undefined)) {
      let query = this.supabase.from('tasks').delete()
        .eq('user_id', this.userId).eq('timeline_id', timelineId)
        .not('anchor', 'is', null)

      if (timeRange.start !== undefined) {
        query = query.gte('anchor', positionToAnchor(timeRange.start))
      }
      if (timeRange.end !== undefined) {
        query = query.lte('anchor', positionToAnchor(timeRange.end))
      }

      const { data, error } = await query.select('id')
      if (error) throw new Error(`Failed to clear tasks: ${error.message}`)
      return data?.length ?? 0
    }

    // No time range: delete everything on this timeline
    const { data, error } = await this.supabase.from('tasks').delete()
      .eq('user_id', this.userId).eq('timeline_id', timelineId).select('id')
    if (error) throw new Error(`Failed to clear all tasks: ${error.message}`)
    return data?.length ?? 0
  }

  // ── Bulk Sweep ────────────────────────────────────────────────

  async bulkSweep(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const timelineId = await this.getTimelineId()
    const { data, error } = await this.supabase.from('tasks').delete()
      .eq('user_id', this.userId).eq('timeline_id', timelineId)
      .in('id', ids).select('id')
    if (error) throw new Error(`Failed to bulk sweep tasks: ${error.message}`)
    return data?.length ?? 0
  }

  // ── Rename ────────────────────────────────────────────────────

  async rename(id: string, name: string): Promise<Task> {
    const timelineId = await this.getTimelineId()
    const { error } = await this.supabase.from('tasks').update({ name })
      .eq('id', id).eq('user_id', this.userId).eq('timeline_id', timelineId)
    if (error) throw new Error(`Failed to rename task ${id}: ${error.message}`)

    const { data } = await this.supabase.from('tasks').select('*')
      .eq('id', id).eq('user_id', this.userId).single()
    if (!data) throw new Error(`Task ${id} not found after rename`)
    return rowToTask(data)
  }

  // ── Tag / Untag ───────────────────────────────────────────────

  async tag(id: string, tags: string[], action: 'add' | 'remove'): Promise<Task> {
    const timelineId = await this.getTimelineId()

    const { data: existing } = await this.supabase.from('tasks').select('tags')
      .eq('id', id).eq('user_id', this.userId).eq('timeline_id', timelineId).single()
    if (!existing) throw new Error(`Task ${id} not found`)

    const currentTags: string[] = (existing.tags ?? []) as string[]
    let newTags: string[]

    if (action === 'add') {
      const tagSet = new Set(currentTags)
      for (const t of tags) tagSet.add(t)
      newTags = [...tagSet]
    } else {
      const removeSet = new Set(tags)
      newTags = currentTags.filter((t: string) => !removeSet.has(t))
    }

    const { error } = await this.supabase.from('tasks').update({ tags: newTags })
      .eq('id', id).eq('user_id', this.userId).eq('timeline_id', timelineId)
    if (error) throw new Error(`Failed to update tags on task ${id}: ${error.message}`)

    const { data } = await this.supabase.from('tasks').select('*')
      .eq('id', id).eq('user_id', this.userId).single()
    if (!data) throw new Error(`Task ${id} not found after tag update`)
    return rowToTask(data)
  }

  // ── Stats ─────────────────────────────────────────────────────

  async stats(): Promise<{
    total: number
    river_count: number
    cloud_count: number
    tag_distribution: Record<string, number>
    avg_solidity: number
    avg_energy: number
    breathing_room: { next_4h: number; rest_of_day: number }
  }> {
    const timelineId = await this.getTimelineId()
    const now = new Date()

    const { data: allTasks } = await this.supabase.from('tasks').select('*')
      .eq('user_id', this.userId).eq('timeline_id', timelineId)

    const rows = (allTasks ?? []).map((r: Record<string, unknown>) => rowToTask(r))
    const total = rows.length
    const riverTasks = rows.filter(t => t.anchor !== null)
    const cloudTasks = rows.filter(t => t.anchor === null)

    // Tag distribution
    const tagDist: Record<string, number> = {}
    for (const task of rows) {
      for (const t of task.tags) {
        tagDist[t] = (tagDist[t] ?? 0) + 1
      }
    }

    // Averages
    const avgSolidity = total > 0
      ? Math.round((rows.reduce((s, t) => s + t.solidity, 0) / total) * 100) / 100
      : 0
    const avgEnergy = total > 0
      ? Math.round((rows.reduce((s, t) => s + t.energy, 0) / total) * 100) / 100
      : 0

    // Breathing room
    const endOf4h = new Date(now.getTime() + 4 * 3_600_000)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)

    const usedNext4h = riverTasks
      .filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOf4h)
      .reduce((s, t) => s + t.mass, 0)
    const usedRestOfDay = riverTasks
      .filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOfDay)
      .reduce((s, t) => s + t.mass, 0)
    const minutesUntilEndOfDay = (endOfDay.getTime() - now.getTime()) / 60_000

    return {
      total,
      river_count: riverTasks.length,
      cloud_count: cloudTasks.length,
      tag_distribution: tagDist,
      avg_solidity: avgSolidity,
      avg_energy: avgEnergy,
      breathing_room: {
        next_4h: Math.max(0, 240 - usedNext4h),
        rest_of_day: Math.max(0, minutesUntilEndOfDay - usedRestOfDay),
      },
    }
  }

  // ── Tags ───────────────────────────────────────────────────────

  async getKnownTags(): Promise<string[]> {
    const raw = await this.getMeta('known_tags')
    if (!raw) return []
    try { return JSON.parse(raw).sort() } catch { return [] }
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

  async deleteTag(tag: string): Promise<number> {
    // Remove from known_tags index
    const tags = await this.getKnownTags()
    const filtered = tags.filter(t => t !== tag)
    await this.setMeta('known_tags', JSON.stringify(filtered))

    // Remove from all tasks that have this tag
    const timelineId = await this.getTimelineId()
    const { data: tasks } = await this.supabase.from('tasks').select('id, tags')
      .eq('user_id', this.userId).eq('timeline_id', timelineId)
    let updated = 0
    if (tasks) {
      for (const t of tasks) {
        const taskTags: string[] = t.tags || []
        if (taskTags.includes(tag)) {
          const newTags = taskTags.filter((x: string) => x !== tag)
          await this.supabase.from('tasks').update({ tags: newTags })
            .eq('id', t.id).eq('user_id', this.userId)
          updated++
        }
      }
    }
    return updated
  }

  async listTags(): Promise<string[]> {
    return this.getKnownTags()
  }

  async renameTag(oldName: string, newName: string): Promise<void> {
    // Update known_tags index atomically — read, replace, write
    const tags = await this.getKnownTags()
    const updated = tags.map(t => t === oldName ? newName : t)
    if (!updated.includes(newName)) updated.push(newName)
    const deduped = [...new Set(updated)]
    await this.setMeta('known_tags', JSON.stringify(deduped))

    // Update all tasks that have the old tag
    const timelineId = await this.getTimelineId()
    const { data: tasks } = await this.supabase.from('tasks').select('id, tags')
      .eq('user_id', this.userId).eq('timeline_id', timelineId)
    if (tasks) {
      for (const t of tasks) {
        const taskTags: string[] = t.tags || []
        if (taskTags.includes(oldName)) {
          const newTags = taskTags.map((x: string) => x === oldName ? newName : x)
          await this.supabase.from('tasks').update({ tags: newTags })
            .eq('id', t.id).eq('user_id', this.userId)
        }
      }
    }
  }

  // ── Plan Mode ──────────────────────────────────────────────────

  async startPlan(windowStart: string, windowEnd: string): Promise<void> {
    // Save the current timeline so we can restore it when plan ends
    const currentTimeline = await this.getTimelineId()
    await this.setMeta('pre_plan_timeline_id', currentTimeline)

    const mainId = await this.getMainTimelineId()
    const now = new Date().toISOString()

    // Create all 4 lane branches in parallel
    const branchInserts = []
    const branchIds: string[] = []
    for (let i = 1; i <= 4; i++) {
      const branchId = crypto.randomUUID()
      branchIds.push(branchId)
      branchInserts.push({
        id: branchId, user_id: this.userId,
        name: laneBranchName(i), parent_id: mainId, created: now,
      })
    }
    const { error: branchError } = await this.supabase.from('timelines').insert(branchInserts)
    if (branchError) throw new Error(`Failed to create plan branches: ${branchError.message}`)

    // Snapshot main tasks into lane 1, set meta — in parallel
    const [tasksResult] = await Promise.all([
      this.supabase.from('tasks').select('*')
        .eq('user_id', this.userId).eq('timeline_id', mainId)
        .not('anchor', 'is', null).gte('anchor', windowStart).lte('anchor', windowEnd),
      this.setMeta('plan_mode', 'true'),
      this.setMeta('plan_window_start', windowStart),
      this.setMeta('plan_window_end', windowEnd),
    ])

    if (tasksResult.data && tasksResult.data.length > 0) {
      const inserts = tasksResult.data.map((t: Record<string, unknown>) => ({
        id: crypto.randomUUID(), user_id: this.userId, timeline_id: branchIds[0],
        name: t.name, mass: t.mass, anchor: t.anchor, solidity: t.solidity,
        energy: t.energy, fixed: t.fixed, alive: t.alive, tags: t.tags,
        created: t.created, cloud_x: t.cloud_x, cloud_y: t.cloud_y, river_y: t.river_y,
      }))
      const { error: snapshotError } = await this.supabase.from('tasks').insert(inserts)
      if (snapshotError) throw new Error(`Failed to snapshot tasks to lane 1: ${snapshotError.message}`)
    }
  }

  async endPlan(): Promise<void> { await this.cleanupPlan() }

  async commitLane(lane: number): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const mainId = await this.getMainTimelineId()
    const [wsResult, weResult] = await Promise.all([
      this.getMeta('plan_window_start'),
      this.getMeta('plan_window_end'),
    ])
    if (!wsResult || !weResult) throw new Error('Plan window not defined')

    const { error: delError } = await this.supabase.from('tasks').delete()
      .eq('user_id', this.userId).eq('timeline_id', mainId)
      .not('anchor', 'is', null).gte('anchor', wsResult).lte('anchor', weResult)
    if (delError) throw new Error(`Failed to clear main tasks for commit: ${delError.message}`)

    const { error: moveError } = await this.supabase.from('tasks').update({ timeline_id: mainId })
      .eq('user_id', this.userId).eq('timeline_id', branchId)
    if (moveError) throw new Error(`Failed to commit lane tasks to main: ${moveError.message}`)

    await this.cleanupPlan()
  }

  async getPlanState(): Promise<PlanState> {
    const [active, windowStart, windowEnd] = await Promise.all([
      this.getMeta('plan_mode'),
      this.getMeta('plan_window_start'),
      this.getMeta('plan_window_end'),
    ])
    if (active !== 'true')
      return { active: false, window_start: null, window_end: null, lanes: [] }

    const lanes: PlanLaneInfo[] = []
    const laneQueries = []
    for (let i = 1; i <= 4; i++) {
      laneQueries.push(
        this.supabase.from('timelines').select('id')
          .eq('user_id', this.userId).eq('name', laneBranchName(i)).maybeSingle()
      )
    }
    const laneResults = await Promise.all(laneQueries)

    const countQueries = laneResults.map((r, i) => {
      if (!r.data) return Promise.resolve(null)
      return Promise.all([
        this.supabase.from('tasks').select('*', { count: 'exact', head: true })
          .eq('user_id', this.userId).eq('timeline_id', r.data.id),
        this.getMeta(`plan_lane_${i + 1}_label`),
      ])
    })
    const countResults = await Promise.all(countQueries)

    for (let i = 0; i < 4; i++) {
      if (laneResults[i].data && countResults[i]) {
        const [countRes, label] = countResults[i]!
        lanes.push({
          number: i + 1, label, taskCount: countRes.count ?? 0,
          branchName: laneBranchName(i + 1), readonly: false,
        })
      }
    }

    return { active: true, window_start: windowStart, window_end: windowEnd, lanes }
  }

  async getLaneTasks(lane: number): Promise<{ river: TaskWithPosition[]; cloud: TaskWithPosition[] }> {
    const branchId = await this.getLaneBranchId(lane).catch(() => null)
    if (!branchId) return { river: [], cloud: [] }

    const [riverResult, cloudResult] = await Promise.all([
      this.supabase.from('tasks').select('*')
        .eq('user_id', this.userId).eq('timeline_id', branchId)
        .not('anchor', 'is', null).order('anchor', { ascending: true }),
      this.supabase.from('tasks').select('*')
        .eq('user_id', this.userId).eq('timeline_id', branchId).is('anchor', null),
    ])

    return {
      river: (riverResult.data ?? []).map((r: Record<string, unknown>) => taskWithPosition(rowToTask(r))),
      cloud: (cloudResult.data ?? []).map((r: Record<string, unknown>) => taskWithPosition(rowToTask(r))),
    }
  }

  // ── Lane manipulation ──────────────────────────────────────────

  async putTaskInLane(lane: number, name: string, position: number | null): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(), user_id: this.userId, timeline_id: branchId,
      name, mass: DEFAULT_MASS, anchor: position != null ? positionToAnchor(position) : null,
      solidity: DEFAULT_SOLIDITY, energy: 0.5, fixed: false, alive: false,
      tags: [], created: new Date().toISOString(),
    })
  }

  async updateTaskInLane(lane: number, taskId: string, updates: { mass?: number; solidity?: number; energy?: number; position?: number }): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const patch: Record<string, unknown> = {}
    if (updates.mass !== undefined) patch.mass = updates.mass
    if (updates.solidity !== undefined) patch.solidity = updates.solidity
    if (updates.energy !== undefined) patch.energy = updates.energy
    if (updates.position !== undefined) patch.anchor = positionToAnchor(updates.position)
    if (Object.keys(patch).length === 0) return
    await this.supabase.from('tasks').update(patch)
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', branchId)
  }

  async removeFromLane(lane: number, taskId: string): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    await this.supabase.from('tasks').delete()
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', branchId)
  }

  async repositionInLane(lane: number, taskId: string, position: number): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    await this.supabase.from('tasks').update({ anchor: positionToAnchor(position) })
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', branchId)
  }

  async laneToCloud(lane: number, taskId: string): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const { data: source } = await this.supabase.from('tasks').select('*')
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', branchId).single()
    if (!source) throw new Error(`Task ${taskId} not found in lane ${lane}`)

    const mainId = await this.getMainTimelineId()
    // Sequential: insert first so we don't lose the task if delete succeeds but insert fails
    const { error: insertError } = await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(), user_id: this.userId, timeline_id: mainId,
      name: source.name, mass: source.mass, anchor: null,
      solidity: source.solidity, energy: source.energy, fixed: source.fixed,
      alive: source.alive, tags: source.tags, created: source.created,
    })
    if (insertError) throw new Error(`Failed to move task to cloud: ${insertError.message}`)
    await this.supabase.from('tasks').delete()
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', branchId)
  }

  async addToLane(lane: number, taskId: string, position: number | null, copy: boolean): Promise<void> {
    const branchId = await this.getLaneBranchId(lane)
    const mainId = await this.getMainTimelineId()

    let source: Record<string, unknown> | null = null
    let sourceTimeline = mainId

    const { data: mainTask } = await this.supabase.from('tasks').select('*')
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', mainId).maybeSingle()

    if (mainTask) { source = mainTask } else {
      for (let i = 1; i <= 4; i++) {
        const bid = await this.getLaneBranchId(i).catch(() => null)
        if (!bid) continue
        const { data } = await this.supabase.from('tasks').select('*')
          .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', bid).maybeSingle()
        if (data) { source = data; sourceTimeline = bid; break }
      }
    }
    if (!source) throw new Error(`Task ${taskId} not found`)

    const anchor = position != null ? positionToAnchor(position) : (source.anchor as string | null)

    // Sequential: insert first so we don't lose the task if delete succeeds but insert fails
    const { error: insertError } = await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(), user_id: this.userId, timeline_id: branchId,
      name: source.name, mass: source.mass, anchor,
      solidity: source.solidity, energy: source.energy, fixed: source.fixed,
      alive: source.alive, tags: source.tags, created: source.created,
    })
    if (insertError) throw new Error(`Failed to add task to lane: ${insertError.message}`)

    if (!copy) {
      await this.supabase.from('tasks').delete()
        .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', sourceTimeline)
    }
  }

  async moveBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): Promise<void> {
    const [fromBranchId, toBranchId] = await Promise.all([
      this.getLaneBranchId(fromLane), this.getLaneBranchId(toLane),
    ])
    const { data: source } = await this.supabase.from('tasks').select('*')
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', fromBranchId).single()
    if (!source) throw new Error(`Task ${taskId} not found in lane ${fromLane}`)

    // Sequential: insert first so we don't lose the task if delete succeeds but insert fails
    const { error: insertError } = await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(), user_id: this.userId, timeline_id: toBranchId,
      name: source.name, mass: source.mass, anchor: positionToAnchor(position),
      solidity: source.solidity, energy: source.energy, fixed: source.fixed,
      alive: source.alive, tags: source.tags, created: source.created,
    })
    if (insertError) throw new Error(`Failed to move task between lanes: ${insertError.message}`)
    await this.supabase.from('tasks').delete()
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', fromBranchId)
  }

  async copyBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): Promise<void> {
    const [fromBranchId, toBranchId] = await Promise.all([
      this.getLaneBranchId(fromLane), this.getLaneBranchId(toLane),
    ])
    const { data: source } = await this.supabase.from('tasks').select('*')
      .eq('id', taskId).eq('user_id', this.userId).eq('timeline_id', fromBranchId).single()
    if (!source) throw new Error(`Task ${taskId} not found in lane ${fromLane}`)

    await this.supabase.from('tasks').insert({
      id: crypto.randomUUID(), user_id: this.userId, timeline_id: toBranchId,
      name: source.name, mass: source.mass, anchor: positionToAnchor(position),
      solidity: source.solidity, energy: source.energy, fixed: source.fixed,
      alive: source.alive, tags: source.tags, created: source.created,
    })
  }

  // ── Private helpers ────────────────────────────────────────────

  private async getLaneBranchId(lane: number): Promise<string> {
    const { data } = await this.supabase.from('timelines').select('id')
      .eq('user_id', this.userId).eq('name', laneBranchName(lane)).single()
    if (!data) throw new Error(`Lane ${lane} branch not found`)
    return data.id
  }

  private async cleanupPlan(): Promise<void> {
    // Get all lane branches in one query
    const { data: branches } = await this.supabase.from('timelines').select('id, name')
      .eq('user_id', this.userId).like('name', `${LANE_PREFIX}%`)

    if (branches && branches.length > 0) {
      const branchIds = branches.map(b => b.id)
      // Delete tasks from lane branches
      await this.supabase.from('tasks').delete()
        .eq('user_id', this.userId).in('timeline_id', branchIds)
      await this.supabase.from('timelines').delete()
        .eq('user_id', this.userId).in('id', branchIds)
    }

    // Restore the pre-plan timeline (or fall back to main)
    const prePlanTimelineId = await this.getMeta('pre_plan_timeline_id')
    const restoreId = prePlanTimelineId ?? await this.getMainTimelineId()

    // Clean up meta in parallel
    await Promise.all([
      this.deleteMeta('plan_mode'),
      this.deleteMeta('plan_window_start'),
      this.deleteMeta('plan_window_end'),
      this.deleteMeta('plan_lane_1_label'),
      this.deleteMeta('plan_lane_2_label'),
      this.deleteMeta('plan_lane_3_label'),
      this.deleteMeta('plan_lane_4_label'),
      this.deleteMeta('pre_plan_timeline_id'),
    ])

    await this.setMeta('current_timeline_id', restoreId)
    this._timelineId = restoreId
  }
}
