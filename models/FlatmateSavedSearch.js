const mongoose = require("mongoose");

/* ============================================================
   FLATMATE SAVED SEARCH SCHEMA — HostelNode (Phase 10)
   Lets a seeker save a /flatmate/results filter combination and get
   notified (in-app + WhatsApp) when a NEW listing matching it goes
   live. Deliberately mirrors the exact filter shape the results route
   (GET /flatmate/results) already accepts — see routes/flatmateRoutes.js
   — so matching a saved search against a new listing reuses the same
   match-building logic rather than a second, possibly-drifting copy.

   Matching happens once, at the moment a listing transitions INTO
   "ACTIVE" (admin approval, or the owner's own reactivate route) —
   not on a cron — since that's the actual "just became visible to
   seekers" moment. See utils/flatmateSavedSearchMatch.js.
============================================================ */

const flatmateSavedSearchSchema = new mongoose.Schema({

  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },

  // Same fields/semantics as the /flatmate/results query params —
  // empty string/absent = "no filter on this field", exactly like the
  // results route treats them. label is a short human-readable
  // summary generated at save time, purely for display in "My saved
  // searches" (never used for matching).
  filters: {
    location: { type: String, default: "", trim: true },
    gender:   { type: String, default: "" },
    type:     { type: String, default: "" }, // "have" | "need" | ""
    budget:   { type: String, default: "" }, // string, matches the query-param shape
    bhk:      { type: String, default: "" },
    roomType: { type: String, default: "" },
  },
  label: { type: String, default: "" },

  active: { type: Boolean, default: true, index: true },

  // Dedupe/rate-limit: a burst of listings published close together
  // shouldn't produce a burst of WhatsApp messages to the same
  // seeker — at most one "new matching listing" notification per
  // saved search per rolling 24h window (see utils/flatmateNotifications.js
  // call site). Set on every match, checked before the next one fires.
  lastNotifiedAt: { type: Date, default: null },

}, { timestamps: true });

flatmateSavedSearchSchema.index({ student: 1, active: 1 });

module.exports = mongoose.model("FlatmateSavedSearch", flatmateSavedSearchSchema);
