/* ============================================================
   models/waCooldown.js  —  Prevents duplicate WA lead spam
============================================================ */

const mongoose = require("mongoose");

const waCooldownSchema = new mongoose.Schema({
  ownerId:   { type: mongoose.Schema.Types.ObjectId, ref: "Owner", required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
  sentAt:    { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },  // sentAt + 24 hours
}, { timestamps: false });

// Auto-delete expired documents
waCooldownSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
waCooldownSchema.index({ ownerId: 1, studentId: 1 });

module.exports = mongoose.model("WaCooldown", waCooldownSchema);