# River

A physics-based scheduling tool where time is a river, not a grid.

You talk. Claude moves things. Nothing is overdue. Nothing judges you.

---

## What it feels like

You open the viewer and see a dark, warm landscape. A river flows left to right — the future emerging from the right, the past fading into the left. A thin amber line marks *now*. Above the river, a calm sky where uncommitted thoughts float.

Tasks aren't boxes on a calendar. They're organic shapes — blobs that drift in the current. Big ones take up space. Committed ones are vivid and sharp. Maybes are barely there — wisps at the edge of perception.

Some things are rocks. Your 2pm lecture. Lunch with Sara. They don't move. The river flows around them.

---

## A day

> "I've got econ lecture at 2, OS pset due tonight, lunch with Sara at noon, and I want to maybe do laundry and hit the gym at some point."

Claude drops eight things into the river. Lecture and lunch lock in as rocks — immovable. The pset lands as a large, warm blob a few hours out, moderately committed. Laundry, gym, call mom — they float up into the cloud as wisps. No time, no pressure. Just there.

> "Give me a chill afternoon."

Everything non-fixed pushes back 1.5 hours. The rocks stay. The gaps between tasks widen. You can *see* the breathing room open up — the river gets warmer and lighter in the spaces between things.

> "OK, I'm sitting down to the pset."

The OS pset blob grows, glows, pulls to the now-line. Everything else dims. Not gone — dimmed. You can still see your day at the periphery, but the pset is the only thing in focus. Figure-ground, not tunnel vision.

> "I can't focus on anything. I have too much stuff."

Everything fades to almost nothing. The river goes quiet. One small shape remains — call mom. Twenty minutes. The easiest thing.

*"Hey. Just call your mom. Takes 2 minutes. Everything else can wait."*

The river is nearly empty. No list of 12 things staring you down. Just one gentle suggestion and a lot of open water.

---

## What's different

**Commitment is a gradient, not a switch.** A task at 0.1 solidity is a wisp — barely a thought. At 0.9 it's crystalline, sharp-edged, locked in. You can feel the difference just by looking. There's no moment where you "schedule" something and it becomes a promise you'll break.

**Nothing is overdue.** When a task drifts past now without being touched, it silently floats back up to the cloud. No red. No "rescheduled 3 times." No record of failure. It just exists, ready whenever.

**Space is visible.** The gaps between blobs glow. Free time isn't empty — it's warm. You can always *see* that you have room.

**The system never counts.** No "you have 23 tasks." No badge numbers. The spatial layout gives you a felt sense of volume without a number to judge yourself by.

**Time has depth.** Zoom from 6 hours to a year. The river stretches to the horizon. Today's tasks are right in front of you. This quarter's ambitions are shapes in the distance.

---

## How it works

River is an MCP server. Claude has five tools:

- **put** — create or update tasks (name, size, commitment, position, tags)
- **move** — reposition in time, or send back to the cloud
- **look** — see the river (what's scheduled, what's floating, how much room you have)
- **sweep** — bulk operations (push everything back, fade everything, clear the river)
- **branch** — fork your timeline, try a different arrangement, commit or discard

A Canvas viewer at localhost:7433 renders everything live. SSE keeps it in sync — when Claude rearranges your day, the viewer updates instantly.

You never touch coordinates. You say "push that to after lunch" and Claude figures out the numbers.

---

## The philosophy

Traditional scheduling tools treat commitment as binary. A task is either scheduled or it's not. You either did it or you didn't. This creates an adversarial relationship — the tool becomes a ledger of broken promises.

River replaces the ledger with a landscape. Commitment is continuous. Everything is reversible. The vocabulary is spatial and natural: *flow, drift, float, settle, clear, open.* 

The real product isn't the viewer or the tools. It's the conversation — Claude as a calm friend who holds your schedule so you don't have to, and shapes the river in response to how you're feeling.

If that conversation works, River works.
