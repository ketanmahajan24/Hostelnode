// ================= flatmateRoutes.js =============================
/* ============================================================
   flatmateRoutes.js — HostelNode Flatmate feature
   - GET /flatmate  →  Landing + search + across-India strip + feed
   NOTE: There is no Flatmate model/collection yet. This route
   currently serves SAMPLE data so the UI is fully viewable end
   to end. Swap SAMPLE_LISTINGS for a real Mongoose query once
   the Flatmate schema + create/detail/request/chat routes exist.
   All counts shown in the UI (tabs, stats, city pills) are
   computed from this array — nothing is hard-coded in the view.
============================================================ */

const express = require("express");
const router  = express.Router();

// Fixed city set used for quick-filter pills
const CITIES = ["Mumbai", "Navi Mumbai", "Pune", "Bengaluru", "Delhi NCR", "Hyderabad"];

// ─────────────────────────────────────────────
// TEMP SAMPLE DATA (replace with FlatmateListing.find(...))
// ─────────────────────────────────────────────
const SAMPLE_LISTINGS = [
  { _id: "s1",  type: "have", city: "Mumbai",       bhk: 2, roomType: "Private Room", location: "Powai",            gender: "any",    rent: 14000, moveIn: "1 Oct",   postedBy: "Rahul",  image:  "https://cf.bstatic.com/xdata/images/hotel/max1024x768/542608327.jpg?k=281c15e9f915014269a9f2bfc531bb2e5e847de13edb47731bce3e10f0675c3a&o=" },
  { _id: "s2",  type: "need", city: "Mumbai",       bhk: 1, roomType: "Any",           location: "Andheri West",     gender: "female", budgetMin: 9000,  budgetMax: 14000, moveIn: "5 Oct",  postedBy: "Priya" },
  { _id: "s3",  type: "have", city: "Mumbai",       bhk: 1, roomType: "Shared Room",   location: "Malad",            gender: "male",   rent: 7500,  moveIn: "15 Sept", postedBy: "Karan",  image: "https://imagecdn.99acres.com/media1/40928/10/818570917M-1786793808662.jpg" },
  { _id: "s4",  type: "have", city: "Navi Mumbai",  bhk: 2, roomType: "Private Room",  location: "Kharghar, Sector 12", gender: "any", rent: 10000, moveIn: "1 Oct",   postedBy: "Rahul",  image: "https://imagecdn.99acres.com/media1/40931/4/818624697M-1786799944191.jpg" },
  { _id: "s5",  type: "need", city: "Navi Mumbai",  bhk: 2, roomType: "Private Room",  location: "Nerul",            gender: "any",    budgetMin: 8000,  budgetMax: 12000, moveIn: "1 Oct",  postedBy: "Amit" },
  { _id: "s6",  type: "have", city: "Navi Mumbai",  bhk: 1, roomType: "Shared Room",   location: "Vashi",            gender: "male",   rent: 6500,  moveIn: "20 Sept", postedBy: "Sahil",  image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQvt8v79KliIJRqSanU6hwFF0iADVRG2GnC0L2HFzkAlQ&s"},
  { _id: "s7",  type: "have", city: "Pune",         bhk: 1, roomType: "Shared Room",   location: "Kondhwa Budruk",   gender: "male",   rent: 5500,  moveIn: "15 Sept", postedBy: "Sneha",  image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS9etHkCuHEC7zbolGtntprKTEOR8-5T34r4uX9h226Wg&s" },
  { _id: "s8",  type: "have", city: "Pune",         bhk: 3, roomType: "Private Room",  location: "Mahalunge",        gender: "any",    rent: 15000, moveIn: "1 Oct",   postedBy: "Vikram", image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQCJlpOx2lkLNy0iuN9r0plINYEcGXTR4SUvrcCQTp9-w&s=10"},
  { _id: "s9",  type: "have", city: "Pune",         bhk: 1, roomType: "Shared Room",   location: "Marunji",          gender: "any",    rent: 12000, moveIn: "1 Oct",   postedBy: "Karan",  image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTEMOYEC9qOEIdCqOHBLM5gUGpU1kbsGyr9LG4fCyZkog&s=10"},
  { _id: "s10", type: "need", city: "Pune",         bhk: 2, roomType: "Either",        location: "Koregaon Park",    gender: "female", budgetMin: 10000, budgetMax: 16000, moveIn: "10 Oct", postedBy: "Neha" },
  { _id: "s11", type: "have", city: "Bengaluru",    bhk: 2, roomType: "Private Room",  location: "Koramangala",      gender: "any",    rent: 16000, moveIn: "1 Oct",   postedBy: "Arjun",  image: "https://housing-images.n7net.in/01c16c28/639fe00b066e524fddbef5eb81018e73/v0/medium/1_bhk_independent_builder_floor-for-rent-chikkakannalli-Bengaluru-hall.jpg" },
  { _id: "s12", type: "need", city: "Bengaluru",    bhk: 1, roomType: "Any",           location: "HSR Layout",       gender: "male",   budgetMin: 9000,  budgetMax: 15000, moveIn: "5 Oct",  postedBy: "Rohit" },
  { _id: "s13", type: "have", city: "Delhi NCR",    bhk: 2, roomType: "Shared Room",   location: "Lajpat Nagar",     gender: "female", rent: 11000, moveIn: "1 Oct",   postedBy: "Anjali", image: "https://s3.ap-south-1.amazonaws.com/prophunt.prod.fs/listings/6a5e1008a0ee7102aae9befd/images/img0.webp" },
  { _id: "s14", type: "need", city: "Delhi NCR",    bhk: 1, roomType: "Private",       location: "Dwarka",           gender: "any",    budgetMin: 8000,  budgetMax: 13000, moveIn: "12 Oct", postedBy: "Vivek" },
  { _id: "s15", type: "have", city: "Hyderabad",    bhk: 2, roomType: "Private Room",  location: "Gachibowli",       gender: "any",    rent: 12500, moveIn: "1 Oct",   postedBy: "Kiran",  image: "https://cdn.sowerent.com/propertyowner/1baece87-2ab5-4a23-a7c6-a0b7a4a8c9e3/5e5e7c85-a3f6-4938-a0b5-f261a64d23f2_WhatsApp-Image-2024-06-19-at-31027-PM-(1).jpeg" },
  { _id: "s16", type: "need", city: "Hyderabad",    bhk: 1, roomType: "Any",           location: "Madhapur",         gender: "male",   budgetMin: 7000,  budgetMax: 11000, moveIn: "8 Oct",  postedBy: "Sandeep" },
];

// ─────────────────────────────────────────────
// LANDING / SEARCH / FEED  →  GET /flatmate
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { location = "", gender = "", type = "", budget = "", bhk = "" } = req.query;

    // Real total (not a hard-coded marketing number) — swap the source
    // array for a Mongoose .countDocuments() once real data exists.
    const totalListingsCount = SAMPLE_LISTINGS.length;

    // Single "Across India" horizontal strip — always the full unfiltered mix.
    const acrossIndiaListings = SAMPLE_LISTINGS.slice().reverse().slice(0, 10);

    const cityCounts = CITIES.map(city => ({
      name: city,
      count: SAMPLE_LISTINGS.filter(l => l.city === city).length,
    }));

    // Main "Flats & Flatmates" feed: filtered by search bar params
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
      acrossIndiaListings,
      cityCounts,
      totalListingsCount,
      filters: { location, gender, type, budget, bhk },
    });
  } catch (err) {
    console.error("Flatmate route error:", err);
    // Never leak stack traces / raw Mongo or Express errors to the user.
    res.status(500).send("Something went wrong loading Flatmate listings. Please try again in a moment.");
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
