/* ============================================================
   routes/adminPayoutsRoutes.js  —  Property Operations Phase 6: owner payouts, admin
   Mounted at /admin in app.js (before the main admin router).

     GET  /admin/payouts                      every owner's payout account (filters)
     GET  /admin/payouts/settings             fees & commission
     POST /admin/payouts/settings             save fees & commission
     GET  /admin/payouts/owner/:id            one owner: status, history, commission, hold
     POST /admin/payouts/owner/:id/commission own rate or the default
     POST /admin/payouts/owner/:id/hold       hold payouts (reason shown to the owner)
     POST /admin/payouts/owner/:id/release    release payouts
     POST /admin/payouts/owner/:id/link       link Razorpay ids by hand (an earlier try whose answer was lost)
     POST /admin/payouts/owner/:id/check      Phase 7: ask Razorpay where this owner's online rent is
     POST /admin/payouts/owner/:id/payment/:pid/retry   Phase 7: send a failed payout again

   Owners register and change their bank account in the owner dashboard;
   Razorpay is called from there. This page reads what is saved.
============================================================ */
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Admin = require("../models/admin");
const Owner = require("../models/owner");
const Hostel = require("../models/hostel");
const PayoutAccount = require("../models/payoutAccount");
const PayoutSettings = require("../models/payoutSettings");
const Payment = require("../models/payment");
const { jwtAdminAuth } = require("../Middlewares/jwtAuth");

const FILTERS = { all: {}, attention: { status: "needs_attention" }, review: { status: "under_review" }, active: { status: "active" }, hold: { "hold.on": true }, suspended: { status: "suspended" }, draft: { status: "draft" } };
const LABEL = { draft: ["Not finished", "gray"], under_review: ["Under review", "blue"], active: ["Active", "green"], needs_attention: ["Needs attention", "amber"], suspended: ["Suspended", "red"] };
const clean = (s, max = 200) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").replace(/<[^>]*>/g, "").trim().slice(0, max) : "");
const isId = v => typeof v === "string" && /^[0-9a-f]{24}$/i.test(v) && mongoose.isValidObjectId(v);
// A rate typed by the admin: percent 0–30 (two decimals), fixed ₹0–10,000.
function rateIn(type, raw, { maxPct = 30, maxFixed = 10000 } = {}) {
  const n = Number(String(raw ?? "").replace(/[,₹%\s]/g, ""));
  if (String(raw ?? "").trim() === "" || !Number.isFinite(n) || n < 0) return null;
  if (type === "percent") return n <= maxPct ? Math.round(n * 100) / 100 : null;
  return n <= maxFixed ? Math.round(n) : null;
}
async function me(req, res) {
  const admin = await Admin.findById(req.admin.id).select("-password");
  if (!admin) { res.clearCookie("adminToken"); res.redirect("/admin/login"); return null; }
  return admin;
}

router.get("/payouts", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const f = FILTERS[req.query.f] ? req.query.f : "all";
    const [rows, counts, settings] = await Promise.all([
      PayoutAccount.find(FILTERS[f]).sort({ updatedAt: -1 }).limit(500).lean(),
      PayoutAccount.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      PayoutSettings.read(),
    ]);
    const held = await PayoutAccount.countDocuments({ "hold.on": true });
    const owners = await Owner.find({ _id: { $in: rows.map(r => r.owner) } }, { name: 1, email: 1 }).lean();
    const hostels = await Hostel.find({ owner: { $in: rows.map(r => r.owner) } }, { owner: 1, hostelName: 1 }).lean();
    const byOwner = new Map(owners.map(o => [String(o._id), o]));
    const firstHostel = new Map();
    for (const h of hostels) if (!firstHostel.has(String(h.owner))) firstHostel.set(String(h.owner), h.hostelName);
    const c = Object.fromEntries(counts.map(x => [x._id, x.n]));
    res.render("admin/payouts.ejs", { admin, rows, byOwner, firstHostel, f, c: Object.assign({ all: rows.length }, c), held, total: Object.values(c).reduce((s, n) => s + n, 0), fees: settings, LABEL, saved: req.query.saved || "" });
  } catch (err) {
    console.error("Admin payouts page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

router.get("/payouts/settings", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    res.render("admin/payoutSettings.ejs", { admin, s: await PayoutSettings.read(), saved: req.query.saved === "1", error: clean(req.query.err || "", 200) });
  } catch (err) {
    console.error("Admin payout settings error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});
router.post("/payouts/settings", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const b = req.body || {};
    const commissionType = b.commissionType === "fixed" ? "fixed" : "percent";
    const feeType = b.feeType === "fixed" ? "fixed" : "percent";
    const commissionValue = rateIn(commissionType, b.commissionValue);
    const feeValue = rateIn(feeType, b.feeValue, { maxPct: 10, maxFixed: 1000 });
    if (commissionValue === null) return res.redirect("/admin/payouts/settings?err=" + encodeURIComponent(commissionType === "percent" ? "Commission must be between 0 and 30%." : "Commission must be between ₹0 and ₹10,000."));
    if (feeValue === null) return res.redirect("/admin/payouts/settings?err=" + encodeURIComponent(feeType === "percent" ? "Gateway fee must be between 0 and 10%." : "Gateway fee must be between ₹0 and ₹1,000."));
    const feePaidBy = b.feePaidBy === "tenant" ? "tenant" : "owner";
    await PayoutSettings.updateOne({ key: "main" }, { $set: { commissionType, commissionValue, feeType, feeValue, feePaidBy, updatedBy: admin.email || admin.name || "" } }, { upsert: true });
    res.redirect("/admin/payouts/settings?saved=1");
  } catch (err) {
    console.error("Admin payout settings save error:", err.message);
    res.status(500).send("The settings could not be saved. Please try again.");
  }
});

async function loadOne(req, res) {
  if (!isId(String(req.params.id || ""))) { res.status(404).send("Not found."); return null; }
  const rec = await PayoutAccount.findOne({ owner: req.params.id }).lean();
  if (!rec) { res.status(404).send("This owner has not started payouts."); return null; }
  return rec;
}
router.get("/payouts/owner/:id", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    const [owner, hostels, settings, online] = await Promise.all([Owner.findById(rec.owner, { name: 1, email: 1, phone: 1 }).lean(), Hostel.find({ owner: rec.owner }, { hostelName: 1, onlineRent: 1 }).lean(), PayoutSettings.read(),
      // Phase 7: rent paid online by this owner's tenants, and where each payout is.
      Payment.find({ user: rec.owner, "recordedBy.role": "tenant" }, { paymentDate: 1, tenantName: 1, amountPaid: 1, receiptNo: 1, online: 1, payout: 1, cancelledAt: 1, cancelReason: 1 }).sort({ paymentDate: -1 }).limit(100).lean()]);
    // A second payment on an order already paid (two tabs): not counted as rent; to be refunded in Razorpay.
    const orders = await require("../models/rentOrder").find({ owner: rec.owner }, { razorpayOrderId: 1, razorpayPaymentId: 1, extraPayments: 1, total: 1, paidAt: 1, status: 1, failureReason: 1 }).sort({ createdAt: -1 }).limit(500).lean();
    const extra = orders.filter(o => (o.extraPayments || []).length);
    // Collected by Razorpay but could not be recorded (the tenant record was deleted): settle by hand.
    const unrecorded = orders.filter(o => /^Paid but not recorded/.test(o.failureReason || ""));
    // Phase 8: booking refunds Razorpay kept refusing, and second payments on a booking.
    const bookingIssues = await require("../models/booking").find({ owner: rec.owner, $or: [{ "refund.status": "failed" }, { "extraPayments.0": { $exists: true } }] },
      { bookingNo: 1, studentName: 1, total: 1, refund: 1, extraPayments: 1, razorpayPaymentId: 1 }).sort({ updatedAt: -1 }).limit(100).lean();
    res.render("admin/payoutOwner.ejs", { admin, rec, owner: owner || {}, hostels, fees: settings, LABEL, online, extra, unrecorded, bookingIssues, saved: clean(req.query.saved || "", 40), error: clean(req.query.err || "", 200) });
  } catch (err) {
    console.error("Admin payout owner error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});
const back = (id, k, v) => `/admin/payouts/owner/${id}?${k}=${encodeURIComponent(v)}`;
router.post("/payouts/owner/:id/commission", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    const own = req.body.own === "1";
    const type = req.body.type === "fixed" ? "fixed" : "percent";
    const value = own ? rateIn(type, req.body.value) : 0;
    if (own && value === null) return res.redirect(back(rec.owner, "err", type === "percent" ? "Commission must be between 0 and 30%." : "Commission must be between ₹0 and ₹10,000."));
    const text = own ? `Own commission set: ${type === "percent" ? value + "%" : "₹" + value + " per payment"}` : "Commission set back to the default";
    await PayoutAccount.updateOne({ _id: rec._id }, { $set: { commission: { own, type, value } }, $push: { history: { $each: [{ at: new Date(), text, by: admin.email || admin.name || "admin" }], $slice: -50 } } });
    res.redirect(back(rec.owner, "saved", "commission"));
  } catch (err) {
    console.error("Admin payout commission error:", err.message);
    res.status(500).send("That could not be saved. Please try again.");
  }
});
router.post("/payouts/owner/:id/hold", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    const reason = clean(req.body.reason || "", 200);
    if (reason.length < 3) return res.redirect(back(rec.owner, "err", "Give a reason (the owner sees it)."));
    const by = admin.email || admin.name || "admin";
    await PayoutAccount.updateOne({ _id: rec._id }, { $set: { hold: { on: true, reason, by, at: new Date() } }, $push: { history: { $each: [{ at: new Date(), text: `Payouts put on hold: ${reason}`, by }], $slice: -50 } } });
    followHold(rec, true, by);   // Phase 7: online rent already paid but not in the owner's bank yet
    res.redirect(back(rec.owner, "saved", "hold"));
  } catch (err) {
    console.error("Admin payout hold error:", err.message);
    res.status(500).send("That could not be saved. Please try again.");
  }
});
router.post("/payouts/owner/:id/release", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    const by = admin.email || admin.name || "admin";
    if (rec.hold && rec.hold.on) await PayoutAccount.updateOne({ _id: rec._id }, { $set: { hold: { on: false, reason: "", by, at: new Date() } }, $push: { history: { $each: [{ at: new Date(), text: "Payouts released", by }], $slice: -50 } } });
    followHold(rec, false, by);   // Phase 7: held online rent goes on to the owner's bank
    res.redirect(back(rec.owner, "saved", "release"));
  } catch (err) {
    console.error("Admin payout release error:", err.message);
    res.status(500).send("That could not be saved. Please try again.");
  }
});

/* ── Property Operations Phase 7: online rent ───────────────── */
// Hold or release the owner's online rent that is not in their bank yet (Razorpay transfers). In the background:
// the page answers at once; the result is added to the owner's history.
function followHold(rec, on, by) {
  setImmediate(async () => {
    try {
      const r = await require("../utils/onlineRent").applyHold(rec.owner, on);
      // Phase 8: booking amounts already theirs (moved in, or kept after a cancellation).
      const rb = await require("../utils/bookings").applyHold(rec.owner, on).catch(() => ({ done: 0, failed: 0 }));
      r.done += rb.done; r.failed += rb.failed;
      if (r.done || r.failed) await PayoutAccount.updateOne({ _id: rec._id }, { $push: { history: { $each: [{ at: new Date(), text: `${on ? "Held" : "Released"} ${r.done} online rent payout${r.done === 1 ? "" : "s"} at Razorpay${r.failed ? ` (${r.failed} could not be changed: check Razorpay Dashboard → Route → Transfers)` : ""}`, by }], $slice: -50 } } });
    } catch (err) { console.error("Payout hold follow-up (non-fatal):", err.message); }
  });
}
// Ask Razorpay where this owner's online rent is now.
router.post("/payouts/owner/:id/check", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    const OR = require("../utils/onlineRent");
    const list = await Payment.find({ user: rec.owner, "recordedBy.role": "tenant", "payout.status": { $in: ["pending", "on_hold", "failed"] } }, { _id: 1 }).sort({ paymentDate: -1 }).limit(30).lean();
    let failed = 0;
    for (const p of list) { try { await OR.syncTransfer(p._id); } catch (e) { failed++; console.error("Admin payout check (non-fatal):", e.message); } }
    res.redirect(failed ? back(rec.owner, "err", "Razorpay could not be reached for some payments. Please try again in a minute.") : back(rec.owner, "saved", "checked"));
  } catch (err) {
    console.error("Admin payout check error:", err.message);
    res.status(500).send("That could not be done. Please try again.");
  }
});
// Phase 8: try a booking refund again after Razorpay kept refusing it.
router.post("/payouts/owner/:id/booking/:bid/refund", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    if (!isId(String(req.params.bid || ""))) return res.status(404).send("Not found.");
    const Booking = require("../models/booking");
    const r = await Booking.updateOne({ _id: req.params.bid, owner: rec.owner, "refund.status": "failed" }, { $set: { "refund.status": "pending", "refund.tries": 0, "refund.error": "" } });
    if (!r.modifiedCount) return res.redirect(back(rec.owner, "err", "That refund is not waiting for a retry."));
    try { await require("../utils/bookings").settle(req.params.bid); }
    catch (e) { return res.redirect(back(rec.owner, "err", "Razorpay did not accept it yet: " + require("../utils/payouts").redact(e.message).slice(0, 160) + ". It is tried again every 15 minutes.")); }
    res.redirect(back(rec.owner, "saved", "refunded"));
  } catch (err) {
    console.error("Admin booking refund error:", err.message);
    res.status(500).send("That could not be done. Please try again.");
  }
});

// Phase 8: a second payment on a booking was refunded in the Razorpay Dashboard: take it off the list.
router.post("/payouts/owner/:id/booking/:bid/extra-done", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    const pid = String((req.body || {}).payment || "");
    if (!isId(String(req.params.bid || "")) || !/^pay_[A-Za-z0-9]{6,40}$/.test(pid)) return res.status(404).send("Not found.");
    await require("../models/booking").updateOne({ _id: req.params.bid, owner: rec.owner }, { $pull: { extraPayments: pid }, $push: { history: { at: new Date(), text: `Second payment ${pid} refunded in Razorpay (marked by HostelNode admin)`, by: admin.email || admin.name || "admin" } } });
    res.redirect(back(rec.owner, "saved", "extra"));
  } catch (err) {
    console.error("Admin booking extra payment error:", err.message);
    res.status(500).send("That could not be saved. Please try again.");
  }
});

// A transfer Razorpay says failed (for example low balance): send the owner's share again.
router.post("/payouts/owner/:id/payment/:pid/retry", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    if (!isId(String(req.params.pid || ""))) return res.status(404).send("Not found.");
    const p = await Payment.findOne({ _id: req.params.pid, user: rec.owner, "recordedBy.role": "tenant" }, { _id: 1, amountPaid: 1, tenantName: 1 }).lean();
    if (!p) return res.status(404).send("Not found.");
    try { await require("../utils/onlineRent").retryTransfer(p._id); }
    catch (e) { return res.redirect(back(rec.owner, "err", e.code ? e.message : "Razorpay did not accept it: " + require("../utils/payouts").redact(e.message).slice(0, 160))); }
    const by = admin.email || admin.name || "admin";
    await PayoutAccount.updateOne({ _id: rec._id }, { $push: { history: { $each: [{ at: new Date(), text: `Payout sent again for ${p.tenantName || "a tenant"}'s online rent`, by }], $slice: -50 } } });
    res.redirect(back(rec.owner, "saved", "retried"));
  } catch (err) {
    console.error("Admin payout retry error:", err.message);
    res.status(500).send("That could not be done. Please try again.");
  }
});

// An earlier try finished at Razorpay but the answer never came back: link its ids by hand
// (from Razorpay Dashboard → Route → Accounts). Only fills ids that are still empty.
router.post("/payouts/owner/:id/link", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await me(req, res); if (!admin) return;
    const rec = await loadOne(req, res); if (!rec) return;
    const accountId = String(req.body.accountId || "").trim(), productId = String(req.body.productId || "").trim();
    const set = {};
    if (accountId && !rec.accountId) { if (!/^acc_[A-Za-z0-9]{6,30}$/.test(accountId) || /^acc_prd_/.test(accountId)) return res.redirect(back(rec.owner, "err", "The account id looks like acc_ followed by letters and digits.")); set.accountId = accountId; }
    if (productId && !rec.productId) {
      if (!/^acc_prd_[A-Za-z0-9]{6,30}$/.test(productId)) return res.redirect(back(rec.owner, "err", "The product id looks like acc_prd_ followed by letters and digits."));
      if (!rec.accountId && !set.accountId) return res.redirect(back(rec.owner, "err", "Link the account id first (the product belongs to an account)."));
      set.productId = productId;
    }
    if (!Object.keys(set).length) return res.redirect(back(rec.owner, "err", "Nothing to link."));
    if (set.accountId && await PayoutAccount.exists({ accountId: set.accountId, _id: { $ne: rec._id } })) return res.redirect(back(rec.owner, "err", "That account id is already linked to another owner."));
    const by = admin.email || admin.name || "admin";
    // Only into ids that are still empty (the owner's own submit may have filled one meanwhile).
    // (mode is cleared: the owner dashboard confirms with Razorpay that the account is this owner's before using it.)
    const where = { _id: rec._id };
    if (set.accountId) where.accountId = { $in: ["", null] };
    if (set.productId) where.productId = { $in: ["", null] };
    const w = await PayoutAccount.updateOne(where, { $set: Object.assign({}, set, set.accountId ? { mode: "", stakeholderId: "" } : {}, { lastError: "" }), $push: { history: { $each: [{ at: new Date(), text: "Razorpay ids linked by HostelNode: " + Object.values(set).join(", "), by }], $slice: -50 } } });
    if (!w.matchedCount) return res.redirect(back(rec.owner, "err", "The owner's details changed meanwhile. Reload and check again."));
    res.redirect(back(rec.owner, "saved", "link"));
  } catch (err) {
    console.error("Admin payout link error:", err.message);
    res.status(500).send("That could not be saved. Please try again.");
  }
});

module.exports = router;
