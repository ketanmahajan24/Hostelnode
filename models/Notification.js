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
      "FLATMATE_NEW_MESSAGE",
      "LISTING_CLOSED",
    ],
    required: true,
  },

  title: { type: String, required: true },
  body:  { type: String, default: "" },
  link:  { type: String, default: null }, // where the "Open" action navigates

  relatedConnection:   { type: mongoose.Schema.Types.ObjectId, ref: "FlatmateConnection", default: null },
  relatedConversation:  { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
  relatedListing:       { type: mongoose.Schema.Types.ObjectId, ref: "FlatmateListing", default: null },

  isRead: { type: Boolean, default: false, index: true },

}, { timestamps: true });

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
