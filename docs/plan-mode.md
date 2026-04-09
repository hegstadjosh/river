# River — Plan Mode

*Design doc for the planning canvas, palette gesture, and duration axis.*

---

## Duration as Horizontal Span

Tasks have a visible time footprint. A 90-minute task occupies 90 minutes of river space — it stretches horizontally. You can *see* how much of your afternoon the OS pset eats, and you can *see* the breathing room between tasks as literal open water.

**Width:** `duration_minutes * PIXELS_PER_HOUR / 60`  
**Height:** organic, solidity-based (same as current blobs)  
**Shape:** horizontal ellipse, not a stretched circle. Still organic — offset gradients, soft edges.

**Preset durations:** `10 · 30 · 90 · 180` minutes. Default 30. Displayed as four tappable buttons in the detail panel — not a slider. Tap and the blob reshapes live.

The `mass` property already stores this. No data model change needed. Just rendering and panel UI.

---

## Plan Mode

### Entering

You say "help me plan my afternoon" or "figure out this week." Claude sets a timeframe and opens plan mode.

The viewer transforms: the river zone splits into **5 horizontal swim lanes**, stacked vertically, sharing the same time axis. The cloud stays above.

### Claude Fills Three

Claude asks clarifying questions first:
- "What are you trying to figure out?"
- "Anything you're considering that isn't in your cloud?"
- "Hard constraints — things that can't move?"

Then Claude populates the top 3 lanes with genuinely different arrangements. Not random shuffles — different *philosophies*:

- **Lane 1:** "The focused block" — group deep work together, breaks between
- **Lane 2:** "The spacious day" — everything spread wide, lots of breathing room
- **Lane 3:** "Front-loaded" — knock out hard stuff early, coast in the afternoon

Each lane is a complete, coherent timeline for the window. Claude names them.

### Two Lanes Stay Empty

Lanes 4 and 5 are blank. The user can build in them, clone into them, or ignore them. No pressure.

### The Cloud in Plan Mode

By default, plan mode inherits the current cloud — all your floating thoughts are available as raw material. But Claude can curate it for this session:
- Pull in tasks that aren't in the cloud yet ("you mentioned wanting to call your advisor")
- Filter out stuff irrelevant to this timeframe
- Suggest things the user hasn't thought of

The cloud is the **palette** — the set of things you're working with. Lanes are the **canvases** — where you arrange them.

---

## The Palette Gesture

A zone in the cloud — maybe the top edge, or a distinct strip with a subtle visual treatment (slightly different warmth, a faint border) — acts as a **paint palette**.

**The motion:** Grab a blob. Drag it through the palette zone. A clone drops into the main cloud. The blob you're holding stays on your cursor. Place it in a lane (or anywhere).

This is "picking up paint." You dip into a task to stamp copies wherever you need them. A task can appear in multiple lanes because you're exploring — it's not committed to any of them yet.

**Visual feedback:**
- Entering the palette zone: blob gets a subtle duplicate shadow
- Exiting: the clone fades in where you crossed, the original stays with your cursor
- The clone in the cloud is slightly translucent until you drop the original

---

## Interaction in Plan Mode

### Moving Between Lanes

- Drag a task from one lane to another → it moves (not copies)
- Drag through the palette zone first → it copies (original stays)
- Drag left/right within a lane → changes time position
- Drag to cloud → removes from lane, returns to palette

### Talking

The primary interaction is still conversation:
- "Lane 1 is good but push the pset earlier"
- "Take the morning from lane 3 and the afternoon from lane 1"
- "Make lane 2 chiller — bigger gaps, lower commitment"
- "Add a gym session to lane 4 around 3pm"

Claude edits lanes in-place. The user watches the blobs shift.

### Committing

When something feels right:
- "Go with lane 1"
- "Combine lanes 1 and 3 like we discussed"
- "This is good, let's do it"

Claude commits the chosen arrangement to the main river. Plan mode closes. The swim lanes collapse back to a single river with the chosen timeline. Unchosen lanes dissolve upward.

---

## MCP Changes

### New tool: `plan`

```
plan({ action: "start", timeframe: "6h" | "day" | "3d" | ... })
plan({ action: "fill", lane: 1, tasks: [...] })
plan({ action: "name", lane: 1, label: "The focused block" })
plan({ action: "commit", lane: 2 })
plan({ action: "end" })
```

Or this could be an extension of `branch` — each lane is a branch, commit merges it into main.

### Tool description updates

When plan mode is active, Claude's tool descriptions should include guidance:
- Ask clarifying questions before generating alternatives
- Generate genuinely different approaches, not permutations
- Name each lane with its philosophy
- Don't assume the user has all their tasks populated — suggest things

This can be a resource that Claude reads when plan mode starts, containing the conversation design rules from the main spec plus plan-mode-specific behavior.

---

## Visual Treatment

### Lane Rendering

Each lane is a narrow river with its own:
- Flow streaks (slower, subtler than main river)
- Warm background
- Now-line (shared across all lanes, single vertical)
- Time markers (shared, drawn once at the bottom)

Lanes are separated by thin, warm horizontal lines — not hard borders. More like sediment layers.

The active lane (being edited or hovered) is slightly brighter. Others dim to ~80%.

### Lane Labels

Small text at the left edge of each lane. Claude's name for the philosophy. Faint, doesn't compete with blobs.

### Duration Rendering

Blobs stretch horizontally:
- 10min → narrow pill
- 30min → standard blob (current size, roughly circular)
- 90min → wide ellipse
- 180min → long, spanning shape

The organic quality (offset gradients, soft edges) is preserved — they're not rectangles. They're cells that grew wider.

---

## What This Enables

Plan mode + duration axis + palette gesture turns River from a "spatial todo list" into a **thinking tool**. You're not scheduling — you're exploring possible futures spatially. 

The three auto-generated lanes mean you never start from a blank canvas. Claude gives you options that are genuinely different — not the options you would have generated yourself. Then you remix, iterate, talk, and commit.

The palette gesture makes the cloud a workspace, not a dumping ground. Tasks are raw materials. Lanes are experiments. Committing is the only permanent action.

This is what "branching for personal scheduling" actually looks like when it's designed for humans instead of git users.
