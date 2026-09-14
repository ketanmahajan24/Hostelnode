# Sidebar now uses the EXACT CSS from hostel-view1.css, not an approximation

## What changed
Pulled the real values directly from `public/css/hostel-view1.css`'s `.hv-container` /
`.booking-card` / `.host-card` rules and applied them precisely — same 360px sidebar width,
same 36px gap, same 1.7rem price size, same border-radius/shadow/spacing values, same sticky
offset formula. This works because `findhostel.css` (which the Flatmate page uses) already
defines the exact same design tokens (`--radius-xl`, `--shadow-xs`, `--shadow-md`, `--nav-h`,
etc.) — I confirmed this before reusing the values, rather than guessing they'd match.

One adjustment: the sticky offset is `calc(var(--nav-h) + 20px)` instead of hostel-view's
`calc(var(--nav-h) + var(--pnav-h) + 20px)` — the Flatmate page has no secondary sticky
progress-nav bar, so that extra offset doesn't apply here.

## Cleanup
Removed leftover CSS from the old single-column layout (`.poster-row`, unscoped
`.poster-info`/`.poster-avatar`/etc.) that became dead code once "Posted by" moved into the
scoped `.host-card` — left in place, it would have created confusing specificity overlap
with the new rules.

## Verified
Recompiled and re-rendered the page — confirmed the sidebar structure is intact, the price
now renders at the exact same 1.7rem size as the PG page's booking card, the sticky
positioning formula matches, and the Request to Connect / host card content all still
render correctly.
