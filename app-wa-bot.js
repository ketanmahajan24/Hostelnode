// ============================================================
//  app-wa-bot.js  —  HostelNode WhatsApp Bot
//  Same folder as app.js
//  Mount in app.js with:
//    const waBot = require("./app-wa-bot");
//    app.use("/webhook", waBot);
// ============================================================

const express = require("express");
const router  = express.Router();
const { sendWhatsAppMessage } = require("./models/Whatsapp");

// ── In-memory session store ──────────────────────────────────
// Key: phone number  |  Value: { state, timestamp }
// States:  "IDLE" | "AWAITING_CITY"
const sessions = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSession(phone) {
  const s = sessions.get(phone);
  if (!s) return { state: "IDLE" };
  if (Date.now() - s.timestamp > SESSION_TTL_MS) {
    sessions.delete(phone);
    return { state: "IDLE" };
  }
  return s;
}

function setSession(phone, state) {
  sessions.set(phone, { state, timestamp: Date.now() });
}

function clearSession(phone) {
  sessions.delete(phone);
}

// ── City slug helper ─────────────────────────────────────────
function toSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")       // spaces → hyphens
    .replace(/[^a-z0-9\-]/g, ""); // remove special chars
}

function toDisplay(text) {
  return text
    .trim()
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// ── Keyword matchers ─────────────────────────────────────────
const PG_TRIGGERS = [
  "find hostel near my college",
  "find pg near me",
  "find pg",
  "pg near me",
  "hostel near me",
  "find hostel",
];

function isPgTrigger(text) {
  const lower = text.toLowerCase().trim();
  return PG_TRIGGERS.some(t => lower.includes(t));
}

// ── Webhook Verification (GET) ───────────────────────────────
router.get("/", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    return res.status(200).send(challenge);
  }
  console.warn("❌ Webhook verify failed — check WA_VERIFY_TOKEN in .env");
  res.sendStatus(403);
});

// ── Main Message Handler (POST) ──────────────────────────────
router.post("/", async (req, res) => {
  // Meta ko turant 200 chahiye — warna retry karta hai
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg   = value?.messages?.[0];

    // Sirf text messages handle karo
    if (!msg || msg.type !== "text") return;

    const phone = msg.from;                        // e.g. "919876543210"
    const body  = msg.text.body.trim();
    const lower = body.toLowerCase();

    console.log(`📩 [${phone}] ${body}`);

    const session = getSession(phone);

    // ── CASE 1: User ne PG dhundhne wala button/text bheja ──
    if (isPgTrigger(lower)) {
      setSession(phone, "AWAITING_CITY");
      await sendWhatsAppMessage(
        phone,
        `Konsi city mein PG/Hostel chahiye? 🏠\n\nBas city ka naam type karo:\n` +
        `• Mumbai\n• Delhi\n• Pune\n• Bangalore\n• Hyderabad\n• Chennai\n• Jaipur\n\n` +
        `(Ya koi bhi city likho)`
      );
      return;
    }

    // ── CASE 2: User city reply kar raha hai ────────────────
    if (session.state === "AWAITING_CITY") {
      clearSession(phone);

      const slug    = toSlug(body);
      const display = toDisplay(body);
      const link    = `https://hostelnode.com/city/${slug}`;

      await sendWhatsAppMessage(
        phone,
        `${display} mein PG aur Hostels dekho! 🏠\n\n` +
        `${link}\n\n` +
        `Kisi aur city ke liye dobara "Find PG near me" tap karo. 😊`
      );
      return;
    }

    // ── CASE 3: Koi aur message ──────────────────────────────
    await sendWhatsAppMessage(
      phone,
      `Namaste! 👋 HostelNode pe aapka swagat hai.\n\n` +
      `PG ya Hostel dhundhne ke liye neecha diya button tap karo:\n` +
      `👉 *Find Hostel Near My College*`
    );

  } catch (err) {
    console.error("❌ Webhook handler error:", err.message);
  }
});

module.exports = router;
