// ================= findHostels-route.js =============================
/* ============================================================
   findHostels-route.js  —  Search & Listing Routes for HostelNode
   - GET /findHostels         → Search page + recent listings
   - GET /findHostels/results → Search results with filters + pagination
   - GET /hostel/:slug        → Individual hostel detail page
   Integrates smart search parsing, search logging, and WA lead alerts.
============================================================ */

const { optionalStudentAuth } = require("../Middlewares/jwtAuth");
const express = require("express");
const router  = express.Router();
const Student       = require("../models/studentSchema");
const Listing = require("../models/listingProperty");
const { parseSearchQuery } = require("../utils/smartSearch"); // ← new
const { logSearch }            = require("../utils/searchLogger");
const {
  notifyOwnersOnSearch,
  notifyOwnerOnView
} = require("../utils/leadWhatsapp");


// ─────────────────────────────────────────────
// HOME / FIND PAGE  →  GET /findHostels
// ─────────────────────────────────────────────
router.get("/", optionalStudentAuth, async (req, res) => {
  try {
    
     const student = req.student ? await Student.findById(req.student.id) : null;
    const listings = await Listing.find({ status: "Approved"})
      .limit(24)
      .sort({ createdAt: -1 });

    res.render("listings/findHostels", {
      listings,
      student: student || null,
    });
  } catch (err) {
    // console.error("❌ findHostels error:", err);
    res.status(500).send("Server Error");
  }
});

// ─────────────────────────────────────────────
// SEARCH RESULTS  →  GET /findHostels/results
// ─────────────────────────────────────────────
router.get("/results", optionalStudentAuth, async (req, res) => {
  try {
     const student = req.student ? await Student.findById(req.student.id) : null;
    const {
      college  = "",
      budget,
      gender,
      type,
      sort     = "newest",
      amenities,
      roomType,
      page     = 1,
    } = req.query;

    const PAGE_SIZE = 12;
    const skip      = (parseInt(page) - 1) * PAGE_SIZE;

    // ── 1. Parse natural language from the college/search field ──
    const parsed = parseSearchQuery(college);

    // ── 2. Build Mongo filter ────────────────────────────────────
   const filter = {
      status: "Approved"   // 🔥 ADD THIS
    };
    const orClauses = [];

    // ── Location / college text search ───────────────────────────
    if (college.trim()) {
      const rawRegex = new RegExp(college.trim(), "i");

      // Always try raw query against all text fields
      orClauses.push(
        { title:                  rawRegex },
        { description:            rawRegex },
        { "location.city":        rawRegex },
        { "location.address":     rawRegex },
        { "location.nearCollege": rawRegex },
      );

      // If parser extracted a specific city/area, add that too
      if (parsed.cityOrArea) {
        const cityRegex = new RegExp(parsed.cityOrArea, "i");
        orClauses.push(
          { "location.city":        cityRegex },
          { "location.address":     cityRegex },
          { "location.nearCollege": cityRegex },
        );
      }

      // If parser extracted a college name
      if (parsed.college) {
        const collegeRegex = new RegExp(parsed.college, "i");
        orClauses.push(
          { "location.nearCollege": collegeRegex },
          { title:                  collegeRegex },
          { description:            collegeRegex },
        );
      }

      filter.$or = orClauses;
    }

    // ── Gender ────────────────────────────────────────────────────
    // URL param takes priority; fallback to NL parsed
    const resolvedGender = gender || (parsed.gender ? {
      'Boys':'boys','Girls':'girls','Co-ed':'coed'
    }[parsed.gender] : '');

    if (resolvedGender) {
      const gMap = { boys:"Boys", girls:"Girls", coed:"Co-ed" };
      filter.gender = gMap[resolvedGender] || new RegExp(resolvedGender, "i");
    }

    // ── Property type ─────────────────────────────────────────────
    const resolvedType = type || (parsed.propertyType ? {
      'Hostel':'hostel','PG':'pg','Flat':'flat'
    }[parsed.propertyType] : '');

    if (resolvedType) {
      const tMap = { hostel:"Hostel", pg:"PG", flat:"Flat" };
      filter.propertyType = tMap[resolvedType] || new RegExp(resolvedType, "i");
    }

    // ── Budget ────────────────────────────────────────────────────
    const resolvedBudget = budget
      ? parseInt(budget)
      : parsed.budget || null;

    if (resolvedBudget) {
      filter.startingPrice = { $lte: resolvedBudget };
    }

    // ── Room type ─────────────────────────────────────────────────
    const resolvedRoomType = roomType || parsed.roomType;
    if (resolvedRoomType) {
      const rtMap = { single:"Single", double:"Double", triple:"Triple", dormitory:"Dormitory" };
      filter["rooms.type"] = new RegExp(rtMap[resolvedRoomType] || resolvedRoomType, "i");
    }

    // ── Amenities ─────────────────────────────────────────────────
    // Merge URL amenities + NL parsed amenities
    const urlAmenities = amenities
      ? amenities.split(",").map(a => a.trim()).filter(Boolean)
      : [];
    const allAmenities = [...new Set([...urlAmenities, ...parsed.amenities])];

    if (allAmenities.length) {
      filter.amenities = { $all: allAmenities.map(a => new RegExp(a, "i")) };
    }

    // ── Sorting ───────────────────────────────────────────────────
    const sortMap = {
      newest    : { createdAt: -1 },
      price_asc : { startingPrice: 1 },
      price_desc: { startingPrice: -1 },
      rating    : { rating: -1 },
      views     : { views: -1 },
    };
    const sortObj = sortMap[sort] || { createdAt: -1 };

    // ── Query ─────────────────────────────────────────────────────
    let [listings, total] = await Promise.all([
      Listing.find(filter).sort(sortObj).skip(skip).limit(PAGE_SIZE),
      Listing.countDocuments(filter),
    ]);

    // ── Fallback: if zero results and we had a location, try city-only ──
    if (total === 0 && (parsed.cityOrArea || parsed.college)) {
      const fallbackFilter = {
        status: "Approved"
      };

      if (parsed.cityOrArea) {
        const cr = new RegExp(parsed.cityOrArea, "i");
        fallbackFilter.$or = [
          { "location.city":        cr },
          { "location.address":     cr },
          { "location.nearCollege": cr },
        ];
      } else if (parsed.college) {
        const cr = new RegExp(parsed.college, "i");
        fallbackFilter.$or = [
          { "location.nearCollege": cr },
          { title: cr },
        ];
      }

      // Keep gender/type filters in fallback
      if (filter.gender)        fallbackFilter.gender        = filter.gender;
      if (filter.propertyType)  fallbackFilter.propertyType  = filter.propertyType;
      if (filter.startingPrice) fallbackFilter.startingPrice = filter.startingPrice;

      [listings, total] = await Promise.all([
        Listing.find(fallbackFilter).sort(sortObj).skip(skip).limit(PAGE_SIZE),
        Listing.countDocuments(fallbackFilter),
      ]);
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);
// ─────────────────────────────────────────────
// LOG SEARCH + SEND OWNER LEADS
// ─────────────────────────────────────────────

const collegeQuery = req.query.college || "";
const cityQuery    = parsed.cityOrArea || "";

await logSearch({
  req,
  searchType: "text_search",
  searchQuery: collegeQuery,
  resolvedCity: cityQuery,
  resolvedArea: parsed.college || cityQuery,
  resultsCount: listings.length,
});

// Send WhatsApp leads to owners
if (req.student && collegeQuery && collegeQuery.length > 2) {
  notifyOwnersOnSearch({
    student: student || null,
    area: parsed.college || collegeQuery,
    city: cityQuery,
  }).catch(err => console.error("WA notify error:", err));
}
    // Pass parsed info to template for displaying smart hints
    res.render("listings/findHostels-results", {
      listings,
      total,
      totalPages,
      currentPage : parseInt(page),
      query: {
        college,
        budget   : resolvedBudget ? String(resolvedBudget) : (budget || ''),
        gender   : resolvedGender,
        type     : resolvedType,
        sort,
        amenities: allAmenities.join(','),
        roomType : resolvedRoomType || '',
      },
      // Smart hints for UI display
      parsedHints: {
        city     : parsed.cityOrArea,
        college  : parsed.college,
        gender   : parsed.gender,
        type     : parsed.propertyType,
        roomType : parsed.roomType,
        amenities: parsed.amenities,
        budget   : parsed.budget,
      },
      student:  student || null,
    });

  } catch (err) {
    // console.error("❌ Search results error:", err);
    res.status(500).send("Server Error");
  }
});

// ─────────────────────────────────────────────
// HOSTEL DETAIL  →  GET /hostel/:slug
// ─────────────────────────────────────────────
// router.get("/hostel/:slug", async (req, res) => {
//   try {
//     const { slug } = req.params;

//     const listing = await Listing.findOneAndUpdate(
//         { slug, status: "Approved" },   // 🔥 ADD THIS
//       { $inc: { views: 2 } },
//       { new: true }
//     ).populate("owner");

//     if (!listing) return res.status(404).send("Hostel not found");

//     // ─────────────────────────────────────────────
// // LOG LISTING VIEW
// // ─────────────────────────────────────────────

// await logSearch({
//   req,
//   searchType: "listing_view",
//   searchQuery: listing.title,
//   resolvedCity: listing.location?.city || "",
//   resolvedArea: listing.location?.nearCollege || "",
//   resultsCount: 1,
// });

// // Send WhatsApp lead to owner
// if (req.student) {
//   notifyOwnerOnView({
//     student: req.student,
//     listing: listing,
//   }).catch(err => console.error("WA view notify error:", err));
// }

//     let studentReview = null;
//     if (req.student) {
//       studentReview = listing.reviews.find(
//         rv => rv.student?.toString() === req.student.id
//       ) || null;
//     }

//     const similar = await Listing.find({
//         status: "Approved",   // 🔥 ADD
//       "location.city": listing.location.city,
//       _id: { $ne: listing._id },
//     }).limit(4);

//     res.render("listings/hostel-view.ejs", {
//       hostel: listing,
//       similar,
//       studentReview,
//       breadcrumb: true,
//     });
//   } catch (err) {
//     // console.error("❌ Hostel view error:", err);
//     res.status(500).send("Server Error");
//   }
// });

module.exports = router;
