const express = require("express");
const router = express.Router();
const Listing = require("../models/listingProperty");

// ─────────────────────────────────────────────
// HOME / FIND PAGE  →  GET /findHostels
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const listings = await Listing.find({
      // isActive: true,
      // isApproved: true,
    })
      .limit(24)
      .sort({ createdAt: -1 });

    console.log("Home Page loaded '/' route");
    res.render("listings/findHostels", {
      listings,
      student: res.locals.student || null,
    });
  } catch (err) {
    console.error("❌ findHostels error:", err);
    res.status(500).send("Server Error");
  }
});

// ─────────────────────────────────────────────
// SEARCH RESULTS  →  GET /findHostels/results
// ─────────────────────────────────────────────
router.get("/results", async (req, res) => {
  try {
    const {
      college = "",   // free-text: college name OR area OR city
      budget,         // max monthly price
      gender,         // boys | girls | coed | ""
      type,           // hostel | pg | flat | ""
      sort = "newest", // newest | price_asc | price_desc | rating | views
      amenities,      // comma-separated list e.g. "WiFi,AC,Meals"
      roomType,       // single | double | triple | dormitory
      page = 1,
    } = req.query;

    const PAGE_SIZE = 12;
    const skip = (parseInt(page) - 1) * PAGE_SIZE;

    // ── Build Mongo filter ──────────────────────────────────────
    const filter = {};

    // 1. Text search across title, city, address, nearCollege
    if (college.trim()) {
      const regex = new RegExp(college.trim(), "i");
      filter.$or = [
        { title: regex },
        { "location.city": regex },
        { "location.address": regex },
        { "location.nearCollege": regex },
        { description: regex },
      ];
    }

    // 2. Gender
    if (gender && gender !== "") {
      const gMap = { boys: "Boys", girls: "Girls", coed: "Co-ed" };
      filter.gender = gMap[gender] || new RegExp(gender, "i");
    }

    // 3. Budget (startingPrice ≤ budget)
    if (budget && !isNaN(budget)) {
      filter.startingPrice = { $lte: parseInt(budget) };
    }

    // 4. Property type
    if (type && type !== "") {
      const tMap = { hostel: "Hostel", pg: "PG", flat: "Flat" };
      filter.propertyType = tMap[type] || new RegExp(type, "i");
    }

    // 5. Amenities (must have ALL selected)
    if (amenities) {
      const list = amenities.split(",").map((a) => a.trim()).filter(Boolean);
      if (list.length) {
        filter.amenities = { $all: list.map((a) => new RegExp(a, "i")) };
      }
    }

    // 6. Room type
    if (roomType && roomType !== "") {
      const rtMap = {
        single: "Single",
        double: "Double",
        triple: "Triple",
        dormitory: "Dormitory",
      };
      filter["rooms.type"] = new RegExp(rtMap[roomType] || roomType, "i");
    }

    // ── Sorting ─────────────────────────────────────────────────
    const sortMap = {
      newest:     { createdAt: -1 },
      price_asc:  { startingPrice: 1 },
      price_desc: { startingPrice: -1 },
      rating:     { rating: -1 },
      views:      { views: -1 },
    };
    const sortObj = sortMap[sort] || { createdAt: -1 };

    // ── Query ───────────────────────────────────────────────────
    const [listings, total] = await Promise.all([
      Listing.find(filter).sort(sortObj).skip(skip).limit(PAGE_SIZE),
      Listing.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    res.render("listings/findHostels-results", {
      listings,
      total,
      totalPages,
      currentPage: parseInt(page),
      query: {
        college,
        budget,
        gender,
        type,
        sort,
        amenities,
        roomType,
      },
      student: res.locals.student || null,
    });
  } catch (err) {
    console.error("❌ Search results error:", err);
    res.status(500).send("Server Error");
  }
});

// ─────────────────────────────────────────────
// HOSTEL DETAIL  →  GET /hostel/:slug
// ─────────────────────────────────────────────
router.get("/hostel/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const listing = await Listing.findOneAndUpdate(
      { slug },
      { $inc: { views: 2 } },
      { new: true }
    ).populate("owner");

    if (!listing) return res.status(404).send("Hostel not found");

    let studentReview = null;
    if (req.student) {
      studentReview =
        listing.reviews.find(
          (rv) => rv.student?.toString() === req.student.id
        ) || null;
    }

    const similar = await Listing.find({
      "location.city": listing.location.city,
      _id: { $ne: listing._id },
    }).limit(4);

    res.render("listings/hostel-view.ejs", {
      hostel: listing,
      similar,
      studentReview,
      breadcrumb: true,
    });
  } catch (err) {
    console.error("❌ Hostel view error:", err);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
