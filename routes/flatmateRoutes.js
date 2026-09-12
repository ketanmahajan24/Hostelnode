// ================= flatmateRoutes.js =============================
/* ============================================================
   flatmateRoutes.js — HostelNode Flatmate feature
   - GET /flatmate          → Landing page (hero, search, city chips,
                              featured flats & flatmates, how it works, etc.)
                              Renders views/flatmate/flatmate.ejs.
                              If a real search/filter is present in the
                              query string, redirects to /flatmate/results
                              so a "search" always opens a dedicated
                              results page — the landing page itself
                              never shows a filtered grid.
   - GET /flatmate/results  → Dedicated search-results page, laid out the
                              same way as /findHostels/results (sticky
                              topbar, sidebar filters, swipeable image
                              cards, sort, pagination, mobile filter
                              drawer). Renders views/flatmate/flatmate-results.ejs.
   NOTE: There is no Flatmate model/collection yet. Both routes serve
   SAMPLE data so the UI is fully viewable end to end. Swap
   SAMPLE_LISTINGS for a real Mongoose query (with real .skip()/.limit()
   pagination) once the Flatmate schema exists. All counts shown in the
   UI are computed from this array — nothing is hard-coded in the view.
============================================================ */

const express = require("express");
const router  = express.Router();

// Fixed city set used for quick-filter pills
const CITIES = ["Mumbai", "Navi Mumbai", "Pune", "Bengaluru", "Delhi NCR", "Hyderabad"];
const RESULTS_PAGE_SIZE = 9;

// ─────────────────────────────────────────────
// TEMP SAMPLE DATA (replace with FlatmateListing.find(...))
// "have" listings use an images[] array so the results-page card can
// demonstrate the same swipeable multi-photo slider as /findHostels/results.
// ─────────────────────────────────────────────
const SAMPLE_LISTINGS = [
  { _id: "s1",  type: "have", city: "Mumbai",       bhk: 2, roomType: "Private Room", location: "Powai",            gender: "any",    rent: 14000, moveIn: "1 Oct",   postedBy: "Rahul",
    images: [
      "https://cf.bstatic.com/xdata/images/hotel/max1024x768/542608327.jpg?k=281c15e9f915014269a9f2bfc531bb2e5e847de13edb47731bce3e10f0675c3a&o=",
      "https://imagecdn.99acres.com/media1/40931/4/818624697M-1786799944191.jpg",
    ] },
  { _id: "s2",  type: "need", city: "Mumbai",       bhk: 1, roomType: "Any",           location: "Andheri West",     gender: "female", budgetMin: 9000,  budgetMax: 14000, moveIn: "5 Oct",  postedBy: "Priya" },
  { _id: "s3",  type: "have", city: "Mumbai",       bhk: 1, roomType: "Shared Room",   location: "Malad",            gender: "male",   rent: 7500,  moveIn: "15 Sept", postedBy: "Karan",
    images: ["https://imagecdn.99acres.com/media1/40928/10/818570917M-1786793808662.jpg"] },
  { _id: "s4",  type: "have", city: "Navi Mumbai",  bhk: 2, roomType: "Private Room",  location: "Kharghar, Sector 12", gender: "any", rent: 10000, moveIn: "1 Oct",   postedBy: "Rahul",
    images: [
      "https://imagecdn.99acres.com/media1/40931/4/818624697M-1786799944191.jpg",
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQvt8v79KliIJRqSanU6hwFF0iADVRG2GnC0L2HFzkAlQ&s",
    ] },
  { _id: "s5",  type: "need", city: "Navi Mumbai",  bhk: 2, roomType: "Private Room",  location: "Nerul",            gender: "any",    budgetMin: 8000,  budgetMax: 12000, moveIn: "1 Oct",  postedBy: "Amit" },
  { _id: "s6",  type: "have", city: "Navi Mumbai",  bhk: 1, roomType: "Shared Room",   location: "Vashi",            gender: "male",   rent: 6500,  moveIn: "20 Sept", postedBy: "Sahil",
    images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQvt8v79KliIJRqSanU6hwFF0iADVRG2GnC0L2HFzkAlQ&s"] },
  { _id: "s7",  type: "have", city: "Pune",         bhk: 1, roomType: "Shared Room",   location: "Kondhwa Budruk",   gender: "male",   rent: 5500,  moveIn: "15 Sept", postedBy: "Sneha",
    images: [
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS9etHkCuHEC7zbolGtntprKTEOR8-5T34r4uX9h226Wg&s",
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQCJlpOx2lkLNy0iuN9r0plINYEcGXTR4SUvrcCQTp9-w&s=10",
    ] },
  { _id: "s8",  type: "have", city: "Pune",         bhk: 3, roomType: "Private Room",  location: "Mahalunge",        gender: "any",    rent: 15000, moveIn: "1 Oct",   postedBy: "Vikram",
    images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQCJlpOx2lkLNy0iuN9r0plINYEcGXTR4SUvrcCQTp9-w&s=10"] },
  { _id: "s9",  type: "have", city: "Pune",         bhk: 1, roomType: "Shared Room",   location: "Marunji",          gender: "any",    rent: 12000, moveIn: "1 Oct",   postedBy: "Karan",
    images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTEMOYEC9qOEIdCqOHBLM5gUGpU1kbsGyr9LG4fCyZkog&s=10"] },
  { _id: "s10", type: "need", city: "Pune",         bhk: 2, roomType: "Either",        location: "Koregaon Park",    gender: "female", budgetMin: 10000, budgetMax: 16000, moveIn: "10 Oct", postedBy: "Neha" },
  { _id: "s11", type: "have", city: "Bengaluru",    bhk: 2, roomType: "Private Room",  location: "Koramangala",      gender: "any",    rent: 16000, moveIn: "1 Oct",   postedBy: "Arjun",
    images: [
      "https://housing-images.n7net.in/01c16c28/639fe00b066e524fddbef5eb81018e73/v0/medium/1_bhk_independent_builder_floor-for-rent-chikkakannalli-Bengaluru-hall.jpg",
    ] },
  { _id: "s12", type: "need", city: "Bengaluru",    bhk: 1, roomType: "Any",           location: "HSR Layout",       gender: "male",   budgetMin: 9000,  budgetMax: 15000, moveIn: "5 Oct",  postedBy: "Rohit" },
  { _id: "s13", type: "have", city: "Delhi NCR",    bhk: 2, roomType: "Shared Room",   location: "Lajpat Nagar",     gender: "female", rent: 11000, moveIn: "1 Oct",   postedBy: "Anjali",
    images: ["https://s3.ap-south-1.amazonaws.com/prophunt.prod.fs/listings/6a5e1008a0ee7102aae9befd/images/img0.webp"] },
  { _id: "s14", type: "need", city: "Delhi NCR",    bhk: 1, roomType: "Private",       location: "Dwarka",           gender: "any",    budgetMin: 8000,  budgetMax: 13000, moveIn: "12 Oct", postedBy: "Vivek" },
  { _id: "s15", type: "have", city: "Hyderabad",    bhk: 2, roomType: "Private Room",  location: "Gachibowli",       gender: "any",    rent: 12500, moveIn: "1 Oct",   postedBy: "Kiran",
    images: ["https://cdn.sowerent.com/propertyowner/1baece87-2ab5-4a23-a7c6-a0b7a4a8c9e3/5e5e7c85-a3f6-4938-a0b5-f261a64d23f2_WhatsApp-Image-2024-06-19-at-31027-PM-(1).jpeg"] },
  { _id: "s16", type: "need", city: "Hyderabad",    bhk: 1, roomType: "Any",           location: "Madhapur",         gender: "male",   budgetMin: 7000,  budgetMax: 11000, moveIn: "8 Oct",  postedBy: "Sandeep" },
];

// Normalize the inconsistent free-text roomType values in the sample set
// into a simple private/shared/any bucket for filtering.
function roomTypeBucket(rt) {
  const s = (rt || "").toLowerCase();
  if (s.includes("private")) return "private";
  if (s.includes("shared"))  return "shared";
  return "any";
}

// Shared filtering logic used by /results (kept separate from "/" so the
// landing page never has to run/carry this — it only ever redirects).
function filterListings({ location = "", gender = "", type = "", budget = "", bhk = "", roomType = "" }) {
  let listings = SAMPLE_LISTINGS.slice();

  if (location) {
    const q = location.toLowerCase();
    listings = listings.filter(l =>
      l.city.toLowerCase().includes(q) || l.location.toLowerCase().includes(q)
    );
  }
  if (gender && gender !== "any") {
    listings = listings.filter(l => l.gender === "any" || l.gender === gender);
  }
  if (type === "need" || type === "have") {
    listings = listings.filter(l => l.type === type);
  }
  if (bhk) {
    listings = listings.filter(l => String(l.bhk) === String(bhk));
  }
  if (budget) {
    const max = parseInt(budget, 10);
    listings = listings.filter(l => (l.type === "have" ? l.rent : l.budgetMax) <= max);
  }
  if (roomType) {
    listings = listings.filter(l => roomTypeBucket(l.roomType) === roomType);
  }
  return listings;
}

function sortListings(listings, sort) {
  const price = l => (l.type === "have" ? l.rent : l.budgetMax);
  if (sort === "price_asc")  return listings.slice().sort((a, b) => price(a) - price(b));
  if (sort === "price_desc") return listings.slice().sort((a, b) => price(b) - price(a));
  return listings; // "newest" — sample array order stands in for createdAt desc
}

// ─────────────────────────────────────────────
// LANDING PAGE  →  GET /flatmate
// Always shows the clean marketing/landing state. If a search/filter
// query param is present (e.g. an old bookmarked link, or a city-chip
// click that somehow lands here), redirect straight to /flatmate/results
// so search results always live on their own page.
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const hasFilters = ["location", "gender", "type", "budget", "bhk"].some(
      key => req.query[key] && String(req.query[key]).trim() && req.query[key] !== "any"
    );
    if (hasFilters) {
      const qs = new URLSearchParams(req.query).toString();
      return res.redirect(302, `/flatmate/results${qs ? "?" + qs : ""}`);
    }

    const totalListingsCount = SAMPLE_LISTINGS.length;

    // "Featured Flats & Flatmates near you" — top of page, above the fold.
    // Swap this slice for a real query (e.g. Listing.find({featured:true})) once the model exists.
    const featuredListings = SAMPLE_LISTINGS.slice().reverse().slice(0, 8);

    const cityCounts = CITIES.map(city => ({
      name: city,
      count: SAMPLE_LISTINGS.filter(l => l.city === city).length,
    }));

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

// ─────────────────────────────────────────────
// SEARCH RESULTS  →  GET /flatmate/results
// Dedicated results page — same layout pattern as /findHostels/results:
// sticky topbar, sidebar filters, swipeable card grid, sort, pagination.
// ─────────────────────────────────────────────
router.get("/results", async (req, res) => {
  try {
    const {
      location = "", gender = "", type = "", budget = "", bhk = "",
      roomType = "", sort = "newest", page = "1",
    } = req.query;

    const filtered = filterListings({ location, gender, type, budget, bhk, roomType });
    const sorted   = sortListings(filtered, sort);

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE));
    const currentPage = Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages);
    const start = (currentPage - 1) * RESULTS_PAGE_SIZE;
    const listings = sorted.slice(start, start + RESULTS_PAGE_SIZE);

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

// ─────────────────────────────────────────────
// FEEDBACK STUB  →  POST /flatmate/feedback
// (client-side modal posts here; no model yet, just acknowledges receipt)
// ─────────────────────────────────────────────
router.post("/feedback", async (req, res) => {
  try {
    const { name, rating, message } = req.body;
    if (!message || !message.trim()) {
      return res.json({ success: false, error: "Please write a short message." });
    }
    console.log("New Flatmate feedback:", { name, rating, message });
    // TODO: persist to a Feedback model once one exists.
    res.json({ success: true });
  } catch (err) {
    console.error("Flatmate feedback error:", err);
    res.status(500).json({ success: false, error: "Something went wrong." });
  }
});

module.exports = router;