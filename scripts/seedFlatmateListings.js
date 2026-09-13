/* ============================================================
   scripts/seedFlatmateListings.js
   Populates the database with sample Flatmate data so /flatmate
   and /flatmate/results aren't empty while testing Phase 1.

   Run with:
     node scripts/seedFlatmateListings.js

   Safe to re-run — it only deletes/re-creates listings owned by
   its own seed Student accounts (matched by phone), never touches
   any real user's data.
============================================================ */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Student = require("../models/studentSchema");
const FlatmateListing = require("../models/FlatmateListing");

// ── Seed "posters" — fake test accounts, easy to spot/remove later ──
const SEED_STUDENTS = [
  { firstName: "Rahul",   lastName: "Seed", phone: "9000000001", gender: "Male" },
  { firstName: "Priya",   lastName: "Seed", phone: "9000000002", gender: "Female" },
  { firstName: "Karan",   lastName: "Seed", phone: "9000000003", gender: "Male" },
  { firstName: "Amit",    lastName: "Seed", phone: "9000000004", gender: "Male" },
  { firstName: "Sahil",   lastName: "Seed", phone: "9000000005", gender: "Male" },
  { firstName: "Sneha",   lastName: "Seed", phone: "9000000006", gender: "Female" },
  { firstName: "Vikram",  lastName: "Seed", phone: "9000000007", gender: "Male" },
  { firstName: "Neha",    lastName: "Seed", phone: "9000000008", gender: "Female" },
  { firstName: "Arjun",   lastName: "Seed", phone: "9000000009", gender: "Male" },
  { firstName: "Rohit",   lastName: "Seed", phone: "9000000010", gender: "Male" },
  { firstName: "Anjali",  lastName: "Seed", phone: "9000000011", gender: "Female" },
  { firstName: "Vivek",   lastName: "Seed", phone: "9000000012", gender: "Male" },
  { firstName: "Kiran",   lastName: "Seed", phone: "9000000013", gender: "Male" },
  { firstName: "Sandeep", lastName: "Seed", phone: "9000000014", gender: "Male" },
];

// ── Sample listings (mirrors the earlier in-memory SAMPLE_LISTINGS set) ──
// `poster` = phone number, used to look up the seed Student's _id below.
const SEED_LISTINGS = [
  { type: "HAVE_FLAT", city: "Mumbai", area: "Powai", bhk: 2, roomType: "Private Room", gender: "any",
    rentMonthly: 14000, images: [
      "https://cf.bstatic.com/xdata/images/hotel/max1024x768/542608327.jpg?k=281c15e9f915014269a9f2bfc531bb2e5e847de13edb47731bce3e10f0675c3a&o=",
      "https://imagecdn.99acres.com/media1/40931/4/818624697M-1786799944191.jpg",
    ], poster: "9000000001" },
  { type: "NEED_FLAT", city: "Mumbai", area: "Andheri West", bhk: 1, roomType: "Any", gender: "female",
    budgetMin: 9000, budgetMax: 14000, poster: "9000000002" },
  { type: "HAVE_FLAT", city: "Mumbai", area: "Malad", bhk: 1, roomType: "Shared Room", gender: "male",
    rentMonthly: 7500, images: ["https://imagecdn.99acres.com/media1/40928/10/818570917M-1786793808662.jpg"], poster: "9000000003" },
  { type: "HAVE_FLAT", city: "Navi Mumbai", area: "Kharghar, Sector 12", bhk: 2, roomType: "Private Room", gender: "any",
    rentMonthly: 10000, images: [
      "https://imagecdn.99acres.com/media1/40931/4/818624697M-1786799944191.jpg",
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQvt8v79KliIJRqSanU6hwFF0iADVRG2GnC0L2HFzkAlQ&s",
    ], poster: "9000000001" },
  { type: "NEED_FLAT", city: "Navi Mumbai", area: "Nerul", bhk: 2, roomType: "Private Room", gender: "any",
    budgetMin: 8000, budgetMax: 12000, poster: "9000000004" },
  { type: "HAVE_FLAT", city: "Navi Mumbai", area: "Vashi", bhk: 1, roomType: "Shared Room", gender: "male",
    rentMonthly: 6500, images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQvt8v79KliIJRqSanU6hwFF0iADVRG2GnC0L2HFzkAlQ&s"], poster: "9000000005" },
  { type: "HAVE_FLAT", city: "Pune", area: "Kondhwa Budruk", bhk: 1, roomType: "Shared Room", gender: "male",
    rentMonthly: 5500, images: [
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS9etHkCuHEC7zbolGtntprKTEOR8-5T34r4uX9h226Wg&s",
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQCJlpOx2lkLNy0iuN9r0plINYEcGXTR4SUvrcCQTp9-w&s=10",
    ], poster: "9000000006" },
  { type: "HAVE_FLAT", city: "Pune", area: "Mahalunge", bhk: 3, roomType: "Private Room", gender: "any",
    rentMonthly: 15000, images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQCJlpOx2lkLNy0iuN9r0plINYEcGXTR4SUvrcCQTp9-w&s=10"], poster: "9000000007" },
  { type: "HAVE_FLAT", city: "Pune", area: "Marunji", bhk: 1, roomType: "Shared Room", gender: "any",
    rentMonthly: 12000, images: ["https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTEMOYEC9qOEIdCqOHBLM5gUGpU1kbsGyr9LG4fCyZkog&s=10"], poster: "9000000003" },
  { type: "NEED_FLAT", city: "Pune", area: "Koregaon Park", bhk: 2, roomType: "Either", gender: "female",
    budgetMin: 10000, budgetMax: 16000, poster: "9000000008" },
  { type: "HAVE_FLAT", city: "Bengaluru", area: "Koramangala", bhk: 2, roomType: "Private Room", gender: "any",
    rentMonthly: 16000, images: ["https://housing-images.n7net.in/01c16c28/639fe00b066e524fddbef5eb81018e73/v0/medium/1_bhk_independent_builder_floor-for-rent-chikkakannalli-Bengaluru-hall.jpg"], poster: "9000000009" },
  { type: "NEED_FLAT", city: "Bengaluru", area: "HSR Layout", bhk: 1, roomType: "Any", gender: "male",
    budgetMin: 9000, budgetMax: 15000, poster: "9000000010" },
  { type: "HAVE_FLAT", city: "Delhi NCR", area: "Lajpat Nagar", bhk: 2, roomType: "Shared Room", gender: "female",
    rentMonthly: 11000, images: ["https://s3.ap-south-1.amazonaws.com/prophunt.prod.fs/listings/6a5e1008a0ee7102aae9befd/images/img0.webp"], poster: "9000000011" },
  { type: "NEED_FLAT", city: "Delhi NCR", area: "Dwarka", bhk: 1, roomType: "Private Room", gender: "any",
    budgetMin: 8000, budgetMax: 13000, poster: "9000000012" },
  { type: "HAVE_FLAT", city: "Hyderabad", area: "Gachibowli", bhk: 2, roomType: "Private Room", gender: "any",
    rentMonthly: 12500, images: ["https://cdn.sowerent.com/propertyowner/1baece87-2ab5-4a23-a7c6-a0b7a4a8c9e3/5e5e7c85-a3f6-4938-a0b5-f261a64d23f2_WhatsApp-Image-2024-06-19-at-31027-PM-(1).jpeg"], poster: "9000000013" },
  { type: "NEED_FLAT", city: "Hyderabad", area: "Madhapur", bhk: 1, roomType: "Any", gender: "male",
    budgetMin: 7000, budgetMax: 11000, poster: "9000000014" },
];

async function run() {
  await connectDB();

  console.log("→ Upserting seed Student accounts...");
  const studentIdByPhone = {};
  for (const s of SEED_STUDENTS) {
    const doc = await Student.findOneAndUpdate(
      { phone: s.phone },
      { $setOnInsert: { firstName: s.firstName, lastName: s.lastName, phone: s.phone, gender: s.gender } },
      { upsert: true, new: true }
    );
    studentIdByPhone[s.phone] = doc._id;
  }
  console.log(`  ${Object.keys(studentIdByPhone).length} seed students ready.`);

  console.log("→ Clearing previous seed listings (owned by seed students only)...");
  const seedStudentIds = Object.values(studentIdByPhone);
  const { deletedCount } = await FlatmateListing.deleteMany({ student: { $in: seedStudentIds } });
  console.log(`  Removed ${deletedCount} old seed listings.`);

  console.log("→ Creating fresh seed listings...");
  const docs = SEED_LISTINGS.map(l => {
    const isHave = l.type === "HAVE_FLAT";
    return {
      student: studentIdByPhone[l.poster],
      type: l.type,
      status: "ACTIVE",
      city: l.city,
      area: l.area,
      bhk: l.bhk,
      roomType: l.roomType,
      gender: l.gender,
      images: isHave ? l.images : [],
      coverImage: isHave ? (l.images?.[0] || null) : null,
      have: isHave ? {
        availabilityType: "Room",
        availableSpots: 1,
        availableFromMode: "now",
        rentMonthly: l.rentMonthly,
        maintenance: "Included",
      } : undefined,
      need: !isHave ? {
        needType: "Either",
        budgetMin: l.budgetMin,
        budgetMax: l.budgetMax,
        moveInMode: "immediate",
      } : undefined,
      publishedAt: new Date(),
    };
  });

  const created = await FlatmateListing.insertMany(docs);

  // Slugs need the _id, so generate + save them after insertMany
  for (const doc of created) {
    doc.generateSlug();
    await doc.save();
  }

  console.log(`  Created ${created.length} listings.`);
  console.log("✓ Seed complete.");
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
