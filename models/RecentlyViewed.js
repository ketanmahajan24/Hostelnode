const mongoose = require("mongoose");

/* ============================================================
   RECENTLY VIEWED — HostelNode
   Tracks the last 5 properties (PG/Hostel + Flatmate, mixed) a
   logged-in student has viewed. Enforced server-side in
   utils/recentlyViewed.js's trackView() — not just capped on
   display, actually pruned in the database.
============================================================ */

const recentlyViewedSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },
  listingType: {
    type: String,
    enum: ["pg", "flatmate"],
    required: true,
  },
  listingId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  viewedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

recentlyViewedSchema.index({ student: 1, listingType: 1, listingId: 1 }, { unique: true });
recentlyViewedSchema.index({ student: 1, viewedAt: -1 });

module.exports = mongoose.model("RecentlyViewed", recentlyViewedSchema);
