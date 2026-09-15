// ================= flatmateRoutes.js =============================
/* ============================================================
   flatmateRoutes.js — HostelNode Flatmate feature

   PHASE 1: backed by real MongoDB (FlatmateListing) instead of the
   in-memory SAMPLE_LISTINGS array used in the earliest prototype.
   PHASE 2: Create Listing wizards (HAVE_FLAT / NEED_FLAT), draft
   save, photo upload (HAVE only, reusing the same multer+sharp
   pattern as the existing PG listing upload in userRoutes.js), and
   publish → status "PENDING" pending admin approval (Phase 7).

   IMPORTANT — the view-model shape returned to /flatmate + /results
   templates is UNCHANGED on purpose:
     { _id, slug, type: 'have'|'need', city, location, bhk, roomType,
       gender, moveIn, postedBy, images[], rent, budgetMin, budgetMax }

   - GET  /flatmate                  → Landing page
   - GET  /flatmate/results           → Dedicated search-results page
   - GET  /flatmate/create            → Choice/redirect based on ?type
   - GET  /flatmate/create/have       → HAVE_FLAT 6-step wizard
   - GET  /flatmate/create/need       → NEED_FLAT 5-step wizard
   - POST /flatmate/create/draft      → Save/update a draft (auth required)
   - POST /flatmate/create/publish    → Validate + publish (auth required)
   - GET  /flatmate/create-success/:id → Confirmation page
   - POST /flatmate/feedback          → still a stub (unrelated to this phase)

   Phases 3+ will add: listing detail page, connections, messages,
   my-listings, admin moderation.
============================================================ */

const express  = require("express");
const router   = express.Router();
const jwt      = require("jsonwebtoken");
const multer   = require("multer");
const sharp    = require("sharp");
const path     = require("path");
const crypto   = require("crypto");
const fs       = require("fs");

const FlatmateListing = require("../models/FlatmateListing");
const Student = require("../models/studentSchema");
const FlatmateConnection = require("../models/FlatmateConnection");
const Conversation = require("../models/Conversation");
const Block = require("../models/Block");

const CITIES = ["Mumbai", "Navi Mumbai", "Pune", "Bengaluru", "Delhi NCR", "Hyderabad"];

// WhatsApp template names for Flatmate notifications — these are NOT yet
// approved Meta templates; they must be created in Meta Business Manager
// before these notifications will actually send (see PHASE-A notes for the
// exact body text/variables to submit for approval). Configurable via env
// so the template name can change without a code deploy.
const FLATMATE_WA_TEMPLATES = {
  requestReceived: process.env.WA_TEMPLATE_FLATMATE_REQUEST || "hostelnode_flatmate_request",
  requestAccepted: process.env.WA_TEMPLATE_FLATMATE_ACCEPTED || "hostelnode_flatmate_accepted",
};
const RESULTS_PAGE_SIZE = 9;

/* ─────────────────────────────────────────────
   AUTH — same JWT/cookie contract as Middlewares/jwtAuth.js's
   jwtStudentAuth, but preserves a `?next=` so the login page can
   send the user back to the exact create page they wanted, instead
   of always landing on the generic dashboard. Defined locally
   (rather than editing the shared middleware) so this phase can't
   affect any other already-gated student page.
───────────────────────────────────────────── */
function requireStudent(req, res, next) {
  const token = req.cookies?.studentToken;
  if (!token) {
    return res.redirect(`/student/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  try {
    req.student = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.clearCookie("studentToken");
    return res.redirect(`/student/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
}

// Like requireStudent, but never blocks — just sets req.student when a
// valid session exists, for pages guests can browse (the /flatmate card
// grid needs to know who's viewing WITHOUT forcing a login).
function optionalAuth(req, res, next) {
  const token = req.cookies?.studentToken;
  if (!token) return next();
  try {
    req.student = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // invalid/expired token on an optional route — just proceed as a guest
  }
  next();
}

// Batch-computes, for one viewer, the request status against a set of
// listings — one query total, not one per card. Returns a map:
//   listingId -> { status: 'none'|'pending'|'accepted'|'rejected'|'own',
//                  connectionId, conversationId }
async function buildRequestStatusMap(viewerId, listingDocs) {
  const map = {};
  if (!viewerId) return map;

  const listingIds = listingDocs.map((l) => l._id);
  const ownListingIds = new Set(
    listingDocs.filter((l) => l.student?._id?.toString() === viewerId).map((l) => l._id.toString())
  );
  // Which owner does each (non-own) listing belong to? Needed so an
  // accepted connection with that person — made via ANY listing between
  // them — correctly carries over to every other listing of theirs too.
  const ownerIdByListing = {};
  listingDocs.forEach((l) => {
    const key = l._id.toString();
    if (!ownListingIds.has(key)) ownerIdByListing[key] = l.student?._id?.toString();
  });
  const otherOwnerIds = [...new Set(Object.values(ownerIdByListing).filter(Boolean))];

  const [listingScopedConnections, acceptedWithOwners] = await Promise.all([
    FlatmateConnection.find({
      requester: viewerId,
      receiverListing: { $in: listingIds },
    }).sort({ createdAt: -1 }),
    otherOwnerIds.length
      ? FlatmateConnection.find({
          status: "accepted",
          $or: [
            { requester: viewerId, receiver: { $in: otherOwnerIds } },
            { requester: { $in: otherOwnerIds }, receiver: viewerId },
          ],
        })
      : [],
  ]);

  // Person-level: for each owner, is there ANY accepted connection at all
  // (regardless of which of their listings it was made on)? This takes
  // priority — being accepted once shouldn't require re-requesting on
  // their other listings.
  const acceptedConnectionByOwner = {};
  acceptedWithOwners.forEach((c) => {
    const otherPartyId = c.requester.toString() === viewerId ? c.receiver.toString() : c.requester.toString();
    if (!acceptedConnectionByOwner[otherPartyId]) acceptedConnectionByOwner[otherPartyId] = c;
  });

  // Listing-level fallback: the viewer's own pending/declined/etc. history
  // scoped to this specific listing (a pending request is inherently
  // about one listing, not the person as a whole).
  const latestByListing = {};
  listingScopedConnections.forEach((c) => {
    const key = c.receiverListing.toString();
    if (!latestByListing[key]) latestByListing[key] = c;
  });

  const relevantConnectionIds = [
    ...Object.values(acceptedConnectionByOwner).map((c) => c._id),
    ...Object.values(latestByListing).filter((c) => c.status === "accepted").map((c) => c._id),
  ];
  const conversations = relevantConnectionIds.length
    ? await Conversation.find({ connection: { $in: relevantConnectionIds } })
    : [];
  const conversationByConnection = {};
  conversations.forEach((cv) => { conversationByConnection[cv.connection.toString()] = cv._id.toString(); });

  const normalize = { pending: "pending", accepted: "accepted", declined: "rejected" };

  listingDocs.forEach((l) => {
    const key = l._id.toString();
    if (ownListingIds.has(key)) {
      map[key] = { status: "own", connectionId: null, conversationId: null };
      return;
    }

    const ownerId = ownerIdByListing[key];
    const personLevelConn = ownerId ? acceptedConnectionByOwner[ownerId] : null;
    const conn = personLevelConn || latestByListing[key];

    if (!conn) {
      map[key] = { status: "none", connectionId: null, conversationId: null };
      return;
    }
    map[key] = {
      status: normalize[conn.status] || "none", // cancelled/ended -> re-requestable
      connectionId: conn._id.toString(),
      conversationId: conn.status === "accepted" ? conversationByConnection[conn._id.toString()] || null : null,
    };
  });

  return map;
}

/* ─────────────────────────────────────────────
   PHOTO UPLOAD — HAVE_FLAT listings only.
   Mirrors the exact multer pattern already used for PG listing
   photos in routes/userRoutes.js (disk storage under /secure_uploads,
   random filename, 5MB/file limit), writing to its own subfolder so
   it never collides with PG listing images. Files are additionally
   compressed/resized with sharp (already a project dependency) before
   being written to disk, standing in for "client-side compression
   where practical" without introducing a new frontend dependency.
───────────────────────────────────────────── */
const flatmateUploadDir = "/secure_uploads/flatmate";
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(flatmateUploadDir);

const flatmateStorage = multer.memoryStorage(); // we re-encode with sharp before writing, so no need to hit disk twice
const flatmateUpload = multer({
  storage: flatmateStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 15 }, // 5MB/image, max 15 images
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG or WebP images are allowed."), ok);
  },
});

async function saveCompressedImage(fileBuffer) {
  const filename = `${crypto.randomBytes(16).toString("hex")}.jpg`;
  const fullPath = path.join(flatmateUploadDir, filename);
  await sharp(fileBuffer)
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(fullPath);
  return filename; // stored in FlatmateListing.images[]; served at /flatmate-images/<filename>
}

function handleFlatmateUploadError(fn) {
  return (req, res, next) => {
    fn(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE")  return res.status(413).json({ success: false, error: "Each photo must be under 5 MB." });
        if (err.code === "LIMIT_FILE_COUNT") return res.status(413).json({ success: false, error: "Maximum 15 photos allowed." });
      }
      return res.status(400).json({ success: false, error: err.message || "Photo upload failed." });
    });
  };
}

/* ─────────────────────────────────────────────
   FORM → SCHEMA MAPPING HELPERS
───────────────────────────────────────────── */
function toInt(v, fallback = null) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function asArray(v) {
  if (v === undefined || v === null || v === "") return [];
  const arr = Array.isArray(v) ? v : [v];
  // Defensive: a stale frontend (or any client bypassing it) could still
  // submit one comma-joined string instead of a real array — split those
  // apart rather than saving a single garbled entry.
  return arr.flatMap((item) =>
    typeof item === "string" && item.includes(",") ? item.split(",").map((s) => s.trim()).filter(Boolean) : [item]
  );
}

// Builds the FlatmateListing field set shared by both draft-save and
// publish, from a submitted form body. Does NOT touch `status` or
// `images` — callers decide those explicitly.
function buildListingFieldsFromBody(body, type, verifiedPhone) {
  const isHave = type === "HAVE_FLAT";

  // Only HAVE_FLAT has a single property to pin (NEED_FLAT is about
  // preferred areas, not one address) — validate ranges so a malformed
  // or malicious submission can't write garbage coordinates.
  let coordinates = { lat: null, lng: null };
  let placeId = null;
  if (isHave) {
    const lat = parseFloat(body.lat), lng = parseFloat(body.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      coordinates = { lat, lng };
      placeId = (body.placeId || "").trim() || null;
    }
  }

  const fields = {
    type,
    city: (body.city || "").trim(),
    area: (body.area || "").trim(),
    landmark: (body.landmark || "").trim() || null,
    nearCollege: (body.nearCollege || "").trim() || null,
    address: (body.address || "").trim() || null,
    coordinates,
    placeId,
    bhk: toInt(isHave ? body.bhk : body.bhk, null),
    roomType: isHave ? body.roomType : body.roomPreference,
    gender: isHave ? (body.preferredGender === "No Preference" ? "any" : (body.preferredGender || "any").toLowerCase())
                   : (body.gender || "").toLowerCase(),
    occupation: body.occupation || null,
    food: body.food || "No Preference",
    lifestyle: asArray(body["lifestyle[]"] || body.lifestyle),
    about: {
      company: (body.company || "").trim() || null,
      college: (body.college || "").trim() || null,
    },
    contact: {
      // NEVER trust a client-submitted primary phone number — it always
      // comes from the authenticated student's verified account, looked
      // up server-side, regardless of anything the form/hidden field sent.
      phone: verifiedPhone,
      whatsapp: body.sameAsPhone === "on" || body.sameAsPhone === "true"
        ? verifiedPhone
        : (body.whatsapp || "").trim() || null,
      preferredMethod: body.preferredMethod || "HostelNode Messages",
    },
  };

  if (isHave) {
    fields.description = (body.description || "").trim().slice(0, 500);
    fields.have = {
      availabilityType: body.availabilityType,
      availableSpots: toInt(body.availableSpots, 1),
      furnishing: body.furnishing || null,
      availableFromMode: body.availableFromMode || "now",
      availableFromDate: body.availableFromMode === "date" && body.availableFromDate ? new Date(body.availableFromDate) : null,
      rentMonthly: toInt(body.rentMonthly, null),
      depositAmount: body.depositNegotiable === "on" ? null : toInt(body.depositAmount, null),
      depositNegotiable: body.depositNegotiable === "on" || body.depositNegotiable === "true",
      maintenance: body.maintenance || "Included",
      maintenanceAmount: body.maintenance === "Separate" ? toInt(body.maintenanceAmount, null) : null,
      occupantsCount: toInt(body.occupantsCount, null),
      occupantsType: body.occupantsType || null,
      amenities: asArray(body["amenities[]"] || body.amenities),
    };
  } else {
    fields.need = {
      needType: body.needType,
      preferredAreas: asArray(body["preferredAreas[]"] || body.preferredAreas),
      budgetMin: toInt(body.budgetMin, null),
      budgetMax: toInt(body.budgetMax, null),
      depositPreference: body.depositPreference || "Flexible",
      moveInMode: body.moveInMode || "immediate",
      moveInDate: body.moveInMode === "date" && body.moveInDate ? new Date(body.moveInDate) : null,
      intro: (body.intro || "").trim().slice(0, 300),
    };
  }

  return fields;
}

// Minimal server-side validation — never trust the client's disabled
// buttons/required attributes alone.
function validateForPublish(fields, type) {
  const errors = [];
  if (!fields.city) errors.push("City is required.");
  if (!fields.area) errors.push("Area/locality is required.");
  if (!fields.bhk || fields.bhk < 1 || fields.bhk > 4) errors.push("Please select a valid flat type.");
  if (!fields.roomType) errors.push("Room type is required.");
  if (!fields.contact.phone || !/^[6-9]\d{9}$/.test(fields.contact.phone)) errors.push("A valid 10-digit phone number is required.");

  if (type === "HAVE_FLAT") {
    if (!fields.have.availabilityType) errors.push("Please select what's available.");
    if (!fields.have.rentMonthly || fields.have.rentMonthly <= 0) errors.push("Monthly rent is required.");
  } else {
    if (fields.gender !== "male" && fields.gender !== "female") errors.push("Please select your gender.");
    if (!fields.need.budgetMin || !fields.need.budgetMax || fields.need.budgetMin > fields.need.budgetMax) {
      errors.push("Please enter a valid budget range.");
    }
    if (!fields.need.preferredAreas || fields.need.preferredAreas.length === 0) {
      errors.push("Please add at least one preferred area.");
    }
  }
  return errors;
}

/* ─────────────────────────────────────────────
   VIEW-MODEL MAPPER
   Works on both populated .lean() docs (student.firstName present)
   and aggregation-pipeline docs (student field normalized to the
   same shape by the pipeline before this runs — see /results below).
───────────────────────────────────────────── */
function formatMoveIn(doc) {
  const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null);
  if (doc.type === "HAVE_FLAT") {
    if (doc.have?.availableFromMode === "now") return "Now";
    return fmt(doc.have?.availableFromDate) || "Flexible";
  }
  const mode = doc.need?.moveInMode;
  if (mode === "immediate") return "Immediately";
  if (mode === "15days") return "Within 15 days";
  if (mode === "1month") return "Within 1 month";
  return fmt(doc.need?.moveInDate) || "Flexible";
}

function toCardViewModel(doc, requestInfo, isSaved) {
  const isHave = doc.type === "HAVE_FLAT";
  return {
    _id: doc._id.toString(),
    slug: doc.slug || null,
    type: isHave ? "have" : "need",
    city: doc.city,
    location: doc.area,
    bhk: doc.bhk,
    roomType: doc.roomType,
    gender: doc.gender,
    moveIn: formatMoveIn(doc),
    postedBy: doc.student?.firstName || "HostelNode User",
    images: isHave ? (doc.images || []) : undefined,
    rent: isHave ? doc.have?.rentMonthly : undefined,
    budgetMin: !isHave ? doc.need?.budgetMin : undefined,
    budgetMax: !isHave ? doc.need?.budgetMax : undefined,
    availableSpots: isHave ? (doc.have?.availableSpots ?? null) : null,
    isVerified: !!doc.isVerified,
    requestStatus: requestInfo ? requestInfo.status : "none",
    connectionId: requestInfo ? requestInfo.connectionId : null,
    conversationId: requestInfo ? requestInfo.conversationId : null,
    isSaved: !!isSaved,
  };
}

// One query for all cards' saved state, not one per card.
async function buildSavedSet(viewerId, listingDocs) {
  if (!viewerId) return new Set();
  const student = await Student.findById(viewerId).select("savedProperties").lean();
  if (!student) return new Set();
  const ids = new Set(
    student.savedProperties
      .filter((sp) => sp.listingType === "flatmate")
      .map((sp) => sp.listingId.toString())
  );
  return ids;
}

// Normalize the roomType filter chip value ("private"/"shared") to the
// exact enum stored on the document.
function roomTypeFilterValue(rt) {
  if (rt === "private") return "Private Room";
  if (rt === "shared")  return "Shared Room";
  return null;
}

/* ─────────────────────────────────────────────
   LANDING PAGE  →  GET /flatmate
   Always shows the clean marketing/landing state. If a search/filter
   query param is present, redirect to /flatmate/results — the landing
   page itself never shows a filtered grid.
───────────────────────────────────────────── */
router.get("/", optionalAuth, async (req, res) => {
  try {
    const hasFilters = ["location", "gender", "type", "budget", "bhk"].some(
      key => req.query[key] && String(req.query[key]).trim() && req.query[key] !== "any"
    );
    if (hasFilters) {
      const qs = new URLSearchParams(req.query).toString();
      return res.redirect(302, `/flatmate/results${qs ? "?" + qs : ""}`);
    }

    const totalListingsCount = await FlatmateListing.countDocuments({ status: "ACTIVE" });

    const featuredDocs = await FlatmateListing.find({ status: "ACTIVE" })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate("student", "firstName")
      .lean();
    const statusMap = await buildRequestStatusMap(req.student?.id, featuredDocs);
    const savedSet = await buildSavedSet(req.student?.id, featuredDocs);
    const featuredListings = featuredDocs.map((doc) => toCardViewModel(doc, statusMap[doc._id.toString()], savedSet.has(doc._id.toString())));

    const cityAgg = await FlatmateListing.aggregate([
      { $match: { status: "ACTIVE" } },
      { $group: { _id: "$city", count: { $sum: 1 } } },
    ]);
    const countByCity = Object.fromEntries(cityAgg.map(c => [c._id, c.count]));
    const cityCounts = CITIES.map(name => ({ name, count: countByCity[name] || 0 }));

    res.render("flatmate/flatmate", {
      featuredListings,
      cityCounts,
      totalListingsCount,
      filters: { location: "", gender: "", type: "", budget: "", bhk: "" },
    });
  } catch (err) {
    console.error("Flatmate landing route error:", err);
    res.status(500).send("Something went wrong loading the Flatmate page. Please try again in a moment.");
  }
});

/* ─────────────────────────────────────────────
   SEARCH RESULTS  →  GET /flatmate/results
   Real filter + sort + pagination against MongoDB. Uses an
   aggregation pipeline (not a plain .find()) because "price" lives
   on a different sub-path depending on listing type (have.rentMonthly
   vs need.budgetMax), so sorting/filtering by budget needs a
   computed field.
───────────────────────────────────────────── */
router.get("/results", optionalAuth, async (req, res) => {
  try {
    const {
      location = "", gender = "", type = "", budget = "", bhk = "",
      roomType = "", sort = "newest", page = "1",
    } = req.query;

    const match = { status: "ACTIVE" };

    if (location) {
      const re = new RegExp(location.trim(), "i");
      match.$or = [{ city: re }, { area: re }];
    }
    if (gender && gender !== "any") {
      match.gender = { $in: [gender, "any"] };
    }
    if (type === "need" || type === "have") {
      match.type = type === "have" ? "HAVE_FLAT" : "NEED_FLAT";
    }
    if (bhk) {
      match.bhk = parseInt(bhk, 10);
    }
    const roomTypeValue = roomTypeFilterValue(roomType);
    if (roomTypeValue) {
      match.roomType = roomTypeValue;
    }
    if (budget) {
      const max = parseInt(budget, 10);
      match.$and = (match.$and || []).concat([{
        $or: [
          { type: "HAVE_FLAT", "have.rentMonthly": { $lte: max } },
          { type: "NEED_FLAT", "need.budgetMax":   { $lte: max } },
        ],
      }]);
    }

    const total = await FlatmateListing.countDocuments(match);
    const totalPages = Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE));
    const currentPage = Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages);

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          sortPrice: {
            $cond: [{ $eq: ["$type", "HAVE_FLAT"] }, "$have.rentMonthly", "$need.budgetMax"],
          },
        },
      },
    ];
    if (sort === "price_asc")       pipeline.push({ $sort: { sortPrice: 1 } });
    else if (sort === "price_desc") pipeline.push({ $sort: { sortPrice: -1 } });
    else                            pipeline.push({ $sort: { createdAt: -1 } });

    pipeline.push(
      { $skip: (currentPage - 1) * RESULTS_PAGE_SIZE },
      { $limit: RESULTS_PAGE_SIZE },
      { $lookup: { from: "students", localField: "student", foreignField: "_id", as: "student" } },
      { $unwind: { path: "$student", preserveNullAndEmptyArrays: true } }
    );

    const rawListings = await FlatmateListing.aggregate(pipeline);
    const statusMap = await buildRequestStatusMap(req.student?.id, rawListings);
    const savedSet = await buildSavedSet(req.student?.id, rawListings);
    const listings = rawListings.map((doc) => toCardViewModel(doc, statusMap[doc._id.toString()], savedSet.has(doc._id.toString())));

    res.render("flatmate/flatmate-results", {
      listings,
      total,
      currentPage,
      totalPages,
      filters: { location, gender, type, budget, bhk, roomType, sort },
    });
  } catch (err) {
    console.error("Flatmate results route error:", err);
    res.status(500).send("Something went wrong loading your search results. Please try again in a moment.");
  }
});

// Builds SEO title/description/canonical for a listing detail page. Never
// includes phone/whatsapp/address — those are private regardless of SEO needs.
function buildListingSeo(listing) {
  const isHave = listing.type === "HAVE_FLAT";
  const title = isHave
    ? `${listing.bhk} BHK ${listing.roomType} in ${listing.area}, ${listing.city} | HostelNode`
    : `Flatmate Looking for ${listing.bhk} BHK in ${listing.area}, ${listing.city} | HostelNode`;
  const description = isHave
    ? `${listing.bhk} BHK ${listing.roomType} available in ${listing.area}, ${listing.city}. ₹${listing.have?.rentMonthly || "—"}/month. Connect directly on HostelNode — no brokers.`
    : `Looking for a ${listing.bhk} BHK ${listing.roomType} in ${listing.area}, ${listing.city}. Budget ₹${listing.need?.budgetMin || "—"}–₹${listing.need?.budgetMax || "—"}/month. Connect directly on HostelNode.`;
  return { title, description, canonical: `https://www.hostelnode.com/flatmate/${listing.slug}` };
}


/* ─────────────────────────────────────────────
   CREATE — CHOICE / TYPE ROUTER  →  GET /flatmate/create
   Validates ?type, requires auth (with return-to), then dispatches
   to the appropriate wizard. Invalid/missing type → back to /flatmate.
───────────────────────────────────────────── */
router.get("/create", requireStudent, (req, res) => {
  const type = (req.query.type || "").toLowerCase();
  if (type === "have") return res.redirect(`/flatmate/create/have${req.query.draft ? `?draft=${req.query.draft}` : ""}`);
  if (type === "need") return res.redirect(`/flatmate/create/need${req.query.draft ? `?draft=${req.query.draft}` : ""}`);
  return res.redirect("/flatmate");
});

/* ─────────────────────────────────────────────
   CREATE — HAVE_FLAT WIZARD  →  GET /flatmate/create/have
───────────────────────────────────────────── */
router.get("/create/have", requireStudent, async (req, res) => {
  try {
    let draft = null;
    if (req.query.draft) {
      draft = await FlatmateListing.findOne({
        _id: req.query.draft, student: req.student.id, type: "HAVE_FLAT",
      }).select("+contact.phone +contact.whatsapp +address +coordinates.lat +coordinates.lng +placeId").lean();
    }
    // Always a fresh DB lookup — never trust the JWT payload for something
    // that could have changed since the token was issued.
    const me = await Student.findById(req.student.id).select("phone");
    res.render("flatmate/create-have", { draft, cities: CITIES, verifiedPhone: me?.phone || "", googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null });
  } catch (err) {
    console.error("Flatmate create/have error:", err);
    res.status(500).send("Something went wrong loading the form. Please try again.");
  }
});

/* ─────────────────────────────────────────────
   CREATE — NEED_FLAT WIZARD  →  GET /flatmate/create/need
───────────────────────────────────────────── */
router.get("/create/need", requireStudent, async (req, res) => {
  try {
    let draft = null;
    if (req.query.draft) {
      draft = await FlatmateListing.findOne({
        _id: req.query.draft, student: req.student.id, type: "NEED_FLAT",
      }).select("+contact.phone +contact.whatsapp +address +coordinates.lat +coordinates.lng +placeId").lean();
    }
    const me = await Student.findById(req.student.id).select("phone");
    res.render("flatmate/create-need", { draft, cities: CITIES, verifiedPhone: me?.phone || "" });
  } catch (err) {
    console.error("Flatmate create/need error:", err);
    res.status(500).send("Something went wrong loading the form. Please try again.");
  }
});

/* ─────────────────────────────────────────────
   SAVE DRAFT  →  POST /flatmate/create/draft
   Upserts a DRAFT-status listing owned by the current student.
   No validation beyond "must belong to the current student" — a
   draft is allowed to be incomplete by definition.
───────────────────────────────────────────── */
router.post("/create/draft", requireStudent, handleFlatmateUploadError(flatmateUpload.array("photos", 15)), async (req, res) => {
  try {
    const type = req.body.type === "have" ? "HAVE_FLAT" : "NEED_FLAT";
    const me = await Student.findById(req.student.id).select("phone");
    const fields = buildListingFieldsFromBody(req.body, type, me?.phone || "");

    let listing;
    if (req.body.draftId) {
      listing = await FlatmateListing.findOne({ _id: req.body.draftId, student: req.student.id });
      if (!listing) return res.status(404).json({ success: false, error: "Draft not found." });
      Object.assign(listing, fields);
    } else {
      listing = new FlatmateListing({ ...fields, student: req.student.id, status: "DRAFT" });
    }

    if (type === "HAVE_FLAT" && req.files && req.files.length) {
      const newFilenames = [];
      for (const file of req.files) newFilenames.push(await saveCompressedImage(file.buffer));
      listing.images = [...(listing.images || []), ...newFilenames];
      if (!listing.coverImage) listing.coverImage = listing.images[0];
    }

    await listing.save();
    res.json({ success: true, draftId: listing._id.toString() });
  } catch (err) {
    console.error("Flatmate draft save error:", err);
    res.status(500).json({ success: false, error: "Could not save draft. Please try again." });
  }
});

/* ─────────────────────────────────────────────
   PUBLISH  →  POST /flatmate/create/publish
   Validates required fields server-side (never trusts the client),
   uploads/compresses any new photos, generates the slug, and sets
   status → PENDING (an admin approves it in Phase 7 before it
   becomes ACTIVE/searchable).
───────────────────────────────────────────── */
router.post("/create/publish", requireStudent, handleFlatmateUploadError(flatmateUpload.array("photos", 15)), async (req, res) => {
  try {
    const type = req.body.type === "have" ? "HAVE_FLAT" : "NEED_FLAT";
    const me = await Student.findById(req.student.id).select("phone");
    const fields = buildListingFieldsFromBody(req.body, type, me?.phone || "");

    let listing;
    let coordsBeforeSave = { lat: null, lng: null };
    let cacheAgeBeforeSave = null;
    let cacheCompleteBeforeSave = false;
    if (req.body.draftId) {
      listing = await FlatmateListing.findOne({ _id: req.body.draftId, student: req.student.id });
      if (!listing) return res.status(404).json({ success: false, error: "Listing not found." });
      coordsBeforeSave = { lat: listing.coordinates?.lat ?? null, lng: listing.coordinates?.lng ?? null };
      cacheAgeBeforeSave = listing.nearbyCacheAt;
      cacheCompleteBeforeSave = listing.nearbyCacheComplete;
      Object.assign(listing, fields);
    } else {
      listing = new FlatmateListing({ ...fields, student: req.student.id, status: "DRAFT" });
    }

    let newImageCount = 0;
    if (type === "HAVE_FLAT" && req.files && req.files.length) {
      const newFilenames = [];
      for (const file of req.files) newFilenames.push(await saveCompressedImage(file.buffer));
      listing.images = [...(listing.images || []), ...newFilenames];
      if (!listing.coverImage) listing.coverImage = listing.images[0];
      newImageCount = newFilenames.length;
    }

    const errors = validateForPublish(fields, type);
    if (type === "HAVE_FLAT" && (!listing.images || listing.images.length === 0)) {
      errors.push("Please add at least 1 photo (3+ recommended).");
    }
    if (errors.length) {
      // Save whatever we have as a draft so the student doesn't lose their work,
      // then report the errors back for the form to display.
      await listing.save();
      return res.status(400).json({ success: false, errors, draftId: listing._id.toString() });
    }

    // Only a fresh draft or a fixed-up rejected listing goes (back) into the
    // review queue. Editing an already-ACTIVE/PAUSED/CLOSED listing must
    // preserve its current status — publishing a small edit should never
    // silently demote a live listing back to "pending review".
    if (listing.status === "DRAFT" || listing.status === "REJECTED") {
      listing.status = "PENDING";
    }
    listing.publishedAt = listing.publishedAt || new Date();
    if (!listing.slug) listing.generateSlug();
    await listing.save();

    // Auto-sync nearby places the moment a pin exists or moves — this is
    // what makes "Nearby Highlights" appear for every viewer with zero
    // clicks. Recompute when the pin is new/changed, never attempted
    // before, OR the last attempt didn't get all 10 categories (a
    // transient key/IP/quota issue shouldn't leave some categories
    // permanently missing). Fire-and-forget so publish itself is never
    // slowed down waiting on Google.
    const pinChanged = listing.coordinates?.lat !== coordsBeforeSave.lat || listing.coordinates?.lng !== coordsBeforeSave.lng;
    const hasValidPin = listing.coordinates?.lat != null && listing.coordinates?.lng != null;
    const existingCache = listing.nearbyCache || {};
    if (hasValidPin && (pinChanged || !cacheAgeBeforeSave || !cacheCompleteBeforeSave)) {
      setImmediate(async () => {
        try {
          const { computeNearbyCache } = require("../utils/googleMaps");
          const result = await computeNearbyCache(listing.coordinates.lat, listing.coordinates.lng);

          if (result.complete) {
            // Merge, don't overwrite — if this attempt moved the pin, start
            // fresh; otherwise keep any previously-successful categories
            // that this attempt might have missed for an unrelated reason.
            const mergedCache = pinChanged ? result.cache : { ...existingCache, ...result.cache };
            await FlatmateListing.updateOne(
              { _id: listing._id },
              { $set: { nearbyCache: mergedCache, nearbyCacheAt: new Date(), nearbyCacheComplete: result.allSucceeded } }
            );
            console.log(`✅ Nearby places cached for listing ${listing._id} (${result.successCount}/${result.attemptCount} categories succeeded${result.allSucceeded ? "" : " — will retry the rest on next publish"})`);
          } else {
            // Every category failed at the API-call level (e.g. a key/IP
            // restriction issue) — do NOT stamp nearbyCacheAt or
            // nearbyCacheComplete. Leaving them unset/false means the next
            // publish/edit will correctly retry this, instead of a fixable
            // problem getting permanently stuck.
            console.error(`🔴 Nearby cache computation completely failed for listing ${listing._id} — will retry on next publish.`);
          }
        } catch (e) {
          console.error("Nearby cache computation failed (non-critical):", e.message);
        }
      });
    }

    res.json({ success: true, redirect: `/flatmate/create-success/${listing._id}` });
  } catch (err) {
    console.error("Flatmate publish error:", err);
    res.status(500).json({ success: false, error: "Something went wrong publishing your listing. Please try again." });
  }
});

/* ─────────────────────────────────────────────
   SUCCESS  →  GET /flatmate/create-success/:id
───────────────────────────────────────────── */
router.get("/create-success/:id", requireStudent, async (req, res) => {
  try {
    const listing = await FlatmateListing.findOne({ _id: req.params.id, student: req.student.id }).lean();
    if (!listing) return res.redirect("/flatmate");
    res.render("flatmate/create-success", { listing });
  } catch (err) {
    console.error("Flatmate create-success error:", err);
    res.redirect("/flatmate");
  }
});

/* ─────────────────────────────────────────────
   MY LISTINGS  →  GET /flatmate/my-listings
   Must stay registered before the /:slug catch-all (same reason as
   /create, /results, /create-success/:id — it's a single path segment).
───────────────────────────────────────────── */
router.get("/my-listings", requireStudent, async (req, res) => {
  try {
    const listings = await FlatmateListing.find({ student: req.student.id })
      .sort({ createdAt: -1 })
      .lean();

    const listingIds = listings.map((l) => l._id);
    const connectionCounts = await FlatmateConnection.aggregate([
      { $match: { receiverListing: { $in: listingIds } } },
      { $group: { _id: { listing: "$receiverListing", status: "$status" }, count: { $sum: 1 } } },
    ]);
    const countsByListing = {};
    connectionCounts.forEach((c) => {
      const key = c._id.listing.toString();
      if (!countsByListing[key]) countsByListing[key] = { pending: 0, accepted: 0 };
      if (c._id.status === "pending") countsByListing[key].pending = c.count;
      if (c._id.status === "accepted") countsByListing[key].accepted = c.count;
    });

    const withCounts = listings.map((l) => ({
      ...l,
      requestCount: countsByListing[l._id.toString()]?.pending || 0,
      connectedCount: countsByListing[l._id.toString()]?.accepted || 0,
    }));

    res.render("flatmate/my-listings", { listings: withCounts });
  } catch (err) {
    console.error("My Listings error:", err);
    res.status(500).send("Something went wrong loading your listings. Please try again.");
  }
});

/* ─────────────────────────────────────────────
   LISTING STATUS ACTIONS
   All verify ownership (student === req.student.id) as the real
   security gate — never trust a hidden form field for this.
───────────────────────────────────────────── */
router.post("/listing/:id/pause", requireStudent, async (req, res) => {
  try {
    const listing = await FlatmateListing.findOne({ _id: req.params.id, student: req.student.id });
    if (!listing) return res.json({ success: false, error: "Listing not found." });
    if (listing.status !== "ACTIVE") return res.json({ success: false, error: "Only active listings can be paused." });
    listing.status = "PAUSED";
    await listing.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Pause listing error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

router.post("/listing/:id/reactivate", requireStudent, async (req, res) => {
  try {
    const listing = await FlatmateListing.findOne({ _id: req.params.id, student: req.student.id });
    if (!listing) return res.json({ success: false, error: "Listing not found." });
    if (listing.status !== "PAUSED") return res.json({ success: false, error: "Only paused listings can be reactivated." });
    listing.status = "ACTIVE";
    await listing.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Reactivate listing error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

router.post("/listing/:id/close", requireStudent, async (req, res) => {
  try {
    const listing = await FlatmateListing.findOne({ _id: req.params.id, student: req.student.id });
    if (!listing) return res.json({ success: false, error: "Listing not found." });
    if (!["ACTIVE", "PAUSED", "PENDING"].includes(listing.status)) {
      return res.json({ success: false, error: "This listing can't be closed." });
    }
    listing.status = "CLOSED";
    await listing.save();
    // Existing connections/conversations intentionally survive — only new
    // requests stop, per spec. Nothing to clean up here.
    res.json({ success: true });
  } catch (err) {
    console.error("Close listing error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

router.post("/listing/:id/delete", requireStudent, async (req, res) => {
  try {
    const listing = await FlatmateListing.findOne({ _id: req.params.id, student: req.student.id });
    if (!listing) return res.json({ success: false, error: "Listing not found." });
    // Only DRAFTs can be hard-deleted — anything ever published may have
    // real FlatmateConnections/Conversations pointing at it, and those
    // relationships must never silently break. Use Close for those instead.
    if (listing.status !== "DRAFT") {
      return res.json({ success: false, error: "Only drafts can be deleted. Use Close for a published listing." });
    }
    await FlatmateListing.deleteOne({ _id: listing._id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete listing error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   REQUEST TO CONNECT  →  POST /flatmate/connect
   Creates a FlatmateConnection. Server-side duplicate protection —
   never relies on the frontend disabling the button.
───────────────────────────────────────────── */
router.post("/connect", requireStudent, async (req, res) => {
  try {
    const { listingId, message } = req.body;
    const listing = await FlatmateListing.findById(listingId);

    if (!listing || listing.status !== "ACTIVE") {
      return res.json({ success: false, error: "This listing is no longer available." });
    }
    if (listing.student.toString() === req.student.id) {
      return res.json({ success: false, error: "You can't request to connect on your own listing." });
    }

    const blocked = await Block.findOne({
      $or: [
        { blocker: req.student.id, blocked: listing.student },
        { blocker: listing.student, blocked: req.student.id },
      ],
    });
    if (blocked) {
      return res.json({ success: false, error: "You can't connect with this user." });
    }

    const existing = await FlatmateConnection.findOne({
      requester: req.student.id,
      receiverListing: listing._id,
      status: { $in: ["pending", "accepted"] },
    });
    if (existing) {
      return res.json({
        success: false,
        error: existing.status === "accepted" ? "You're already connected on this listing." : "You already have a pending request for this listing.",
      });
    }

    // Optional context: the requester's own most recent active listing, if any.
    const requesterListing = await FlatmateListing.findOne({ student: req.student.id, status: "ACTIVE" }).sort({ createdAt: -1 });

    const connection = await FlatmateConnection.create({
      requester: req.student.id,
      receiver: listing.student,
      receiverListing: listing._id,
      requesterListing: requesterListing ? requesterListing._id : null,
      message: (message || "").trim().slice(0, 500),
      status: "pending",
    });

    // WhatsApp notify the listing owner — non-critical: the request is
    // already saved above regardless of whether this succeeds. Uses the
    // existing utils/leadWhatsapp.js template-message sender (the same
    // one studentRoutes.js already uses for PG enquiry notifications),
    // since a business-initiated message like this needs an approved
    // Meta template, not a plain-text session message.
    setImmediate(async () => {
      try {
        const { sendTemplateMessage } = require("../utils/leadWhatsapp");
        const [requesterDoc, receiverDoc] = await Promise.all([
          Student.findById(req.student.id).select("firstName"),
          Student.findById(listing.student).select("phone"),
        ]);
        if (!receiverDoc?.phone) return;
        const result = await sendTemplateMessage(
          receiverDoc.phone,
          FLATMATE_WA_TEMPLATES.requestReceived,
          [requesterDoc?.firstName || "Someone", `${listing.bhk} BHK · ${listing.area}, ${listing.city}`]
        );
        if (result.success) console.log(`✅ Flatmate request WA notify → ${receiverDoc.phone}`);
        else console.error("🔴 Flatmate request WA notify failed:", result.error);
      } catch (e) {
        console.error("WA flatmate-request notify failed (non-critical):", e.message);
      }
    });

    res.json({ success: true, connectionId: connection._id.toString() });
  } catch (err) {
    console.error("Flatmate connect error:", err);
    res.status(500).json({ success: false, error: "Something went wrong sending your request." });
  }
});

/* ─────────────────────────────────────────────
   CANCEL REQUEST  →  POST /flatmate/connection/:id/cancel
   Only the original requester can cancel, and only while pending.
───────────────────────────────────────────── */
router.post("/connection/:id/cancel", requireStudent, async (req, res) => {
  try {
    const connection = await FlatmateConnection.findOne({
      _id: req.params.id, requester: req.student.id, status: "pending",
    });
    if (!connection) {
      return res.json({ success: false, error: "Request not found or already handled." });
    }
    connection.status = "cancelled";
    connection.cancelledAt = new Date();
    await connection.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Flatmate cancel connection error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   FEEDBACK STUB  →  POST /flatmate/feedback
   (unchanged from earlier phase — no model yet, just acknowledges)
───────────────────────────────────────────── */
router.post("/feedback", async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    if (!message || !message.trim()) {
      return res.json({ success: false, error: "Please write a short message." });
    }
    console.log("New Flatmate feedback:", { name, rating, message });
    res.json({ success: true });
  } catch (err) {
    console.error("Flatmate feedback error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   NEARBY PLACES  →  GET /flatmate/:slug/nearby?category=metro
   Public (no auth required) — uses the listing's coordinates
   server-side to compute results, but the response never includes
   those coordinates, only nearby place names/distances/ratings. That's
   the same privacy trade-off real-estate sites make everywhere:
   "nearby amenities" without revealing the exact address.
───────────────────────────────────────────── */
router.get("/:slug/nearby", async (req, res) => {
  try {
    const { searchNearby } = require("../utils/googleMaps");
    const category = req.query.category;

    const listing = await FlatmateListing.findOne({ slug: req.params.slug })
      .select("+coordinates.lat +coordinates.lng");
    if (!listing) return res.status(404).json({ success: false, error: "Listing not found." });
    if (listing.coordinates?.lat == null || listing.coordinates?.lng == null) {
      return res.json({ success: false, error: "This listing doesn't have a pinned location yet." });
    }

    const result = await searchNearby(listing.coordinates.lat, listing.coordinates.lng, category);
    res.json(result);
  } catch (err) {
    console.error("Nearby places error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   ROUTE TO NEARBY PLACE  →  GET /flatmate/:slug/route
   ?destLat=&destLng=&mode=driving|walking|transit
   Same privacy note as /nearby above — the listing's coordinates are
   used as the route origin server-side, never returned to the client.
───────────────────────────────────────────── */
router.get("/:slug/route", async (req, res) => {
  try {
    const { computeRoute } = require("../utils/googleMaps");
    const { destLat, destLng, mode } = req.query;

    const listing = await FlatmateListing.findOne({ slug: req.params.slug })
      .select("+coordinates.lat +coordinates.lng");
    if (!listing) return res.status(404).json({ success: false, error: "Listing not found." });
    if (listing.coordinates?.lat == null || listing.coordinates?.lng == null) {
      return res.json({ success: false, error: "This listing doesn't have a pinned location yet." });
    }
    const dLat = parseFloat(destLat), dLng = parseFloat(destLng);
    if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) {
      return res.status(400).json({ success: false, error: "Invalid destination coordinates." });
    }

    const result = await computeRoute(listing.coordinates.lat, listing.coordinates.lng, dLat, dLng, mode);
    res.json(result);
  } catch (err) {
    console.error("Route computation error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   REVERSE GEOCODE  →  GET /flatmate/geocode/reverse?lat=&lng=
   Used by the create wizard's map-pin picker when a student drags the
   marker, to auto-fill a readable area/city. Auth-gated since it's
   part of the authenticated creation flow, not a public utility.
───────────────────────────────────────────── */
router.get("/geocode/reverse", requireStudent, async (req, res) => {
  try {
    const { reverseGeocode } = require("../utils/googleMaps");
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, error: "Invalid coordinates." });
    }
    const result = await reverseGeocode(lat, lng);
    res.json(result);
  } catch (err) {
    console.error("Reverse geocode route error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

/* ─────────────────────────────────────────────
   LISTING DETAIL  →  GET /flatmate/:slug
   MUST be the last GET route in this file — it's a catch-all single
   path segment, so anything registered after it would be shadowed.

   Privacy: the listing is fetched WITHOUT contact.phone/whatsapp/address
   (schema default, select:false). Those are only re-fetched with an
   explicit .select("+contact.phone ...") if the viewer is the owner OR
   has an "accepted" FlatmateConnection on this exact listing — never
   based on anything the client sends.
───────────────────────────────────────────── */
router.get("/:slug", optionalAuth, async (req, res) => {
  try {
    const listing = await FlatmateListing.findOne({ slug: req.params.slug })
      .populate("student", "firstName lastName")
      .lean();

    if (!listing) {
      return res.status(404).render("flatmate/listing-detail", {
        listing: null, isOwner: false, cta: null, connection: null, seo: null,
        mapData: null, googleMapsApiKey: null, isSaved: false, conversationId: null,
      });
    }

    const viewerId = req.student?.id || null;
    const isOwner = !!(viewerId && listing.student && listing.student._id.toString() === viewerId);

    // Only look up a connection when the viewer isn't the owner — an owner
    // never needs one to see their own listing's private fields.
    let connection = null;
    if (viewerId && !isOwner) {
      // First: are these two people already connected via ANY listing
      // between them (either direction — either could have sent the
      // original request)? Being accepted once should carry over to every
      // listing between the same two people — you shouldn't have to
      // re-request just because you're viewing their other listing.
      connection = await FlatmateConnection.findOne({
        status: "accepted",
        $or: [
          { requester: viewerId, receiver: listing.student },
          { requester: listing.student, receiver: viewerId },
        ],
      }).sort({ updatedAt: -1 }).lean();

      // Otherwise, fall back to whatever the viewer's own history is on
      // THIS specific listing (a pending request they sent, a decline,
      // a cancellation, etc.) — this part stays listing-scoped, since a
      // pending request is inherently about one specific listing.
      if (!connection) {
        connection = await FlatmateConnection.findOne({
          requester: viewerId,
          receiverListing: listing._id,
        }).sort({ createdAt: -1 }).lean();
      }
    }

    // Contact info (phone/WhatsApp/address) is never shown on the listing
    // page — it's intentionally not fetched here at all, so there's
    // nothing to accidentally leak even if the template changes later.
    // Only the map coordinates are public (shown to everyone).
    const withCoords = await FlatmateListing.findOne({ slug: req.params.slug })
      .select("+coordinates.lat +coordinates.lng +placeId")
      .lean();
    listing.coordinates = withCoords.coordinates;
    listing.placeId = withCoords.placeId;

    // Map data: precise pin whenever the listing has one — public now, not
    // gated by connection status. Falls back to an approximate city-level
    // center only when the listing was never pinned at all.
    const CITY_CENTERS = {
      "Mumbai": { lat: 19.0760, lng: 72.8777 },
      "Navi Mumbai": { lat: 19.0330, lng: 73.0297 },
      "Pune": { lat: 18.5204, lng: 73.8567 },
      "Bengaluru": { lat: 12.9716, lng: 77.5946 },
      "Delhi NCR": { lat: 28.7041, lng: 77.1025 },
      "Hyderabad": { lat: 17.3850, lng: 78.4867 },
    };
    const hasPreciseCoords = listing.coordinates?.lat != null && listing.coordinates?.lng != null;
    const mapData = {
      precise: hasPreciseCoords,
      lat: hasPreciseCoords ? listing.coordinates.lat : (CITY_CENTERS[listing.city]?.lat ?? 20.5937),
      lng: hasPreciseCoords ? listing.coordinates.lng : (CITY_CENTERS[listing.city]?.lng ?? 78.9629),
      zoom: hasPreciseCoords ? 15 : 12,
    };

    // CTA state machine (see spec section 50 / doc7 section 8)
    let cta = "connect";
    if (isOwner) {
      cta = "manage";
    } else if (listing.status !== "ACTIVE") {
      cta = "closed";
    } else if (connection) {
      if (connection.status === "pending")       cta = "pending_sent";
      else if (connection.status === "accepted") cta = "connected";
      else if (connection.status === "blocked")  cta = "blocked";
      // declined / cancelled / ended → fall through to "connect" (re-request allowed)
    }

    // Fire-and-forget view counter — never block the render on it, and
    // never inflate it when the owner views their own listing.
    if (!isOwner) {
      FlatmateListing.updateOne({ _id: listing._id }, { $inc: { views: 1 } }).catch(() => {});
    }

    // Recently Viewed (logged-in students only, and not the owner viewing
    // their own listing — non-blocking, non-critical)
    if (viewerId && !isOwner) {
      require("../utils/recentlyViewed").trackView(viewerId, "flatmate", listing._id);
    }

    const savedSet = await buildSavedSet(viewerId, [listing]);

    // If connected, resolve the real conversation so "Chat Now" actually
    // goes somewhere.
    let conversationId = null;
    if (connection && connection.status === "accepted") {
      const conv = await Conversation.findOne({ connection: connection._id }).select("_id").lean();
      conversationId = conv ? conv._id.toString() : null;
    }

    res.render("flatmate/listing-detail", {
      listing, isOwner, cta, connection, conversationId,
      isSaved: savedSet.has(listing._id.toString()),
      seo: buildListingSeo(listing),
      mapData,
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null,
    });
  } catch (err) {
    console.error("Flatmate detail route error:", err);
    res.status(500).send("Something went wrong loading this listing. Please try again.");
  }
});

module.exports = router;