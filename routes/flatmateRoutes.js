// ================= flatmateRoutes.js =============================
/* ============================================================
   flatmateRoutes.js — HostelNode Flatmate feature
   - GET /flatmate  →  Landing + search + city rows + mixed feed
   NOTE: There is no Flatmate model/collection yet. This route
   currently serves SAMPLE data so the UI is fully viewable end
   to end. Swap SAMPLE_LISTINGS for a real Mongoose query once
   the Flatmate schema + create/detail/request/chat routes exist.
============================================================ */

const express = require("express");
const router  = express.Router();

// Fixed city set shown in the "Browse by city" row + featured rows
const CITIES = ["Mumbai", "Navi Mumbai", "Pune", "Bengaluru", "Delhi NCR", "Hyderabad"];

// ─────────────────────────────────────────────
// TEMP SAMPLE DATA (replace with FlatmateListing.find(...))
// ─────────────────────────────────────────────
const SAMPLE_LISTINGS = [
  // ── Mumbai ──
  { _id: "s1",  type: "have", city: "Mumbai",       bhk: 2, roomType: "Private Room", location: "Powai",            gender: "any",    rent: 14000, moveIn: "1 Oct",   postedBy: "Rahul",  image: null },
  { _id: "s2",  type: "need", city: "Mumbai",       bhk: 1, roomType: "Any",           location: "Andheri West",     gender: "female", budgetMin: 9000,  budgetMax: 14000, moveIn: "5 Oct",  postedBy: "Priya" },
  { _id: "s3",  type: "have", city: "Mumbai",       bhk: 1, roomType: "Shared Room",   location: "Malad",            gender: "male",   rent: 7500,  moveIn: "15 Sept", postedBy: "Karan",  image: null },

  // ── Navi Mumbai ──
  { _id: "s4",  type: "have", city: "Navi Mumbai",  bhk: 2, roomType: "Private Room",  location: "Kharghar, Sector 12", gender: "any", rent: 10000, moveIn: "1 Oct",   postedBy: "Rahul",  image: null },
  { _id: "s5",  type: "need", city: "Navi Mumbai",  bhk: 2, roomType: "Private Room",  location: "Nerul",            gender: "any",    budgetMin: 8000,  budgetMax: 12000, moveIn: "1 Oct",  postedBy: "Amit" },
  { _id: "s6",  type: "have", city: "Navi Mumbai",  bhk: 1, roomType: "Shared Room",   location: "Vashi",            gender: "male",   rent: 6500,  moveIn: "20 Sept", postedBy: "Sahil",  image: null },

  // ── Pune ──
  { _id: "s7",  type: "have", city: "Pune",         bhk: 1, roomType: "Shared Room",   location: "Kondhwa Budruk",   gender: "male",   rent: 5500,  moveIn: "15 Sept", postedBy: "Sneha",  image: null },
  { _id: "s8",  type: "have", city: "Pune",         bhk: 3, roomType: "Private Room",  location: "Mahalunge",        gender: "any",    rent: 15000, moveIn: "1 Oct",   postedBy: "Vikram", image: null },
  { _id: "s9",  type: "have", city: "Pune",         bhk: 1, roomType: "Shared Room",   location: "Rajiv Gandhi Infotech Park, Marunji", gender: "any", rent: 12000, moveIn: "1 Oct", postedBy: "Karan", image: null },
  { _id: "s10", type: "need", city: "Pune",         bhk: 2, roomType: "Either",        location: "Koregaon Park",    gender: "female", budgetMin: 10000, budgetMax: 16000, moveIn: "10 Oct", postedBy: "Neha" },

  // ── Bengaluru ──
  { _id: "s11", type: "have", city: "Bengaluru",    bhk: 2, roomType: "Private Room",  location: "Koramangala",      gender: "any",    rent: 16000, moveIn: "1 Oct",   postedBy: "Arjun",  image: null },
  { _id: "s12", type: "need", city: "Bengaluru",    bhk: 1, roomType: "Any",           location: "HSR Layout",       gender: "male",   budgetMin: 9000,  budgetMax: 15000, moveIn: "5 Oct",  postedBy: "Rohit" },

  // ── Delhi NCR ──
  { _id: "s13", type: "have", city: "Delhi NCR",    bhk: 2, roomType: "Shared Room",   location: "Lajpat Nagar",     gender: "female", rent: 11000, moveIn: "1 Oct",   postedBy: "Anjali", image: null },
  { _id: "s14", type: "need", city: "Delhi NCR",    bhk: 1, roomType: "Private",       location: "Dwarka",           gender: "any",    budgetMin: 8000,  budgetMax: 13000, moveIn: "12 Oct", postedBy: "Vivek" },

  // ── Hyderabad ──
  { _id: "s15", type: "have", city: "Hyderabad",    bhk: 2, roomType: "Private Room",  location: "Gachibowli",       gender: "any",    rent: 12500, moveIn: "1 Oct",   postedBy: "Kiran",  image: null },
  { _id: "s16", type: "need", city: "Hyderabad",    bhk: 1, roomType: "Any",           location: "Madhapur",         gender: "male",   budgetMin: 7000,  budgetMax: 11000, moveIn: "8 Oct",  postedBy: "Sandeep" },
];

// ─────────────────────────────────────────────
// LANDING / SEARCH / CITY ROWS / FEED  →  GET /flatmate
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { location = "", gender = "", type = "", budget = "", bhk = "" } = req.query;

    // ── Featured city rows: always computed from the FULL unfiltered set ──
    const cityRows = CITIES
      .map(city => ({
        city,
        listings: SAMPLE_LISTINGS.filter(l => l.city === city).slice(0, 8),
      }))
      .filter(row => row.listings.length > 0);

    const cityCounts = CITIES.map(city => ({
      name: city,
      count: SAMPLE_LISTINGS.filter(l => l.city === city).length,
    }));

    // ── Main "All listings" feed: filtered by search bar params ──
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

    res.render("flatmate/flatmate", {
      listings,
      cityRows,
      cityCounts,
      filters: { location, gender, type, budget, bhk },
    });
  } catch (err) {
    console.error("Flatmate route error:", err);
    res.status(500).send("Server Error");
  }
});

module.exports = router;