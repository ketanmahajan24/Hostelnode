// ============================================================
//  utils/leadWhatsapp.js  —  HostelNode WA Utility
//  Clean version: only sendTemplateMessage + sendWAMessage
// ============================================================

const axios = require("axios");

const WA_TOKEN    = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const BASE_URL    = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;

// ── Format phone number ──────────────────────────────────────
function formatPhone(phone) {
  const clean = phone.toString().replace(/[^0-9]/g, "");
  return clean.startsWith("91") ? clean : `91${clean}`;
}

// ============================================================
//  sendTemplateMessage — Meta approved templates only
// ============================================================
async function sendTemplateMessage(phone, templateName, variables) {
  try {
    const fullPhone = formatPhone(phone);
    console.log(`🔵 Template [${templateName}] → ${fullPhone}`, variables);

    const res = await axios.post(BASE_URL, {
      messaging_product: "whatsapp",
      to:   fullPhone,
      type: "template",
      template: {
        name:     templateName,
        language: { code: "en" },
        components: [{
          type:       "body",
          parameters: variables.map(v => ({ type: "text", text: String(v || "") }))
        }]
      }
    }, {
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type':  'application/json'
      },
      timeout: 15000
    });

    console.log(`🟢 Template sent → ${fullPhone}`);
    return { success: true, data: res.data };

  } catch (err) {
    console.error("🔴 Template send error:", JSON.stringify(err.response?.data || err.message));
    return { success: false, error: err.response?.data || err.message };
  }
}

// ============================================================
//  sendWAMessage — plain text (24hr window only)
// ============================================================
async function sendWAMessage(phone, message) {
  try {
    const fullPhone = formatPhone(phone);
    console.log(`🔵 Plain text WA → ${fullPhone}`);

    const res = await axios.post(BASE_URL, {
      messaging_product: "whatsapp",
      to:   fullPhone,
      type: "text",
      text: { body: message }
    },{
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type':  'application/json'
      },
      timeout: 15000
    });

    console.log(`🟢 WA sent → ${fullPhone}`);
    return { success: true, data: res.data };

  } catch (err) {
    console.error("🔴 WA send error:", JSON.stringify(err.response?.data || err.message));
    return { success: false, error: err.response?.data || err.message };
  }
}

module.exports = { sendTemplateMessage, sendWAMessage };