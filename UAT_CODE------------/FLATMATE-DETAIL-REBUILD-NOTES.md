# Flatmate listing detail page — rebuilt to match PG/Hostel exactly

## What's in this zip
```
views/flatmate/listing-detail.ejs   (complete rewrite — this file only)
```
No route/model changes needed — the route already provides every variable this page uses
(that was verified working before this rebuild); this was a visual/template-only rebuild.

## 1. Existing PG/Hostel UI analyzed
`views/listings/hostel-view.ejs` and `public/css/hostel-view1.css` — read the actual CSS
values directly (not approximated) for: `.hv-container` (max-width 1280px, `1fr 360px`
grid), `.hv-section`/`.hv-h2` (the green left-bar heading), `.amenities-grid`/`.amenity-item`/
`.amenity-icon` (boxed icon + label, not inline pills), `.booking-card`/`.bc-*`, `.host-card`/
`.host-*`, `.progress-nav`/`.pnav-link` (sticky tab bar), `.map-address-row`/`.map-frame-wrap`,
`.title-tags`/`.htag`/`.hv-title`.

## 2. Flatmate files modified
Only `views/flatmate/listing-detail.ejs`.

## 3. UI changes — the actual approach
Rather than approximate the PG page's look with new classes, this page now **links
`/css/hostel-view1.css` directly** and reuses its real class names throughout — same
`.hv-container`, `.hv-section`, `.hv-h2`, `.amenities-grid`/`.amenity-item`/`.amenity-icon`,
`.booking-card`, `.host-card`, `.progress-nav`. That's genuine pixel parity, not a
lookalike — the exact same CSS rules render both pages.

New Flatmate-only additions (things that don't exist on the PG page at all: nearby-places
explorer, route panel, the accept-gated contact box) are prefixed `.fm-*` so nothing here
can collide with or alter PG/Hostel styling.

**One deliberate adaptation**: the gallery isn't a copy of PG's fixed main+4-thumbnail grid
— Flatmate listings have a variable image count (1 to many), so it's a swipeable
slide+dots gallery instead, using the *same* band background, height (420px/280px mobile),
and border-radius as PG's gallery-section for visual consistency, adapted rather than
force-fit.

Sticky tab nav (Overview/Details/Amenities/Preferences/Location) now has real scroll-spy
via `IntersectionObserver`, matching the always-active-tab behavior a PG page implies.

## 4. Request system
Sidebar `booking-card` shows the same 5 states as before (unchanged logic — I only moved
markup into the new structure): **Send Request** (green, matches PG's `Contact Owner`
styling/weight) → **Request Sent** (pending, disabled, with Cancel Request) → **Chat Now**
(links to the real conversation) → **My Listing** (owner) → **No longer available**
(closed). All server-driven, none of it client-guessed.

## 5. Map
Unchanged logic from the prior phase — precise pin once a listing has one (public to
everyone, not gated), city-level approximate fallback for unpinned listings, "Nearby, at a
glance" auto-populated highlights (zero clicks), 10-category explorer, and a driving/
walking/transit route panel. Now visually sits inside the real `.map-frame-wrap` PG uses.
Google APIs: Maps JavaScript API (map), Places API (New) (nearby), Routes API (route),
Geocoding API (reverse-geocode in the create wizard) — all already configured via your
`GOOGLE_MAPS_API_KEY`/`GOOGLE_MAPS_SERVER_KEY`.

## 6. Saved Properties
Unchanged — real backend toggle via `/student/saved/toggle`, correct initial heart state
computed server-side, now styled as `.fm-gallery-save` sitting on the gallery (matching
where PG's `.bc-wish` heart sits conceptually, adapted to the gallery corner since Flatmate's
sidebar leads with price/CTA, not a wishlist heart).

## 7. Recently Viewed
Unchanged — tracked server-side in the route (not touched this round), capped at 5, shared
with PG/Hostel through one system.

## 8. WhatsApp
Unchanged — request-sent and request-accepted notifications via the existing
`utils/leadWhatsapp.js`, still pending your two Meta template approvals from earlier.

## 9. Create Listing
Not touched this round (already has verified-phone lock, map-pin picker, amenity icons from
earlier phases) — this delivery was scoped to the detail page only, per your request.

## 10. "Preferred area" validation bug
Already fixed in an earlier phase (root-cause fix to the edit-mode hydration gap) — not
touched or affected by this rebuild.

## 11. Responsive testing
Checked the CSS cascade at the breakpoints `hv-container`/`.progress-nav` actually define:
desktop (2-column grid), and the ≤640px gallery-height collapse (420px → 280px) matching how
PG's own responsive rules behave — inherited directly since this page now uses PG's real
media queries rather than separate ones.

## 12. Regression testing
`node --check` on the one route file this touches (unchanged, still passes) and EJS-compile
on the rewritten template — both clean. **Found and fixed a real pre-existing crash bug in
the process** (see below) that predates this rebuild.

## 13. Environment variables
None new.

## 14. Manual setup
None new beyond what's already outstanding (Google Maps key, WhatsApp template approval).

---

## A pre-existing bug I found and fixed along the way
The "listing not found" page (invalid/removed listing link) has **always crashed** — I
verified this against your original file before I touched anything: the inline `<script>`
block referenced `listing.slug` with no null-guard, so visiting a broken Flatmate link threw
a server error instead of showing the "Listing not found" message. Fixed by wrapping that
whole script block in the same `<% if (listing) %>` guard the rest of the page already uses.
Verified: the not-found page now renders cleanly, and a real listing still renders the full
page with all its JS intact.

## How I verified this
Rendered the page across 4 real scenarios: a fully-populated HAVE_FLAT listing (confirmed
every reused PG class name is actually present: `hv-container`, `hv-section`/`hv-h2`,
`amenities-grid`/`amenity-item`/`amenity-icon`, `booking-card`, `host-card`, `progress-nav`,
`map-frame-wrap`, and that nearby-highlights auto-render from cache), the "connected" state
(confirmed Chat Now links to the real conversation and contact info correctly unlocks), a
NEED_FLAT listing (confirmed amenities/location sections are correctly absent), and the
not-found state (confirmed it no longer crashes). Also traced through and fixed 3 rounds of
class-name mismatches between the rewritten markup and the preserved JS (gallery slide
function didn't exist yet under its new name, several `nearby-*`/`route-*` class references
in dynamically-built HTML strings still pointed at the old unprefixed names) — each caught
by grep-checking the actual JS against the actual new markup, not assumed correct.
