# Viewer Interactions

## Click Task

Opens a detail panel anchored near the task. The panel contains:

- **Name** -- editable text field (auto-saves after 300ms)
- **Duration presets** -- buttons that change with the active timeframe (e.g. 10m/30m/90m/3h at day scale, 1w/2w/3w/4w at month scale)
- **Duration input** -- free-text field accepting `2h 30m`, `1.5d`, `3w`, etc.
- **Commitment slider** -- 0-100% (maps to solidity/opacity)
- **Energy slider** -- 0-100% (maps to color: blue=chill, gold=focus, red=deep)
- **Start / End times** -- editable compact times with calendar picker icons (river tasks only). Changing start moves the task; changing end adjusts duration.
- **Tags** -- a row of colored dot checkboxes, one per known tag. Click a dot to toggle that tag on the task; the dot fills with the tag's color when active.
- **Back to cloud** -- checkbox, checked by default. When checked, the task recirculates back to the cloud silently after its time passes. Uncheck to hold the task in place past "now" (replaces the old "Pinned" checkbox).
- **Dissolve** -- deletes the task

Click empty space to dismiss the panel.

## Multi-Select

Shift-click a task to add it to the selection; shift-click again to remove it. Selected tasks render with a dashed outline.

- **Group drag**: dragging any selected task drags the whole group. Each task's offset from the drag target is preserved, so the relative arrangement doesn't collapse.
- **Group resize**: resizing via a handle applies an additive delta computed from the handle task's starting value to each selected task, so tasks don't snap to the same duration/commitment/energy -- they shift by the same amount from where they started.
- **Panel**: with more than one task selected, the detail panel header shows "N tasks". Edits (name, duration, sliders, tags, back-to-cloud) apply to every task in the selection.

Click empty space to clear the selection.

## Tag Bar

A horizontal strip in the top-left of the canvas. Each tag is a small rounded swatch filled with its color, with a tiny label underneath.

- **Click a swatch** to hide or show all tasks carrying that tag. Hidden swatches dim.
- **Double-click a label** to rename the tag inline. Pressing Enter commits; Escape cancels.
- **+ button** on the right opens an inline popup to create a new tag (name + auto-assigned color).
- **"all" toggle** on the far left shows or hides every tag at once.

The tag list persists across sessions -- tags you've ever created stay in the bar even when no task currently uses them.

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

Click the **Plan** button in the horizon bar to enter plan mode. This locks the currently visible time window as the plan window -- you can still scroll the view, but plan operations only affect tasks whose anchors fall inside that window. Press **Escape** to exit.

When plan mode activates:

- The river zone splits into **5 horizontal swim lanes**.
- **Lane 1** auto-populates with a snapshot of the current river tasks whose anchors fall in the window. These are fully editable -- drag, resize, retag, rename -- without touching the main river until you commit.
- **Lanes 2-5** start empty as blank canvases for alternate arrangements.
- **Red vertical lines** mark the locked window's start and end. They stay pinned to those absolute times, so as you scroll the window visibly slides across the view.

Interactions inside plan mode:

- **Drag cloud task into a lane** -- schedules it in that lane at the drop position
- **Drag between lanes** -- moves the task to the target lane
- **Palette zone** (top strip of cloud): drag a task through this zone before dropping into a lane to **copy** it -- the original stays, a copy is placed
- **Drag lane task to cloud** -- removes it from the lane
- **Commit button** per lane -- replaces the main river's tasks **within the plan window only** with that lane's contents. Tasks outside the window are untouched.
- **Click plan task** -- opens the same detail panel
