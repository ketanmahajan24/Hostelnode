const mongoose = require("mongoose");

/* ============================================================
   MESSAGE SCHEMA — HostelNode
   Individual messages inside a Conversation. Access control lives
   in the route layer (verify sender is a participant, and for
   FLATMATE_CONNECTION conversations that the linked connection is
   still "accepted") — never trust the client on this.
============================================================ */

const messageSchema = new mongoose.Schema({

  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Conversation",
    required: true,
    index: true,
  },

  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },

  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000,
  },

  attachments: [{ type: String }],

  // WhatsApp-style status, backend-driven only (never set from the client):
  // created  → "sent" (single grey tick)
  // deliveredAt set → the recipient's own client actually fetched this
  //   message (via poll or opening the chat) — "delivered" (double grey tick)
  // readAt set → the recipient had the chat open/focused when this was
  //   seen, or opened the conversation after it arrived — "read" (double
  //   blue tick). Read always implies delivered.
  deliveredAt: { type: Date, default: null },
  readAt: { type: Date, default: null },

}, { timestamps: true });

messageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
