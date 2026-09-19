const mongoose = require("mongoose");

/* ============================================================
   FLATMATE CONNECTION SCHEMA — HostelNode
   Represents the "Request to Connect" relationship between two
   students around a specific Flatmate listing. Never hard-deleted —
   moves through a status lifecycle instead, so privacy/chat access
   can always be re-derived from current status.
============================================================ */

const flatmateConnectionSchema = new mongoose.Schema({

  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },

  // The listing being requested about (required — this is what the
  // requester found and clicked "Request to Connect" on).
  receiverListing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FlatmateListing",
    required: true,
  },

  // The requester's own listing, if they have one (optional — a
  // NEED_FLAT poster requesting on a HAVE_FLAT listing, or vice versa).
  requesterListing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FlatmateListing",
    default: null,
  },

  status: {
    type: String,
    enum: ["pending", "accepted", "declined", "cancelled", "ended", "blocked"],
    default: "pending",
    index: true,
  },

  message: { type: String, maxlength: 500, trim: true, default: "" },

  acceptedAt:  { type: Date, default: null },
  declinedAt:  { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  endedAt:     { type: Date, default: null },

  // Dedupe guard (Phase 10) for the "pending request reminder" cron —
  // set once a reminder has been sent for this request so it doesn't
  // fire again on every subsequent cron run while still pending.
  pendingReminderSentAt: { type: Date, default: null },

}, { timestamps: true });

/* Prevent duplicate pending requests from the same requester on the
   same listing — enforced here AND re-checked in the route (never
   trust a unique index alone to produce a friendly error message). */
flatmateConnectionSchema.index(
  { requester: 1, receiverListing: 1, status: 1 }
);

module.exports = mongoose.model("FlatmateConnection", flatmateConnectionSchema);
