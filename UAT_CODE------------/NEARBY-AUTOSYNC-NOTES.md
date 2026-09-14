# Nearby Places — now auto-synced, zero clicks required

## The real bug this fix uncovered
While building this, I found that the map-pin picker was **cosmetic only** — the search
box and draggable marker worked in the browser, but `buildListingFieldsFromBody()` never
actually read the submitted `lat`/`lng`/`placeId` into the saved listing. That's the real
reason your "4 BHK, Nerul" listing showed "doesn't have a pinned location yet" — the pin
picker was never wired to persist anything. **Fixed.**

## What's in this zip
```
models/FlatmateListing.js         (added nearbyCache + nearbyCacheAt fields)
utils/googleMaps.js               (added computeNearbyCache — one-time, 10 calls)
routes/flatmateRoutes.js          (the actual coordinate-saving fix + auto-cache trigger)
views/flatmate/listing-detail.ejs (auto-shown "Nearby, at a glance" strip)
```

## How it works now
1. **Coordinate saving is fixed** — the create wizard's pin (search box or dragged marker)
   now actually gets validated (lat/lng range-checked, rejecting garbage input) and saved
   to the listing.
2. **The moment a listing is published with a valid pin**, the server automatically calls
   Places API once per category (10 calls total, one-time) and caches just the single
   closest result per category directly on the listing document.
3. **Every viewer sees "Nearby, at a glance" immediately** — a row of chips (🚇 Metro ·
   Nerul Station · 850m away, etc.) with zero clicks, computed once and served from the
   database from then on.
4. **Clicking a highlight opens the route panel instantly** — no extra API call, since
   lat/lng is already cached.
5. The original 10 category buttons are still there below, for anyone who wants to browse
   the **full** list in a category live (not just the single closest result).
6. **Recompute only happens when it should** — moving the pin triggers a fresh cache;
   editing an unrelated field (like rent) with the same pin does not waste 10 more API
   calls. Verified against 5 real scenarios (first-time pin, unrelated edit, pin moved, old
   listing needing backfill, no pin at all).

## For your existing "4 BHK, Nerul" listing specifically
It still has no coordinates saved (the old, broken pin picker never persisted them). Go to
**My Listings → Edit → Location step**, actually place the pin now that saving is fixed, and
publish — the highlights will populate automatically within a few seconds after that.

## How I verified this
- Unit-tested the coordinate-saving validation directly: valid pins save correctly, empty
  submissions correctly produce null (no crash), out-of-range/garbage values are rejected,
  NEED_FLAT listings never get coordinates even if somehow submitted.
- Unit-tested the cache-computation loop against mocked responses simulating one category
  throwing an error, one returning empty results, and one failing outright — confirmed all
  three are gracefully excluded without blocking the other 7 from caching correctly.
- Unit-tested the "should I recompute" decision logic against all 5 realistic scenarios.
- Caught a real privacy bug in my own first draft of the template logic (a fallback
  condition that referenced `listing.coordinates`, which is invisible to non-owners since
  it's `select:false`) — fixed before it shipped, not after.
- Rendered the detail page with a populated cache and with no cache — confirmed the exact
  right number of highlight chips render (verified precisely, not via a flawed text-match),
  and the honest "not available yet" fallback shows when there's truly nothing cached.
- `node --check` + EJS-compile on every changed file.

Still can't test against live Google data from this sandbox — but the actual bug (pin never
saving) is now fixed regardless of that, and everything downstream should work correctly
once you re-pin that listing.
