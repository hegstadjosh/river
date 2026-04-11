# River — Perspective Horizons

*Future feature. The river as a perspective painting.*

---

## The Idea

The river isn't just today — it's a landscape with depth. Close foreground is the next few hours. Middle distance is this week. The horizon is your life.

Tasks have a **realm** — the timescale they belong to. A "year" task isn't a 2-hour task due in December. It's a concept that lives at the scale of a year: "learn Spanish," "get healthier," "figure out what I want to do after graduation." These are large, slow-moving shapes near the horizon.

## The Perspective Metaphor

Imagine a painting. You're standing at the near edge looking toward the horizon.

- **Foreground (6h / day):** Crisp, large, detailed. Today's tasks. You can see their texture.
- **Middle ground (week / month):** Smaller, softer, grouped. This week's obligations. Still recognizable.
- **Background (quarter / year):** Abstract shapes near the horizon line. Life-scale things. You know they're there but they don't demand attention.

When you "zoom in" to a farther timescale, you walk forward in the painting. What was background becomes foreground. Year-tasks that were abstract horizon shapes become detailed blobs you can interact with. And today's tasks? They're behind you now — not visible, not relevant at this zoom level.

## Data Model Change

Tasks get a `realm` property:

| Realm | Meaning |
|-------|---------|
| `6h` | Right now, next few hours |
| `day` | Today |
| `3d` | Next few days |
| `week` | This week |
| `month` | This month |
| `quarter` | This quarter |
| `year` | This year / life-scale |

A task's `mass` (visual size) is relative to its realm. A 2-hour task in the `day` realm is a medium blob. A "learn Spanish" task in the `year` realm might also be medium — but it represents something fundamentally different. Mass means "how much of this timescale does this occupy in your mind," not minutes.

## The Zoom Transition

Switching realms is a camera move, not a filter:
- Current realm tasks shrink and recede toward the horizon
- New realm tasks grow and come into focus in the foreground
- There's a continuous sense of depth — you're moving through the painting, not switching tabs

## Why This Matters

Traditional planning tools have no concept of timescale mixing. Your "learn Spanish" goal sits in the same list as "buy milk." River's perspective model puts them at fundamentally different distances — you can see both exist, but they don't compete for the same attention.

The horizon selector bar (6h → day → week → month → quarter → year) is the camera controls. Each click walks you forward or backward in the painting.

## For Now

v1 has a simple horizon selector that changes the zoom level (pixels per hour). This is the mechanical foundation — when `realm` gets added later, the selector becomes the camera, and the perspective painting comes alive.
