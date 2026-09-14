// ================= migrateWishlistToSavedProperties.js =============================
/* ============================================================
   One-time migration: backfills the new unified `savedProperties`
   field from the legacy PG-only `wishlist` field, for every existing
   student. Safe to run multiple times (idempotent — skips anything
   already present in savedProperties). Does NOT touch or remove the
   legacy `wishlist` field.

   Run with:  node scripts/migrateWishlistToSavedProperties.js
============================================================ */

require("dotenv").config();
const mongoose = require("mongoose");
const Student = require("../models/studentSchema");

async function migrate() {
  await mongoose.connect(process.env.MONGO_URL);
  console.log("Connected. Starting migration...");

  const students = await Student.find({ wishlist: { $exists: true, $ne: [] } });
  console.log(`Found ${students.length} students with legacy wishlist entries.`);

  let migratedStudents = 0;
  let migratedEntries = 0;

  for (const student of students) {
    let changed = false;

    for (const listingId of student.wishlist) {
      const alreadyPresent = student.savedProperties.some(
        (sp) => sp.listingType === "pg" && sp.listingId.toString() === listingId.toString()
      );
      if (!alreadyPresent) {
        student.savedProperties.push({ listingType: "pg", listingId });
        migratedEntries++;
        changed = true;
      }
    }

    if (changed) {
      await student.save();
      migratedStudents++;
    }
  }

  console.log(`Done. ${migratedStudents} students updated, ${migratedEntries} entries backfilled.`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
