
/* ============================================================
   utils/leadWhatsapp.js  —  HostelNode WA Lead Alerts
   Sends WhatsApp messages to PG owners when students search
   or view listings. Includes 24-hour cooldown per owner+student.
============================================================ */

const WaCooldown = require("../models/waCooldown");
const Listing    = require("../models/listingProperty");

// ── Your existing WA sender (reuse what's already in your codebase) ──
// Adjust this import to match your actual WA util path
const { sendWhatsAppMessage } = require("../models/Whatsapp");

/* ============================================================
   LOW-LEVEL: Send a raw WA message to a phone number
   Replace this function body if you have a different WA API
============================================================ */
 async function sendWAMessage(phone, message) {
  try {

    await sendWhatsAppMessage(phone, message);

    return { success: true };

  } catch (err) {

    console.error("WA send error:", err.message);

    return null;
  }
}

/* ============================================================
   Check cooldown — returns true if we SHOULD send (not in cooldown)
============================================================ */
async function shouldSend(ownerId, studentId) {
  try {
    const existing = await WaCooldown.findOne({ ownerId, studentId });
    return !existing; // if no record → should send
  } catch (err) {
    return false; // on error, don't send
  }
}

/* ============================================================
   Mark cooldown — records that WA was sent, expires in 24h
============================================================ */
async function markCooldown(ownerId, studentId) {
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await WaCooldown.create({ ownerId, studentId, expiresAt });
  } catch (err) {
    // ignore duplicate key errors
  }
}

/* ============================================================
   TRIGGER 1: Student searches an area
   Finds top owners with listings in that area and sends WA
   
   @param {object} student   - logged-in student object
   @param {string} area      - area searched e.g. "Nerul"
   @param {string} city      - city e.g. "Mumbai"
   @param {number} maxOwners - max owners to notify (default 10)
============================================================ */
async function notifyOwnersOnSearch({ student, area, city, maxOwners = 10 }) {
  if (!student || !area) return;

  try {
    // Find listings matching this area/city — only get owner phone numbers
    const searchTerm = area || city;
    const listings = await Listing.find({
      status: "Approved",
      $or: [
        { "location.nearCollege": { $regex: searchTerm, $options: "i" } },
        { "location.city":        { $regex: searchTerm, $options: "i" } },
        { "location.address":     { $regex: searchTerm, $options: "i" } },
      ]
    })
    .populate("owner", "name phone")
    .select("owner title location")
    .limit(50); // fetch more, then dedupe by owner

    if (!listings.length) return;

    // Deduplicate by owner so one owner doesn't get 5 messages
    const seenOwners = new Set();
    let notified = 0;

    for (const listing of listings) {
      if (notified >= maxOwners) break;
      const owner = listing.owner;
      if (!owner || !owner.phone) continue;
      if (seenOwners.has(owner._id.toString())) continue;
      seenOwners.add(owner._id.toString());

      // Check 24-hour cooldown
      const ok = await shouldSend(owner._id, student._id);
      if (!ok) continue;

      const phone   = owner.phone.replace(/[^0-9]/g, "");
      const message =
`🏠 *New Lead — HostelNode*

A student is searching for PG/Hostel in *${area}${city ? ", " + city : ""}*.

👤 *Name:* ${student.firstName} ${student.lastName || ""}
📱 *Phone:* ${student.phone || "Not provided"}
🎓 *College:* ${student.collegeName || "Not mentioned"}

💬 Respond quickly to convert this lead!
📲 View your listing: https://www.hostelnode.com

— HostelNode Team`;

      await sendWAMessage(phone, message);
      await markCooldown(owner._id, student._id);
      notified++;
    }

    console.log(`✅ WA lead sent to ${notified} owners for area: ${area}`);
  } catch (err) {
    console.error("notifyOwnersOnSearch error:", err.message);
  }
}

/* ============================================================
   TRIGGER 2: Student views a specific listing
   Sends WA only to THAT listing's owner
   
   @param {object} student  - logged-in student object
   @param {object} listing  - the listing being viewed (populated with owner)
============================================================ */
async function notifyOwnerOnView({ student, listing }) {
  if (!student || !listing) return;

  try {
    const owner = listing.owner;
    if (!owner || !owner.phone) return;

    // Check 24-hour cooldown
    const ok = await shouldSend(owner._id, student._id);
    if (!ok) return;

    const phone   = owner.phone.replace(/[^0-9]/g, "");
    const area    = listing.location?.nearCollege || listing.location?.city || "";
    const message =
`👀 *Your Listing Was Viewed — HostelNode*

A student just viewed *"${listing.title}"*!

👤 *Student:* ${student.firstName} ${student.lastName || ""}
📱 *Phone:* ${student.phone || "Not provided"}
🎓 *College:* ${student.collegeName || "Not mentioned"}
📍 *Looking in:* ${area}

🔥 This is a hot lead — reach out now!
🔗 Listing: https://www.hostelnode.com/hostel/${listing.slug}

— HostelNode Team`;

    await sendWAMessage(phone, message);
    await markCooldown(owner._id, student._id);

    console.log(`✅ WA view-lead sent to owner: ${owner.name} for listing: ${listing.title}`);
  } catch (err) {
    console.error("notifyOwnerOnView error:", err.message);
  }
}

module.exports = { notifyOwnersOnSearch, notifyOwnerOnView };