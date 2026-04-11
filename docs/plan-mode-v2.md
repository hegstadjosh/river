# Plan Mode v2 — Window-Locked Planning

## What It Is

Plan mode lets you explore alternative arrangements for a specific slice of time. You lock a window, see your current plan in lane 1, fill lanes 2-4 with alternatives (manually or via Claude), and commit one — overwriting only that window.

## How It Works

### Entering Plan Mode

1. Navigate to the view you want to plan — zoom to the right timeframe, scroll to the right position
2. Click "Plan" (top-right button)
3. The current visible time range becomes the **plan window** — locked as an absolute time range (e.g., April 10 09:00 – April 11 09:00)
4. Five swim lanes appear below the surface

No timeframe picker. What you see is what you plan.

### The Plan Window

- Defined by the left and right edges of the visible area at the moment you click "Plan"
- Stored as absolute timestamps (start, end) — not relative to "now"
- Visualized as a subtle warm outline on the river, always visible regardless of scroll/zoom
- Tasks whose **center** falls within the window are "in scope"

### The 5 Lanes

| Lane | Purpose | Editable? |
|------|---------|-----------|
| 1 | Snapshot of current river tasks in the window | Read-only |
| 2 | Alternative arrangement | Yes |
| 3 | Alternative arrangement | Yes |
| 4 | Alternative arrangement | Yes |
| 5 | Empty — user's scratch lane | Yes |

**Lane 1** is auto-populated from the main river on plan start. It shows exactly what's currently scheduled in the plan window. It cannot be modified — it's your "before" reference.

**Lanes 2-4** start empty. Claude fills 3 by default via MCP, or the user fills them manually (double-click, drag from cloud).

**Lane 5** starts empty for the user to build their own arrangement.

### While in Plan Mode

- **Scrolling and zooming work normally** — the river scrolls, the horizon bar works, the dwell switcher works
- **The plan window outline stays visible** as you scroll — a warm border marking the planned time range on the river
- **Lanes are anchored to the plan window** — they always show the locked time range, independent of scroll position
- **Cloud tasks are visible and draggable** — drag into any editable lane (2-5)
- **Wizard bar works** for cloud→lane drags
- **Double-click in a lane** creates a task there
- **Drag between lanes** to move/copy tasks
- **Drag lane task above surface** to remove it from the lane

### Committing ("Use This")

Clicking "Use this" on a lane:

1. Identifies all main river tasks whose centers fall within the plan window
2. **Removes** those tasks from the main river
3. **Inserts** the committed lane's tasks into the main river
4. Exits plan mode

Tasks **outside** the plan window are completely untouched. The commit only affects the planned slice.

### Exiting Without Committing

Click "exit plan" (the plan button) or press Escape. All lanes are discarded. Main river is unchanged.

### Claude MCP Integration

When Claude uses the `plan` tool:

- `start` no longer takes a timeframe — the viewer sends the locked window's start/end timestamps
- `fill` populates lanes 2-4 with alternative arrangements
- `name` labels each lane with its philosophy
- `status` returns the plan window range, lane contents, labels
- `commit` does the same window-scoped merge as the viewer's "Use this"
- Claude should NOT modify lane 1 (the tool should reject fill for lane 1)

Claude's guidance (in tool description): look at lane 1 to understand what's currently planned, then generate genuinely different arrangements in lanes 2-4.

## Visual Design

### Plan Window Outline

- Subtle warm border (rgba(200, 165, 110, 0.25)) marking the time range on the river
- Visible at all zoom levels — scales with the river
- Slightly brighter when the viewport is centered on the plan window
- No fill — just the outline, so the river is still visible through it

### Lane Rendering

- Same as current: horizontal swim lanes below the surface
- Lane 1 has a subtle "locked" indicator (dimmer, no handles on tasks)
- Editable lanes (2-5) have commit buttons ("Use this")
- Lane labels on the left side

## Data Model Changes

### Plan State (server)

```
plan_mode: true/false
plan_window_start: ISO timestamp (absolute)
plan_window_end: ISO timestamp (absolute)
```

Replaces the current `plan_timeframe` field. The window is absolute, not a named timeframe.

### startPlan

Input: `{ window_start, window_end }` (timestamps)

1. Create 5 lane timelines
2. Lane 1: copy tasks from main whose anchor falls within [window_start, window_end]
3. Lanes 2-5: empty

### commitLane

1. Delete main tasks whose anchor falls within [window_start, window_end]
2. Insert committed lane's tasks into main
3. Clean up all lanes, exit plan mode

### MCP Tool Changes

- `plan start` — receives window start/end from viewer (or Claude specifies manually)
- `plan fill` — rejects lane 1
- `plan commit` — window-scoped merge
- `plan status` — includes window_start, window_end in response

## Edge Cases

- **Task straddles window boundary**: center determines membership. If center is inside, it's part of the plan.
- **User scrolls far away during plan**: outline still visible as a thin marker. Lanes still show the planned window.
- **Window includes past time**: allowed. You might want to rearrange the rest of today starting from 2 hours ago.
- **Empty lane committed**: clears all tasks in the window. Intentional — "I want nothing scheduled here."
- **Cloud tasks**: not affected by commit. They have no position, so they're not "in" any window.
