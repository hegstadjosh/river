# River Overhaul

## What This Is
River is a physics-based spatial task scheduling app (~7,000 LOC). MCP server + Next.js web app + vanilla Canvas viewer. Deployed at taskriver.dev on Vercel with Supabase backend.

## The Problem
The app has critical bugs AND deep architectural issues. A user filed a bug report at `/Users/josh/Library/Messages/Attachments/78/08/216758CC-1D32-47B0-9CC3-33D5E462C8B7/river-mcp-bug-report.md` — the MCP SSE endpoint never sends events. Mobile is completely broken — you cannot drag tasks at all. But beyond those two show-stoppers, the entire codebase needs a thorough review. The owner believes the architecture is fundamentally unsound.

## Your Job
1. **Full code review.** Read every file. Find every bug, architectural flaw, dead code path, security issue, missing error handling, fragile pattern, untested assumption. Don't stop at the obvious — dig.

2. **Write a plan.** After your review, update PROGRESS.md with what you found and how you'll fix it, ordered by severity.

3. **Fix everything.** Spawn teammates as needed. Each teammate owns distinct files. Commit after every meaningful unit of work.

4. **Test.** Run `pnpm build` in `web/` to verify nothing breaks. If you can, verify MCP transport works. Test mobile layout in a browser.

5. **Iterate.** After fixing, re-review. If you find more issues, fix those too. The bar is: would this survive a senior engineer's code review at a top-tier company?

## Known Starting Points (not exhaustive — find more)
- MCP SSE endpoint is dead (mcp-handler requires Redis for SSE, no Redis configured)
- Mobile touch handlers cannot drag tasks (touchstart never fires mousedown)
- The viewer is 10 loose .js files mutating `window.River` with no module system
- Mobile overrides work by monkey-patching functions at runtime
- Tests test the SQLite backend but production uses Supabase — zero coverage of deployed code
- `river-bundle.js` (178KB) sits alongside the individual .js files — unclear if used or dead
- `river-clouds.js` exists but isn't loaded in `index.html`

## Emotional Design Constraints (DO NOT VIOLATE)
- NO red, NO "overdue", NO counts of tasks, NO streaks
- NO productivity language ("productive", "efficient", "optimize")  
- Warm palette only: earth tones, watercolors, amber, muted
- Commitment is a 0-1 gradient (solidity), never binary
- Tasks that drift past "now" recirculate silently — no shame

## Termination
When you are confident this codebase would pass a rigorous code review — clean architecture, no dead code, all features working, proper error handling, mobile functional — update PROGRESS.md with final status and stop.
