const mongoose = require("mongoose");

/* ============================================================
   FLATMATE LISTING SCHEMA — HostelNode
   Two intents on one collection: HAVE_FLAT (offering a room/flat)
   and NEED_FLAT (looking for one). Fields that are genuinely
   type-specific live under `have` / `need`; fields every listing
   needs for search, cards and the detail page (city, area, bhk,
   roomType, gender, images...) are kept flat/top-level to match
   the existing /flatmate + /flatmate/results templates and to
   keep queries simple — same flattening style as studentSchema.js.

   Privacy: `contact.phone` / `contact.whatsapp` and `address` use
   `select: false` so a plain `.find()`/`.findOne()` NEVER returns
   them. Routes must explicitly `.select("+contact.phone ...")`
   only after verifying an accepted FlatmateConnection exists.
============================================================ */

const flatmateListingSchema = new mongoose.Schema({

  /* ── OWNERSHIP ── */
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
    index: true,
  },

  /* ── CORE ── */
  type: {
    type: String,
    enum: ["HAVE_FLAT", "NEED_FLAT"],
    required: true,
    index: true,
  },

  status: {
    type: String,
    enum: ["DRAFT", "PENDING", "ACTIVE", "PAUSED", "REJECTED", "CLOSED", "SUSPENDED"],
    default: "DRAFT",
    index: true,
  },

  slug: {
    type: String,
    unique: true,
    sparse: true, // only set when published — drafts have no slug
  },

  title: {
    type: String,
    trim: true,
  },

  /* ── LOCATION (public: city + area only; address is private) ── */
  city: { type: String, required: true, trim: true, index: true },
  area: { type: String, required: true, trim: true },
  landmark: { type: String, trim: true, default: null },
  nearCollege: { type: String, trim: true, default: null },

  address: {
    type: String,
    trim: true,
    select: false, // never returned unless explicitly selected post-authorization
  },

  coordinates: {
    lat: { type: Number, default: null, select: false }, // exact coords can pinpoint the address just like address text — same protection
    lng: { type: Number, default: null, select: false },
  },
  placeId: { type: String, default: null, select: false }, // Google Place ID, same privacy tier as coordinates

  // Auto-computed the moment coordinates are saved (publish/edit) — one
  // Places API call per category, done once, cached here so every viewer
  // sees "Nearby Highlights" instantly with zero clicks and zero extra
  // API calls. Clicking a category on the detail page still hits Google
  // live for the FULL list; this cache only holds the single closest
  // result per category, which is what "automatic sync" actually needs.
  // NOT select:false — this is public info (nearby amenities), same as
  // the /nearby endpoint's own responses.
  nearbyCache: { type: mongoose.Schema.Types.Mixed, default: null },
  nearbyCacheAt: { type: Date, default: null },
  // true only when ALL 10 categories succeeded on the last attempt — a
  // partial success (e.g. 7/10, some blocked by a transient key/IP issue)
  // stays eligible for retry on the next publish rather than getting
  // permanently stuck missing the other 3.
  nearbyCacheComplete: { type: Boolean, default: false },

  /* ── SHARED DISPLAY/FILTER FIELDS (both types) ── */
  bhk: { type: Number, required: true, min: 1, max: 4 }, // 4 = "4 BHK+"
  roomType: {
    type: String,
    enum: ["Private Room", "Shared Room", "Either", "Any"],
    required: true,
  },
  gender: {
    type: String,
    enum: ["male", "female", "any"],
    required: true,
  },
  occupation: {
    type: String,
    enum: ["Student", "Working Professional", "Intern", "Other", null],
    default: null,
  },
  food: {
    type: String,
    enum: ["Vegetarian", "Non-Vegetarian", "No Preference"],
    default: "No Preference",
  },
  lifestyle: [{ type: String }],
  description: { type: String, maxlength: 500, trim: true },

  /* ── HAVE_FLAT-only fields ── */
  have: {
    availabilityType: { type: String, enum: ["Room", "Bed/Spot", "Entire Flat"] },
    availableSpots: { type: Number, min: 1, default: 1 },
    furnishing: { type: String, enum: ["Fully Furnished", "Semi Furnished", "Unfurnished", null], default: null },
    availableFromMode: { type: String, enum: ["now", "date"], default: "now" },
    availableFromDate: { type: Date, default: null },

    rentMonthly: { type: Number },
    depositAmount: { type: Number, default: null },
    depositNegotiable: { type: Boolean, default: false },
    maintenance: { type: String, enum: ["Included", "Separate", null], default: "Included" },
    maintenanceAmount: { type: Number, default: null },

    occupantsCount: { type: Number, default: null },
    occupantsType: { type: String, enum: ["Students", "Working Professionals", "Mixed", null], default: null },

    amenities: [{ type: String }],
  },

  /* ── NEED_FLAT-only fields ── */
  need: {
    needType: { type: String, enum: ["Room in Shared Flat", "Entire Flat", "Either"] },
    preferredAreas: [{ type: String }], // multiple areas — supplements top-level `area`
    budgetMin: { type: Number },
    budgetMax: { type: Number },
    depositPreference: { type: String, enum: ["Flexible", "Up to 1 month", "Up to 2 months", "Up to 3 months", null], default: "Flexible" },
    moveInMode: { type: String, enum: ["immediate", "15days", "1month", "date"], default: "immediate" },
    moveInDate: { type: Date, default: null },
    intro: { type: String, maxlength: 300, trim: true },
  },

  about: {
    company: { type: String, trim: true, default: null },
    college: { type: String, trim: true, default: null },
  },

  /* ── PHOTOS (HAVE_FLAT only — NEED_FLAT never requires photos) ── */
  images: [{ type: String }],
  coverImage: { type: String, default: null },

  /* ── CONTACT (private — select:false) ── */
  contact: {
    phone: { type: String, select: false },
    whatsapp: { type: String, select: false },
    preferredMethod: {
      type: String,
      enum: ["HostelNode Messages", "WhatsApp", "Both"],
      default: "HostelNode Messages",
    },
  },

  /* ── MODERATION / STATS ── */
  isVerified: { type: Boolean, default: false }, // set true only by real admin/verification action
  views: { type: Number, default: 0 },
  requestsCount: { type: Number, default: 0 }, // denormalized, for My Listings cards
  rejectionReason: { type: String, default: null },
  publishedAt: { type: Date, default: null },

  // ── Reminder / lifecycle notification bookkeeping (Phase 10) ──
  // pausedAt: when the owner (or admin) last paused this listing —
  // drives the "re-activate reminder" cron job.
  pausedAt: { type: Date, default: null },
  // pauseReminderSentAt: dedupe guard so the re-activate reminder
  // fires once per pause, not once per cron run.
  pauseReminderSentAt: { type: Date, default: null },
  // activatedAt / expiresAt: set whenever status transitions INTO
  // "ACTIVE" (admin approval, or the owner's own reactivate route) —
  // NOT at publish/submit time, since a PENDING listing isn't visible
  // to seekers yet. Default lifetime is 60 days; both are cleared and
  // recomputed on every re-activation so a relisted listing gets a
  // fresh window rather than an already-expired one.
  activatedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  // expiryWarnedAt: dedupe guard for the "expiring soon" notification.
  expiryWarnedAt: { type: Date, default: null },
  // viewMilestonesNotified: which view-count thresholds (see
  // utils/flatmateMilestones.js) this listing has already notified
  // the owner about — prevents re-notifying on every single view.
  viewMilestonesNotified: { type: [Number], default: [] },

  // A UUID the create-wizard generates once per browser session and
  // resubmits with every publish attempt for that listing. Lets the
  // publish route recognize "this is the same submit, retried" (a
  // double-click that got past the disabled button, a network retry,
  // a resubmitted form) and update the existing listing instead of
  // creating a duplicate — even on a brand-new listing that has no
  // draftId yet. Optional/sparse so it's fully backward compatible
  // with every listing that already exists.
  clientRequestId: { type: String, default: null, index: true, sparse: true, unique: true },

}, { timestamps: true });

/* ── Indexes for the search/results page ── */
flatmateListingSchema.index({ city: 1, type: 1, status: 1 });
flatmateListingSchema.index({ createdAt: -1 });

/* ── Slug generation — called by the route when publishing, not on every draft save ── */
flatmateListingSchema.methods.generateSlug = function () {
  const base = `${this.bhk}bhk-${(this.roomType || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${this.area}-${this.city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = this._id.toString().slice(-6);
  this.slug = `${base}-${suffix}`;
  return this.slug;
};

/* ── Friendly "Available from" / "Move-in" label for cards (matches the
   existing template's plain `moveIn` string, e.g. "1 Oct") ── */
flatmateListingSchema.methods.getMoveInLabel = function () {
  const fmt = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
  if (this.type === "HAVE_FLAT") {
    if (this.have?.availableFromMode === "now") return "Now";
    return fmt(this.have?.availableFromDate) || "Flexible";
  }
  const mode = this.need?.moveInMode;
  if (mode === "immediate") return "Immediately";
  if (mode === "15days") return "Within 15 days";
  if (mode === "1month") return "Within 1 month";
  return fmt(this.need?.moveInDate) || "Flexible";
};

module.exports = mongoose.model("FlatmateListing", flatmateListingSchema);
