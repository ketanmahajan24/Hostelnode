// Public.js

const express = require("express");
const router = express.Router();

const Listing = require("../models/listingProperty");
const Student = require("../models/studentSchema");
const { optionalStudentAuth } = require("../Middlewares/jwtAuth");
const { logSearch } = require("../utils/searchLogger");
const { notifyOwnerOnView } = require("../utils/leadWhatsapp");

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

      notifyOwnerOnView({ student, listing }).catch(err =>
        console.error("WA view notify error:", err)
      );
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
      notifyOwnerOnView({ student: guestInfo, listing, isGuest: true }).catch(err =>
        console.error("WA guest view notify error:", err)
      );
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

    res.render("listings/hostel-view.ejs", {
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