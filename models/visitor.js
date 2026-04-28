const mongoose = require("mongoose");

const visitorSchema = new mongoose.Schema({

  /* ── IDENTITY ── */
  ip: { type: String, required: true, index: true },
  fingerprint: { type: String, default: null },

  /* ── PAGE ── */
  route:      { type: String, required: true, index: true },
  routeLabel: { type: String },
  method:     { type: String, default: "GET" },

  /* ── LOCATION (from IP) ── */
  country:  { type: String, default: null },
  region:   { type: String, default: null },
  city:     { type: String, default: null },
  lat:      { type: Number, default: null },
  lng:      { type: Number, default: null },
  timezone: { type: String, default: null },
  isp:      { type: String, default: null },

  /* ── ✅ REAL GPS LOCATION (from browser) ── */
  gpsLat:         { type: Number, default: null },   // exact GPS latitude
  gpsLng:         { type: Number, default: null },   // exact GPS longitude
  gpsAccuracy:    { type: Number, default: null },   // accuracy in meters
  locationSource: { type: String, enum: ["IP", "GPS"], default: "IP" }, // which one we have

  /* ── DEVICE ── */
  userAgent: { type: String, default: null },
  browser:   { type: String, default: null },
  os:        { type: String, default: null },
  device:    { type: String, enum: ["Mobile", "Tablet", "Desktop", "Bot", "Unknown"], default: "Unknown" },
  referrer:  { type: String, default: null },

  /* ── SESSION ── */
  sessionId:   { type: String, index: true },
  isReturning: { type: Boolean, default: false },

  /* ── USER (if logged in) ── */
  userId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  userType: { type: String, enum: ["Owner", "Student", "Admin", null], default: null },

  /* ── TIMESTAMP ── */
  visitedAt: { type: Date, default: Date.now, index: true }

}, { timestamps: false });

visitorSchema.index({ ip: 1, route: 1 });
visitorSchema.index({ visitedAt: -1 });
visitorSchema.index({ route: 1, visitedAt: -1 });

module.exports = mongoose.model("Visitor", visitorSchema);
