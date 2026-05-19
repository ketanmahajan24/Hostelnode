/* ============================================================
   models/searchLog.js  —  HostelNode Search Analytics
============================================================ */

const mongoose = require("mongoose");

const searchLogSchema = new mongoose.Schema({
  // Who searched
  studentId:    { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
  studentName:  { type: String, default: null },
  studentPhone: { type: String, default: null },

  // What they searched
  searchQuery:  { type: String, default: "" },         // raw input e.g. "Indore"
  searchType:   {
    type: String,
    enum: ["text_search", "nearby_click", "city_page", "area_page", "listing_view"],
    required: true
  },
  resolvedCity: { type: String, default: "" },          // normalised e.g. "Mumbai"
  resolvedArea: { type: String, default: "" },          // sub-area  e.g. "Nerul"
  resultsCount: { type: Number, default: 0 },

  // Device / network
  ip:           { type: String, default: "" },
  userAgent:    { type: String, default: "" },
  lat:          { type: Number, default: null },
  lng:          { type: Number, default: null },

}, { timestamps: true });

// Indexes for fast admin queries
searchLogSchema.index({ createdAt: -1 });
searchLogSchema.index({ resolvedCity: 1 });
searchLogSchema.index({ resolvedArea: 1 });
searchLogSchema.index({ searchType: 1 });
searchLogSchema.index({ studentId: 1 });

module.exports = mongoose.model("SearchLog", searchLogSchema);