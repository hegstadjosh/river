# Viewer Interactions

## Click Task

Opens a detail panel anchored near the task. The panel contains:

- **Name** -- editable text field (auto-saves after 300ms)
- **Duration presets** -- buttons that change with the active timeframe (e.g. 10m/30m/90m/3h at day scale, 1w/2w/3w/4w at month scale)
- **Duration input** -- free-text field accepting `2h 30m`, `1.5d`, `3w`, etc.
- **Commitment slider** -- 0-100% (maps to solidity/opacity)
- **Energy slider** -- 0-100% (maps to color: blue=chill, gold=focus, red=deep)
- **Start / End times** -- editable compact times with calendar picker icons (river tasks only). Changing start moves the task; changing end adjusts duration.
- **Pinned** -- checkbox that locks the task in place
- **Dissolve** -- deletes the task

Click empty space to dismiss the panel.

## Drag: Cloud to River

Dragging a cloud task downward past the surface activates the **drag wizard** -- three stages presented as a horizontal zone replacing the horizon bar. Sweep the cursor through each field in a zigzag:

1. **Duration** -- sweep right across preset buttons (matches current timeframe)
2. **Commitment** -- sweep back; zones show maybe / likely / solid / locked
3. **Energy** -- sweep right; zones show chill / easy / focus / deep (color-coded)

Cross the field boundary to advance to the next stage. The task transforms in real-time as you pass through zones. Drop below the surface to place it in the river.

## Drag: River to Cloud

Drag a river task above the surface line. On release it loses its time position and returns to the cloud.

## Drag Within River

Dragging a river task horizontally repositions it. The start edge snaps to the time grid. Start and end times display beside the task during the drag.

## Drag to Horizon Bar (Dwell Switcher)

While dragging a river task, hover over a scale button (6h, day, 4d, etc.) in the horizon bar for **250ms** to switch timeframe. The bar glows during a river drag; the hovered button highlights and a flash confirms the switch.

For the **prev/next arrows**: dwell 250ms to step one frame unit. You must move the cursor away and re-enter the arrow to trigger again.

## Resize Handles

Handles appear outside the task edges on hover (grip dot + line):

| Handle | Direction | Effect |
|--------|-----------|--------|
| Left | horizontal | Changes duration, anchors right edge |
| Right | horizontal | Changes duration, anchors left edge |
| Top | vertical (drag up) | Increases commitment |
| Bottom | vertical (drag up) | Increases energy |

Left/right handles are only available on river tasks. Top/bottom handles work on all tasks. An overlay shows the live value during resize.

## Double-Click Empty Space

Opens an inline text input. Type a name and press Enter to create a task. In the cloud zone it creates an unscheduled task; in the river zone it creates a task at that time position. Press Escape or blur to cancel.

## Scroll / Trackpad

Horizontal scroll (trackpad swipe or mouse wheel) pans the timeline. Both `deltaX` and `deltaY` are accepted -- whichever axis has more movement wins.

## Horizon Bar

A persistent bar between the cloud and river zones with:

- **Scale buttons**: 6h | day | 4d | week | month | qtr | year -- click to switch timeframe
- **Prev/Next arrows** (`<` / `>`): step the view by one frame unit
- **Frame label**: shows the current date range, e.g. "today" or "+2d Wed Apr 11"

## Plan Mode

Toggled via MCP. The river zone splits into **5 horizontal swim lanes**. Additional interactions:

- **Drag cloud task into a lane** -- schedules it in that lane at the drop position
- **Drag between lanes** -- moves the task to the target lane
- **Palette zone** (top strip of cloud): drag a task through this zone before dropping into a lane to **clone** it -- the original stays, a copy is placed
- **Drag lane task to cloud** -- removes it from the lane
- **Commit button** per lane -- commits that lane's plan to the server
- **Click plan task** -- opens the same detail panel
