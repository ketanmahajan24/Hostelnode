/* ============================================================
   utils/leadWhatsapp.js  —  HostelNode WA Lead Alerts
   UPDATED: Uses WhatsApp Templates for Listing View
============================================================ */

const WaCooldown = require("../models/waCooldown");
const Listing    = require("../models/listingProperty");
const axios      = require("axios");

const WA_TOKEN    = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const BASE_URL    = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;

/* ============================================================
   1️⃣ SEND TEMPLATE MESSAGE (New - For approved templates)
============================================================ */
async function sendTemplateMessage(phone, templateName, variables) {
  console.log("🔵 sendTemplateMessage called — phone:", phone, "template:", templateName);

  try {
    const cleanPhone = phone.toString().replace(/[^0-9]/g, "");
    const fullPhone  = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;

    console.log("🔵 Sending template to:", fullPhone);
    console.log("🔵 Variables:", variables);

    const res = await axios.post(BASE_URL, {
      messaging_product: "whatsapp",
      to: fullPhone,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en"
        },
        components: [
          {
            type: "body",
            parameters: variables.map(v => ({ type: "text", text: String(v || "") }))
          }
        ]
      }
    }, {
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log(`🟢 Template sent to ${fullPhone}`);
    return { success: true, data: res.data };

  } catch (err) {
    console.error("🔴 Template send error:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

/* ============================================================
   2️⃣ SEND PLAIN TEXT MESSAGE (Existing - For non-template messages)
============================================================ */
async function sendWAMessage(phone, message) {
  console.log("🔵 sendWAMessage called — phone:", phone);
  console.log("🔵 WA_TOKEN exists:", !!WA_TOKEN);
  console.log("🔵 WA_PHONE_ID:", WA_PHONE_ID);

  try {
    const cleanPhone = phone.toString().replace(/[^0-9]/g, "");
    const fullPhone  = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;

    console.log("🔵 Sending to:", fullPhone);

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
   Cooldown helpers — Student (24 hours)
============================================================ */
async function shouldSend(ownerId, studentId) {
  try {
    const existing = await WaCooldown.findOne({ ownerId, studentId });
    console.log(`🔵 shouldSend — ownerId:${ownerId} studentId:${studentId} → ${!existing ? 'SEND' : 'SKIP (cooldown)'}`);
    return !existing;
  } catch (err) {
    console.error("🔴 shouldSend error:", err.message);
    return false;
  }
}

async function markCooldown(ownerId, studentId) {
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await WaCooldown.create({ ownerId, studentId, expiresAt });
  } catch {
    // ignore duplicate
  }
}

/* ============================================================
   Cooldown helpers — Guest (1 hour per listing)
============================================================ */
async function shouldSendGuest(ownerId, listingId) {
  try {
    const key      = `guest_${listingId}`;
    const existing = await WaCooldown.findOne({ ownerId, studentId: key });
    console.log(`🔵 shouldSendGuest — ownerId:${ownerId} listingId:${listingId} → ${!existing ? 'SEND' : 'SKIP (cooldown)'}`);
    return !existing;
  } catch (err) {
    console.error("🔴 shouldSendGuest error:", err.message);
    return false;
  }
}

async function markGuestCooldown(ownerId, listingId) {
  try {
    const key       = `guest_${listingId}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await WaCooldown.create({ ownerId, studentId: key, expiresAt });
  } catch {
    // ignore duplicate
  }
}

/* ============================================================
   TRIGGER 1: Student searches an area (Plain text - no template)
============================================================ */
async function notifyOwnersOnSearch({ student, area, city, maxOwners = 10 }) {
  console.log("🔵 notifyOwnersOnSearch called — area:", area, "city:", city);

  if (!student || !area) {
    console.log("❌ notifyOwnersOnSearch — student or area missing, skipping");
    return;
  }

  try {
    const searchTerm = area || city;
    const listings   = await Listing.find({
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

    console.log(`🔵 notifyOwnersOnSearch — ${listings.length} listings found for: ${searchTerm}`);
    if (!listings.length) return;

    const seenOwners = new Set();
    let notified     = 0;

    for (const listing of listings) {
      if (notified >= maxOwners) break;

      const owner = listing.owner;
      if (!owner?.phone) {
        console.log("⚠️ Listing has no owner/phone — skipping:", listing.title);
        continue;
      }
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
        console.log(`🟢 Search-lead sent to owner: ${owner.name} (${owner.phone})`);
      }
    }

    console.log(`✅ WA search-leads sent to ${notified} owners for area: ${area}`);

  } catch (err) {
    console.error("🔴 notifyOwnersOnSearch error:", err.message);
  }
}

/* ============================================================
   TRIGGER 2: Listing view — student ya guest dono handle karta hai
============================================================ */
async function notifyOwnerOnView({ student, listing, isGuest = false }) {
  console.log("🔵 notifyOwnerOnView called — isGuest:", isGuest, "| listing:", listing?.title);

  if (!listing) {
    console.log("❌ notifyOwnerOnView — listing missing");
    return;
  }

  try {
    const owner = listing.owner;

    if (!owner) {
      console.log("❌ listing.owner is null — populate hua nahi lagta");
      return;
    }
    if (!owner.phone) {
      console.log("❌ owner.phone missing — owner:", owner);
      return;
    }

    // ── GUEST VIEW (Plain text) ──
    if (isGuest) {
      const ok = await shouldSendGuest(owner._id, listing._id);
      if (!ok) {
        console.log("⏭️ Guest cooldown active — skipping WA");
        return;
      }

      const message =
`👀 *Listing Viewed — HostelNode*

Ek *Guest User* ne abhi aapki listing dekhi!
(Abhi login nahi kiya — interested hai)

🏠 *${listing.title}*
📍 ${listing.location?.city || ""}
🔗 https://hostelnode.com/hostel/${listing.slug}

⚡ Listing attractive lag rahi hai!

— HostelNode Team`;

      const result = await sendWAMessage(owner.phone, message);

      if (result.success) {
        await markGuestCooldown(owner._id, listing._id);
        console.log(`🟢 Guest view-lead sent to owner for: ${listing.title}`);
      }

      return;
    }

    // ── LOGGED IN STUDENT VIEW (Using Template) ✅ ──
    if (!student) {
      console.log("❌ notifyOwnerOnView — student missing aur isGuest false hai");
      return;
    }

    const ok = await shouldSend(owner._id, student._id);
    if (!ok) {
      console.log("⏭️ Student cooldown active — skipping WA");
      return;
    }

    const area = listing.location?.nearCollege || listing.location?.city || "";

    // ✅ TEMPLATE VARIABLES (in order — must match Meta template)
    const templateVariables = [
      owner.name || "Owner",                          // {{1}}
      student.firstName + " " + student.lastName || "Student",                 // {{2}}
      student.phone || "Not provided",                // {{3}}
      student.collegeName || "Not mentioned",         // {{4}}
      area || "Not mentioned",                        // {{5}}
      listing.title || "Listing"                      // {{6}}
    ];

    console.log("🔵 Template variables being sent:", templateVariables);

    // ✅ SEND TEMPLATE MESSAGE (not plain text)
    const result = await sendTemplateMessage(
      owner.phone,
      "hostelnode_listing_view",  // Template name (must be approved on Meta)
      templateVariables
    );

    if (result.success) {
      await markCooldown(owner._id, student._id);
      console.log(`🟢 ✅ TEMPLATE MESSAGE sent to owner: ${owner.name} for: ${listing.title}`);
      console.log(`   Variables: ${templateVariables.join(" | ")}`);
    } else {
      console.log(`🔴 Template send failed — will retry with plain text next time`);
    }

  } catch (err) {
    console.error("🔴 notifyOwnerOnView error:", err.message);
    console.error(err.stack);
  }
}

module.exports = { notifyOwnersOnSearch, notifyOwnerOnView };