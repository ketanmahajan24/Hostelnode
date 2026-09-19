// ============================================================
//  utils/flatmateActivation.js — HostelNode Flatmate (Phase 10)
// ============================================================
/* ============================================================
   Shared logic for the moment a listing transitions INTO "ACTIVE" —
   used by BOTH the admin approval route (routes/adminRoutes.js) and
   the owner's own reactivate route (routes/flatmateRoutes.js), so the
   two call sites can't silently drift apart on what "just went live"
   means.

   LISTING_LIFETIME_DAYS: how long a newly-activated listing stays
   active before the Phase 10 cron auto-closes it (see app.js).
   Assumption, not a spec requirement — this codebase had NO expiry
   concept before Phase 10, so 60 days is a starting default. Override
   with FLATMATE_LISTING_LIFETIME_DAYS if a different window is
   wanted; no code change needed to adjust it.
============================================================ */

const FlatmateSavedSearch = require("../models/FlatmateSavedSearch");
const Student = require("../models/studentSchema");
const { notifyFlatmateEvent } = require("./flatmateNotifications");
const { listingMatchesSavedSearch } = require("./flatmateSavedSearchMatch");

const LISTING_LIFETIME_DAYS = parseInt(process.env.FLATMATE_LISTING_LIFETIME_DAYS, 10) || 60;
// Minimum gap between two "new matching listing" WhatsApp messages to
// the SAME saved search, so a burst of publishes doesn't spam one
// seeker with a message per listing.
const MATCH_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Fields to set whenever a listing becomes ACTIVE (fresh publish
// approval OR the owner's own reactivate-from-PAUSED action). Returns
// a plain object — caller decides how to apply it (mutate-then-save,
// or pass straight into a Mongo update document).
function computeActivationFields(now = new Date()) {
  return {
    activatedAt: now,
    expiresAt: new Date(now.getTime() + LISTING_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
    expiryWarnedAt: null,
    pausedAt: null,
    pauseReminderSentAt: null,
  };
}

// Fire-and-forget: find every active saved search that matches this
// now-live listing and notify its owner. Never awaited by callers —
// mirrors the fire-and-forget pattern every other notifyFlatmateEvent
// call site in this codebase already uses.
function matchAndNotifySavedSearches(listing) {
  setImmediate(async () => {
    try {
      const searches = await FlatmateSavedSearch.find({ active: true }).lean();
      const now = new Date();
      for (const search of searches) {
        // Never notify someone about their own listing.
        if (search.student.toString() === listing.student.toString()) continue;
        if (!listingMatchesSavedSearch(listing, search.filters)) continue;
        if (search.lastNotifiedAt && now - new Date(search.lastNotifiedAt) < MATCH_NOTIFY_COOLDOWN_MS) continue;

        const seekerDoc = await Student.findById(search.student).select("phone").lean().catch(() => null);
        const listingSummaryText = `${listing.bhk} BHK · ${listing.area}, ${listing.city}`;

        notifyFlatmateEvent("NEW_MATCHING_LISTING", {
          userId: search.student,
          title: "A new listing matches your saved search",
          body: listingSummaryText,
          link: `/flatmate/${listing.slug}`,
          relatedListing: listing._id,
          dedupeKey: `NEW_MATCHING_LISTING:${search._id.toString()}:${listing._id.toString()}`,
          whatsapp: seekerDoc?.phone ? { phone: seekerDoc.phone, variables: [listingSummaryText] } : null,
        });

        await FlatmateSavedSearch.updateOne({ _id: search._id }, { $set: { lastNotifiedAt: now } }).catch(() => {});
      }
    } catch (err) {
      console.error("matchAndNotifySavedSearches failed (non-critical):", err.message);
    }
  });
}

module.exports = { computeActivationFields, matchAndNotifySavedSearches, LISTING_LIFETIME_DAYS };
