const mongoose = require("mongoose");

/* ============================================================
   REPORT SCHEMA — HostelNode
   Reports are auditable moderation records, not automatic actions —
   an admin reviews each one (see /admin/reports). Reporting someone
   does NOT itself block them; use the separate Block action for that.
============================================================ */

const reportSchema = new mongoose.Schema({

  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },

  relatedListing: { type: mongoose.Schema.Types.ObjectId, ref: "FlatmateListing", default: null },
  relatedConversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },

  reason: {
    type: String,
    enum: ["Spam", "Fake profile", "Harassment", "Fraud / Scam", "Inappropriate content", "Other"],
    required: true,
  },
  details: { type: String, maxlength: 1000, trim: true, default: "" },

  status: {
    type: String,
    enum: ["pending", "reviewed", "dismissed"],
    default: "pending",
    index: true,
  },
  adminNote: { type: String, default: "" },

}, { timestamps: true });

reportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Report", reportSchema);
