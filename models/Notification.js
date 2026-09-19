const mongoose = require("mongoose");

/* ============================================================
   NOTIFICATION SCHEMA — HostelNode
   Kept separate from Messages (per spec: Notifications = alerts
   that something happened, Messages = source of truth for actual
   communication). Wired up fully in Phase 7 — this model exists
   from Phase 1 onward so Phase 4/5's connection actions can start
   writing to it immediately.
============================================================ */

const notificationSchema = new mongoose.Schema({

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },

  type: {
    type: String,
    enum: [
      "FLATMATE_CONNECTION_REQUEST",
      "FLATMATE_REQUEST_ACCEPTED",
      "FLATMATE_REQUEST_DECLINED",
      "FLATMATE_REQUEST_CANCELLED",
      "FLATMATE_CONNECTION_REMOVED",
      "FLATMATE_NEW_MESSAGE",
      "LISTING_CLOSED",
      "FLATMATE_LISTING_PAUSED",
      "FLATMATE_REPORT_RECEIVED",
      "FLATMATE_LISTING_PUBLISHED",
    ],
    required: true,
  },

  title: { type: String, required: true },
  body:  { type: String, default: "" },
  link:  { type: String, default: null }, // where the "Open" action navigates

  relatedConnection:   { type: mongoose.Schema.Types.ObjectId, ref: "FlatmateConnection", default: null },
  relatedConversation:  { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
  relatedListing:       { type: mongoose.Schema.Types.ObjectId, ref: "FlatmateListing", default: null },

  // Best-effort duplicate guard for the centralized notification
  // service (utils/flatmateNotifications.js) — see that file for how
  // it's used. Not unique-indexed on purpose (see that file's header).
  dedupeKey: { type: String, default: null, index: true },

  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },

}, { timestamps: true });

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
