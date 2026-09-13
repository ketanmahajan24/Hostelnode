const mongoose = require("mongoose");

/* ============================================================
   BLOCK SCHEMA — HostelNode
   A user-level block between two students (not tied to a single
   listing/connection — blocking someone should prevent them from
   requesting to connect on ANY of your listings, not just the one
   you were talking about). Checked by:
     - POST /flatmate/connect        (can't request if either side blocked)
     - POST /messages/:id/messages   (can't message if either side blocked)
============================================================ */

const blockSchema = new mongoose.Schema({

  blocker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },
  blocked: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },

}, { timestamps: true });

blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });

module.exports = mongoose.model("Block", blockSchema);
