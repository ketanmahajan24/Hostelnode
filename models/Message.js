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

  readAt: { type: Date, default: null },

}, { timestamps: true });

messageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
