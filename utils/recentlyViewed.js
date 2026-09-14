// ============================================================
//  utils/recentlyViewed.js — HostelNode
//  Shared by both PG/Hostel (routes/public.js) and Flatmate
//  (routes/flatmateRoutes.js) view-tracking, so there's one
//  implementation, not two.
// ============================================================

const RecentlyViewed = require("../models/RecentlyViewed");

const MAX_RECENTLY_VIEWED = 5;

/* trackView(studentId, listingType, listingId)
   - Guests (no studentId) are a no-op here — recently-viewed for guests
     is intentionally handled client-side via localStorage instead (see
     the small inline script on the two detail-page views), since there's
     no account to attach server-side history to.
   - Re-viewing something already in the list moves it to the top rather
     than creating a duplicate entry (upsert on the unique student+type+id
     index, refreshing viewedAt).
   - Prunes anything beyond the most recent 5 — actually deleted, not
     just hidden by a query LIMIT, so the cap is real. */
async function trackView(studentId, listingType, listingId) {
  if (!studentId || !listingId) return;
  try {
    await RecentlyViewed.findOneAndUpdate(
      { student: studentId, listingType, listingId },
      { $set: { viewedAt: new Date() } },
      { upsert: true }
    );

    const all = await RecentlyViewed.find({ student: studentId })
      .sort({ viewedAt: -1 })
      .select("_id");

    if (all.length > MAX_RECENTLY_VIEWED) {
      const idsToRemove = all.slice(MAX_RECENTLY_VIEWED).map((r) => r._id);
      await RecentlyViewed.deleteMany({ _id: { $in: idsToRemove } });
    }
  } catch (err) {
    // Never let view-tracking break the actual page render.
    console.error("trackView error (non-critical):", err.message);
  }
}

module.exports = { trackView, MAX_RECENTLY_VIEWED };
