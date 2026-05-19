/* ============================================================
   routes/cityRoutes.js  —  HostelNode City Landing Pages
   Mount: app.use("/city", cityRouter)
   
   GET /city/:citySlug              → city landing page
   GET /city/:citySlug/:areaSlug    → area results (redirects to results)
   GET /sitemap.xml                 → auto-generated sitemap
============================================================ */

const express  = require("express");
const router   = express.Router();
const Listing  = require("../models/listingProperty");
const { getCityBySlug, getAreaBySlug, getAllCities } = require("../config/cityData");
const { logSearch } = require("../utils/searchLogger");

// Optional: student auth middleware (if you have one that doesn't redirect)
// Replace "optionalStudentAuth" with your actual middleware name
// It should set req.student if logged in, but not block if not logged in
const optionalStudentAuth = (req, res, next) => {
  // If you use JWT cookie:
  try {
    const jwt = require("jsonwebtoken");
    const token = req.cookies?.studentToken;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Fetch student from DB or just attach decoded payload
      req.student = decoded;
    }
  } catch (e) { /* not logged in, that's fine */ }
  next();
};

/* ============================================================
   GET /city/:citySlug  →  City landing page
   e.g. /city/mumbai
============================================================ */
router.get("/:citySlug", optionalStudentAuth, async (req, res) => {
  try {
    const cityData = getCityBySlug(req.params.citySlug);
    if (!cityData) return res.status(404).render("404.ejs", { message: "City not found" });

    // Fetch featured listings for this city (top 12)
    const listings = await Listing.find({
      status: "Approved",
      $or: [
        { "location.city": { $regex: cityData.name, $options: "i" } },
        { "location.state": { $regex: cityData.state, $options: "i" } },
        // also catch sub-areas
        ...cityData.areas.map(a => ({
          "location.nearCollege": { $regex: a.searchKey, $options: "i" }
        }))
      ]
    })
    .select("title slug images gender propertyType location startingPrice amenities rating reviewCount isVerified views contact")
    .sort({ views: -1, rating: -1 })
    .limit(12);

    // Count per area for the area chips
    const areaCountsRaw = await Promise.all(
      cityData.areas.map(async (area) => {
        const count = await Listing.countDocuments({
          status: "Approved",
          $or: [
            { "location.nearCollege": { $regex: area.searchKey, $options: "i" } },
            { "location.city":        { $regex: area.searchKey, $options: "i" } },
            { "location.address":     { $regex: area.searchKey, $options: "i" } },
          ]
        });
        return { ...area, count };
      })
    );
    // Sort areas by count descending
    const areaCounts = areaCountsRaw.sort((a, b) => b.count - a.count);

    const totalListings = await Listing.countDocuments({
      status: "Approved",
      "location.city": { $regex: cityData.name, $options: "i" }
    });

    // Log this city page visit
    await logSearch({
      req,
      searchType:   "city_page",
      searchQuery:  cityData.name,
      resolvedCity: cityData.name,
      resolvedArea: "",
      resultsCount: totalListings,
    });

    res.render("city/cityLanding.ejs", {
      cityData,
      listings,
      areaCounts,
      totalListings,
      student: req.student || null,
    });

  } catch (err) {
    console.error("City page error:", err);
    res.status(500).send("Server error");
  }
});

/* ============================================================
   GET /city/:citySlug/:areaSlug  →  Redirect to results page
   e.g. /city/mumbai/nerul  →  /findHostels/results?college=Nerul&city=Mumbai
============================================================ */
router.get("/:citySlug/:areaSlug", optionalStudentAuth, async (req, res) => {
  try {
    const cityData = getCityBySlug(req.params.citySlug);
    if (!cityData) return res.status(404).render("404.ejs", { message: "City not found" });

    const areaData = getAreaBySlug(req.params.citySlug, req.params.areaSlug);
    if (!areaData) {
      // If area not found, redirect to city page
      return res.redirect(`/city/${req.params.citySlug}`);
    }

    // Log area page visit
    await logSearch({
      req,
      searchType:   "area_page",
      searchQuery:  areaData.searchKey,
      resolvedCity: cityData.name,
      resolvedArea: areaData.name,
      resultsCount: 0,
    });

    // Redirect to existing results page with pre-filled filters
    res.redirect(`/findHostels/results?college=${encodeURIComponent(areaData.searchKey)}&city=${encodeURIComponent(cityData.name)}`);

  } catch (err) {
    console.error("Area redirect error:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;