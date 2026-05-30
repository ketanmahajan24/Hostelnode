/* ============================================================
   utils/leadWhatsapp.js  —  HostelNode WA Lead Alerts
   Sends WhatsApp messages to PG owners when students search
   or view listings. Includes 24-hour cooldown per owner+student.
============================================================ */

const WaCooldown = require("../models/waCooldown");
const Listing    = require("../models/listingProperty");
const axios      = require("axios");

// ── WhatsApp Business API Config ─────────────────────────────
const WA_TOKEN    = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const BASE_URL    = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;

/* ============================================================
   LOW-LEVEL: Send raw WA message via Official Business API
============================================================ */
async function sendWAMessage(phone, message) {
  try {
    // Clean phone number — remove all non-digits
    const cleanPhone = phone.toString().replace(/[^0-9]/g, "");

    // Add country code if missing
    const fullPhone = cleanPhone.startsWith("91")
      ? cleanPhone
      : `91${cleanPhone}`;

    const res = await axios.post(BASE_URL, {
      messaging_product: "whatsapp",
      to:   fullPhone,
      type: "text",
      text: { body: message }
    }, {
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type':  'application/json'
      },
      timeout: 15000
    });

    console.log(`🟢 WA sent to ${fullPhone}`);
    return { success: true, data: res.data };

  } catch (err) {
    console.error("🔴 WA send error:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

/* ============================================================
   Check cooldown — returns true if we SHOULD send (not in cooldown)
============================================================ */
async function shouldSend(ownerId, studentId) {
  try {
    const existing = await WaCooldown.findOne({ ownerId, studentId });
    return !existing;
  } catch (err) {
    return false;
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
    .limit(50);

    if (!listings.length) return;

    const seenOwners = new Set();
    let notified = 0;

    for (const listing of listings) {
      if (notified >= maxOwners) break;

      const owner = listing.owner;
      if (!owner || !owner.phone) continue;
      if (seenOwners.has(owner._id.toString())) continue;
      seenOwners.add(owner._id.toString());

      const ok = await shouldSend(owner._id, student._id);
      if (!ok) continue;

      const message =
`🏠 *New Lead — HostelNode*

A student is searching for PG/Hostel in *${area}${city ? ", " + city : ""}*.

👤 *Name:* ${student.firstName} ${student.lastName || ""}
📱 *Phone:* ${student.phone || "Not provided"}
🎓 *College:* ${student.collegeName || "Not mentioned"}

💬 Respond quickly to convert this lead!
📲 View your listings: https://hostelnode.com

— HostelNode Team`;

      const result = await sendWAMessage(owner.phone, message);

      if (result.success) {
        await markCooldown(owner._id, student._id);
        notified++;
        console.log(`🟢 Lead sent to owner: ${owner.name} (${owner.phone})`);
      }
    }

    console.log(`✅ WA lead sent to ${notified} owners for area: ${area}`);

  } catch (err) {
    console.error("🔴 notifyOwnersOnSearch error:", err.message);
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

    const ok = await shouldSend(owner._id, student._id);
    if (!ok) return;

    const area = listing.location?.nearCollege || listing.location?.city || "";

    const message =
`👀 *Your Listing Was Viewed — HostelNode*

A student just viewed *"${listing.title}"*!

👤 *Student:* ${student.firstName} ${student.lastName || ""}
📱 *Phone:* ${student.phone || "Not provided"}
🎓 *College:* ${student.collegeName || "Not mentioned"}
📍 *Looking in:* ${area}

🔥 This is a hot lead — reach out now!
🔗 Listing: https://hostelnode.com/hostel/${listing.slug}

— HostelNode Team`;

    const result = await sendWAMessage(owner.phone, message);

    if (result.success) {
      await markCooldown(owner._id, student._id);
      console.log(`🟢 View-lead sent to owner: ${owner.name} for: ${listing.title}`);
    }

  } catch (err) {
    console.error("🔴 notifyOwnerOnView error:", err.message);
  }
}

module.exports = { notifyOwnersOnSearch, notifyOwnerOnView };