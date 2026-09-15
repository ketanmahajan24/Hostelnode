# CRITICAL FIX: Flatmate detail route was missing auth middleware entirely

## The actual root cause of "Recently Viewed doesn't work for Flatmate"
`router.get("/:slug", async (req, res) => { ... })` — the detail page route — had **no
auth middleware at all**, unlike every other route in this file (`/` and `/results` both
correctly use `optionalAuth`). Without it, `req.student` is never set by anything, for
anyone, ever, on this specific route.

## Why this is bigger than just Recently Viewed
Everywhere the detail route reads `viewerId = req.student?.id || null`, that was **always
null**, for every visitor, logged in or not. That one broken variable silently breaks
several things at once:

- **Recently Viewed** — `trackView()` never fires, since it's gated behind `if (viewerId
  && !isOwner)`. This is your reported bug.
- **Request status** — `isOwner` is always `false` and the connection lookup never runs,
  so the CTA state machine always falls through to `"connect"` ("Send Request") —
  regardless of whether a request is actually pending, accepted, or even if the viewer is
  the listing's own owner.
- **Save button state** — `buildSavedSet(viewerId, ...)` returns an empty set whenever
  `viewerId` is falsy, so the heart would never show as already-saved on page load.
- **Owner viewing their own listing** — would incorrectly see "Send Request" instead of
  "My Listing," since `isOwner` can never become `true`.

This likely explains some of the "still shows Send Request" confusion from earlier in this
project — the backend connection-matching logic itself was correct, but it never had a
chance to execute on the live detail page because the viewer was never actually identified.

## Fix
Added the same `optionalAuth` middleware that `/` and `/results` already correctly use.

## Verified
Simulated the exact `optionalAuth` middleware logic directly with a real signed JWT: before
the fix, `req.student` is `undefined` and the tracking condition never fires; after the fix,
`req.student` is correctly populated, `viewerId` resolves, and the tracking condition
evaluates truthy. Also confirmed a guest with no cookie still safely gets `null` with no
crash — this fix doesn't change guest behavior at all, only restores identification for
actual logged-in visitors. `node --check` passes.

## What to do next
Please re-test on your live site: view a Flatmate listing while logged in, then check
`/student/recently-viewed` — it should now appear. Also worth re-checking whether the
request-status button now correctly reflects pending/accepted states you'd set up earlier,
since this same fix affects that too.
