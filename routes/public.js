// Public.js

const express = require("express");
const router = express.Router();

const Listing = require("../models/listingProperty");
const Student = require("../models/studentSchema");
const { optionalStudentAuth } = require("../Middlewares/jwtAuth");
const { logSearch } = require("../utils/searchLogger");
const { sendWAMessage, sendTemplateMessage } = require("../utils/leadWhatsapp");

async function getFullStudent(req) {
  if (!req.student?.id) return null;
  try {
    return await Student.findById(req.student.id).lean();
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   HOME  →  GET /
───────────────────────────────────────────────────────────── */
router.get("/", optionalStudentAuth, async (req, res) => {
  try {
    const [listings, student] = await Promise.all([
      Listing.find({ status: "Approved" }).limit(24).sort({ createdAt: -1 }),
      getFullStudent(req),
    ]);
    res.render("listings/findHostels", { listings, student });
  } catch (err) {
    console.error("❌ Home page error:", err);
    res.status(500).send("Server Error");
  }
});

/* ─────────────────────────────────────────────────────────────
   TEMP LANDING PAGE  →  GET /StartManagingYourHostel
───────────────────────────────────────────────────────────── */
router.get("/StartManagingYourHostel", async (req, res) => {
  res.render("lendingPage.ejs");
});

/* ─────────────────────────────────────────────────────────────
   HOSTEL VIEW  →  GET /hostel/:slug
───────────────────────────────────────────────────────────── */
router.get("/hostel/:slug", optionalStudentAuth, async (req, res) => {
  try {
    const { slug } = req.params;
    const student = await getFullStudent(req);

    const listing = await Listing.findOneAndUpdate(
      { slug, status: "Approved" },
      student ? { $inc: { views: 2 } } : {},
      { new: true }
    ).populate("owner");

    if (!listing) return res.status(404).send("Hostel not found");

    // Recently Viewed (logged-in students only — non-blocking, non-critical)
    if (student) {
      require("../utils/recentlyViewed").trackView(student._id, "pg", listing._id);
    }

    // ── WA LEAD — logged in student ne dekha ──
    if (student) {
      await logSearch({
        req,
        searchType: "listing_view",
        searchQuery: listing.title,
        resolvedCity: listing.location?.city || "",
        resolvedArea: listing.location?.nearCollege || "",
        resultsCount: 1,
      });

    
    }

    // ── WA LEAD — guest ne dekha (requireLogin mode) ──
    // student nahi hai to bhi owner ko notify karo ki koi dekh raha hai
    if (!student) {
      const guestInfo = {
        firstName: "Guest",
        lastName: "User",
        phone: "Unknown",
        city: req.headers['x-forwarded-for'] || "Unknown location",
      };
       
    }

    let studentReview = null;
    if (student) {
      studentReview =
        listing.reviews.find(
          rv => rv.student?.toString() === student._id.toString()
        ) || null;
    }

    const similar = await Listing.find({
      status: "Approved",
      "location.city": listing.location.city,
      _id: { $ne: listing._id },
    }).limit(4);

    // Property Operations Phase 8: "Book" on room types with free beds (only when the owner switched booking on).
    let hnBook = null;
    try {
      const av = await require("../utils/bookings").bookability(listing.toObject());
      if (av.on) hnBook = { id: String(listing._id), types: av.types.map(t => ({ i: t.i, can: t.can, free: t.free, amount: t.amount })), free: av.types.reduce((s, t) => s + (t.can ? t.free : 0), 0),
        from: Math.min(...av.types.filter(t => t.can).map(t => t.amount).concat([Infinity])) };
    } catch (e) { console.error("Listing booking (non-fatal):", e.message); }

    res.render("listings/hostel-view.ejs", {
      hnBook,
      hostel: listing,
      similar,
      student,
      studentReview,
      breadcrumb: true,
      requireLogin: !student,
    });

  } catch (err) {
    console.error("❌ Hostel view error:", err);
    res.status(500).send("Server Error");
  }
});
module.exports = router;