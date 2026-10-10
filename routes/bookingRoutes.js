/* ============================================================
   routes/bookingRoutes.js  —  Property Operations Phase 8: book a bed (hostelnode.com)
   Mounted at / in app.js (before the student routes).

     GET  /student/book/:listingId              book a bed: room type, move-in date, KYC, amount, rule (?type=&d=)
     POST /student/book/:listingId/kyc          verify with DigiLocker, then come back here
     POST /student/book/:listingId/order        start the Razorpay order (JSON)
     POST /student/bookings/verify              the browser's return after paying (JSON)
     GET  /student/bookings                     My bookings
     GET  /student/bookings/:id                 one booking (the result page after paying: ?w=1)
     POST /student/bookings/:id/cancel          cancel (the refund is shown before)

   Amounts and free beds are worked out on the server (utils/bookings.js,
   shared with the owner dashboard). A booking counts only after Razorpay
   confirms the money was collected.
============================================================ */
const express = require("express");
const router = express.Router();
const moment = require("moment-timezone");
const { optionalStudentAuth } = require("../Middlewares/jwtAuth");
const Student = require("../models/studentSchema");
const Listing = require("../models/listingProperty");
const Booking = require("../models/booking");
const PayoutSettings = require("../models/payoutSettings");
const BK = require("../utils/bookings");
const OR = require("../utils/onlineRent");
const rzp = require("../utils/razorpay");
const { TZ } = require("../utils/tenantOps");

const isId = v => typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);
const json = res => res.set("Cache-Control", "no-store");
const mainSite = req => {
  const set = String(process.env.HN_MAIN_SITE_URL || "").trim().replace(/\/$/, "");
  if (/^https?:\/\/[^\s"'<>]+$/.test(set)) return set;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
};
const loginUrl = next => "/student/login?next=" + encodeURIComponent(next);
const pick = (table, k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(table, k) ? table[k] : "");

async function me(req) {
  if (!req.student || !req.student.id) return null;
  const st = await Student.findById(req.student.id, { firstName: 1, lastName: 1, phone: 1, email: 1, status: 1 }).lean();
  return st && (!st.status || st.status === "Active") ? st : null;
}
const liveListing = id => (isId(id) ? Listing.findOne({ _id: id, status: "Approved" }, { title: 1, slug: 1, owner: 1, linkedHostel: 1, rooms: 1, booking: 1, location: 1, images: 1 }).lean() : null);

const WHY = {
  off: "Booking online is not available right now. Contact the owner instead.",
  not_on: "This PG does not take bookings online. Contact the owner instead.",
  not_linked: "This PG does not take bookings online yet. Contact the owner instead.",
  no_account: "This PG does not take bookings online yet. Contact the owner instead.",
};
const MSG = { cancelled: "Booking cancelled. Your refund is on its way (usually 5–7 working days to your bank)." };

/* ── Book a bed ────────────────────────────────────────────── */
router.get("/student/book/:listingId", optionalStudentAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const here = req.originalUrl;
    const student = await me(req);
    if (!student) return res.redirect(loginUrl(here));
    const listing = await liveListing(String(req.params.listingId));
    if (!listing) return res.status(404).send("Listing not found.");
    const av = await BK.bookability(listing);
    const open = await Booking.findOne({ student: student._id, listing: listing._id, status: { $in: BK.OPEN } }, { _id: 1 }).lean();
    if (open) return res.redirect(`/student/bookings/${open._id}`);
    const types = av.types || [];
    // Choices kept while the student verified with DigiLocker (they come back without them in the address).
    const kept = req.session && req.session.hnBook && req.session.hnBook.l === String(listing._id) ? req.session.hnBook : null;
    const qType = req.query.type !== undefined ? req.query.type : kept ? kept.type : undefined;
    const qDate = req.query.d !== undefined ? req.query.d : kept ? kept.d : undefined;
    let t = qType !== undefined && Number.isInteger(Number(qType)) ? types[Number(qType)] : null;
    if (!t || !t.can) t = types.find(x => x.can) || null;
    const r = BK.moveInRange();
    const d = BK.dateIn(qDate);
    const moveIn = d && !d.isBefore(r.min) && !d.isAfter(r.max) ? d.format("YYYY-MM-DD") : r.min.format("YYYY-MM-DD");
    const kyc = await BK.kycOf(student);
    const q = av.on && t ? OR.quote(t.amount, await PayoutSettings.read(), av.account) : null;
    const s = av.settings;
    res.render("booking/book.ejs", {
      student, listing, av, why: WHY[av.why] || "", types, t, q, moveIn, min: r.min.format("YYYY-MM-DD"), max: r.max.format("YYYY-MM-DD"), maxText: r.max.format("D MMM"),
      kyc, rule: BK.ruleText({ after: s.refundAfter, days: s.refundDays }), countsTowards: s.countsTowards, kycErr: req.query.kyc === "err",
      feeLabel: q && q.feePaidBy === "tenant" && q.fee ? (await PayoutSettings.read()).feeType === "fixed" ? "" : " (" + (await PayoutSettings.read()).feeValue + "%)" : "",
      pay: { listing: String(listing._id), keyId: rzp.keyId(), testMode: String(rzp.keyId()).startsWith("rzp_test_"), property: (av.hostel && av.hostel.hostelName) || listing.title,
        prefill: { name: [student.firstName, student.lastName].filter(Boolean).join(" "), contact: student.phone || "", email: student.email || "" } },
    });
  } catch (err) {
    console.error("Book page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

// Verify with DigiLocker (shared with this PG, as the page says), then back to this booking.
router.post("/student/book/:listingId/kyc", optionalStudentAuth, async (req, res) => {
  const id = String(req.params.listingId);
  const back = `/student/book/${isId(id) ? id : ""}`;
  try {
    const student = await me(req);
    if (!student) return res.redirect(loginUrl(back));
    const listing = await liveListing(id);
    if (!listing) return res.status(404).send("Listing not found.");
    const kyc = require("../utils/kyc");
    const s = await kyc.settings();
    if (!s.canVerify) return res.redirect(back + "?kyc=err");
    const k = await BK.kycOf(student);
    const bd = (req.body || {}).d;
    if (req.session) req.session.hnBook = { l: String(listing._id), type: String(Math.max(0, Math.floor(Number((req.body || {}).type)) || 0)), d: BK.dateIn(bd) ? String(bd) : "" };   // kept for the way back
    if (k.verified) return res.redirect(back);
    const hostel = listing.linkedHostel ? await require("../models/hostel").findById(listing.linkedHostel, { owner: 1 }).lean() : null;
    const { url } = await kyc.start({ phone: student.phone, via: "student", studentId: student._id, hostelId: hostel ? hostel._id : null, shareOwnerId: hostel ? hostel.owner : null,
      returnUrl: `${mainSite(req)}/kyc/return?book=${listing._id}` });
    res.redirect(url);
  } catch (err) {
    console.error("Book KYC start error:", err.message);
    res.redirect(back + "?kyc=err");
  }
});

router.post("/student/book/:listingId/order", optionalStudentAuth, async (req, res) => {
  json(res);
  try {
    const student = await me(req);
    if (!student) return res.status(401).json({ ok: false, error: "Please log in again.", redirect: loginUrl(`/student/book/${req.params.listingId}`) });
    const listing = await liveListing(String(req.params.listingId));
    if (!listing) return res.status(404).json({ ok: false, error: "This listing is not available." });
    const b = req.body || {};
    const { booking } = await BK.startOrder({ listing, student, typeIndex: Number(b.type), moveIn: String(b.moveIn || "") });
    res.json({ ok: true, orderId: booking.razorpayOrderId, amount: booking.amountPaise, recordId: String(booking._id) });
  } catch (err) {
    if (["not_available", "type", "date", "kyc", "twice", "amount"].includes(err.code)) return res.status(400).json({ ok: false, error: err.message, code: err.code });
    console.error("Booking order error:", err.message);
    res.status(502).json({ ok: false, error: "We could not start the payment. Nothing was charged. Please try again." });
  }
});

router.post("/student/bookings/verify", optionalStudentAuth, async (req, res) => {
  json(res);
  try {
    if (!req.student || !req.student.id) return res.status(401).json({ ok: false, error: "Please log in again." });
    const b = req.body || {};
    const orderId = typeof b.razorpay_order_id === "string" ? b.razorpay_order_id : "";
    const paymentId = typeof b.razorpay_payment_id === "string" ? b.razorpay_payment_id : "";
    const signature = typeof b.razorpay_signature === "string" ? b.razorpay_signature : "";
    const rec = orderId ? await Booking.findOne({ razorpayOrderId: orderId, student: req.student.id }, { _id: 1, amountPaise: 1, status: 1, razorpayPaymentId: 1 }).lean() : null;
    if (!rec) return res.status(400).json({ ok: false, error: "We could not match this payment. If money was deducted, it is recorded automatically or refunded." });
    const done = `/student/bookings/${rec._id}`;
    if (!rzp.validCheckoutSignature({ orderId, paymentId, signature })) return res.status(400).json({ ok: false, error: "We could not confirm this payment yet.", redirect: done + "?w=1" });
    // Already paid with another payment (a second tab): this one is not collected (Razorpay returns it); one collected anyway is noted for a refund.
    if (rec.status !== "pending_payment" && rec.razorpayPaymentId && rec.razorpayPaymentId !== paymentId) {
      try { const p2 = await rzp.fetchPayment(paymentId); if (p2 && p2.order_id === orderId && p2.status === "captured") await BK.fulfil({ id: rec._id }, { paymentId, via: "checkout" }); }
      catch (e) { console.error("Booking verify: second payment check (non-fatal):", e.message); }
      return res.json({ ok: true, redirect: done + "?dup=1" });
    }
    // Recorded only once Razorpay shows the money collected; held money ("authorized") is collected here.
    let pay;
    try {
      pay = await rzp.fetchPayment(paymentId);
      if (pay.order_id !== orderId || Number(pay.amount) !== rec.amountPaise || pay.currency !== "INR") return res.status(400).json({ ok: false, error: "We could not confirm this payment yet.", redirect: done + "?w=1" });
      if (pay.status === "authorized") {
        try { pay = await rzp.capturePayment(paymentId, rec.amountPaise); } catch (e) { pay = await rzp.fetchPayment(paymentId); }
      }
    } catch (err) {
      console.error("Booking verify: Razorpay could not be reached; the result page checks again:", err.message);
      return res.json({ ok: true, waiting: true, redirect: done + "?w=1" });
    }
    if (!pay || pay.status !== "captured") return res.json({ ok: true, waiting: true, redirect: done + "?w=1" });
    const result = await BK.fulfil({ id: rec._id }, { paymentId, method: pay.method || "", via: "checkout", at: pay.created_at });
    BK.afterPaid(result);
    forgetLink(req.student.id);   // "My bookings" shows in the menu at once
    res.json({ ok: !!result.ok, redirect: done + (!result.ok || result.pending ? "?w=1" : "") });
  } catch (err) {
    console.error("Booking verify error:", err.message);
    res.status(500).json({ ok: false, error: "Your payment is being confirmed. Please check My bookings in a minute." });
  }
});

/* ── My bookings ───────────────────────────────────────────── */
// Paid but we have not heard: ask Razorpay about the order (at most every 5 seconds per booking).
const lastAsk = new Map();
async function checkOrder(b) {
  if (b.status !== "pending_payment" || Date.now() - new Date(b.createdAt) > 3 * 86400e3) return;
  const k = String(b._id);
  if (Date.now() - (lastAsk.get(k) || 0) < 5000) return;
  lastAsk.set(k, Date.now());
  if (lastAsk.size > 5000) lastAsk.clear();
  try {
    const list = await rzp.call("GET", `/v1/orders/${b.razorpayOrderId}/payments`);
    const items = Array.isArray(list && list.items) ? list.items : [];
    let pay = items.find(p => p && p.status === "captured" && Number(p.amount) === b.amountPaise && p.currency === "INR" && !(Number(p.amount_refunded) > 0));
    if (!pay) {
      const held = items.find(p => p && p.status === "authorized" && Number(p.amount) === b.amountPaise && p.currency === "INR");
      if (held) { try { const c = await rzp.capturePayment(held.id, b.amountPaise); if (c && c.status === "captured") pay = c; } catch { /* the webhook or the next look */ } }
    }
    if (pay) BK.afterPaid(await BK.fulfil({ id: b._id }, { paymentId: pay.id, method: pay.method || "", via: "check", at: pay.created_at }));
  } catch (err) { console.error("Booking order check (non-fatal):", err.message); }
}
function viewOf(b) {
  const st = BK.STATUS[b.status] || { label: "Not paid", tone: "slate" };
  const preview = BK.OPEN.includes(b.status) ? BK.cancelPreview(b, "student") : null;
  return {
    id: String(b._id), no: b.bookingNo, property: b.property, roomType: b.roomType, moveIn: BK.day(b.moveIn), status: b.status, label: st.label, tone: st.tone,
    bed: b.bed && b.bed.label ? `Room ${b.bed.roomNumber}, bed ${b.bed.label}` : "", amount: BK.inr(b.amount), total: BK.inr(b.total), paidAt: b.paidAt ? BK.dayTime(b.paidAt) : "",
    answerBy: b.status === "requested" ? BK.dayTime(BK.answerBy(b)) : "", countsTowards: b.countsTowards, reason: b.reason || "", refund: BK.refundLine(b),
    rule: BK.ruleText(b.rule || {}), cancel: preview ? { refund: BK.inr(preview.refund), paise: Math.round(preview.refund * 100), none: preview.refund <= 0, full: preview.mode === "full" } : null,
    listing: String(b.listing),
  };
}
router.get("/student/bookings", optionalStudentAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const student = await me(req);
    if (!student) return res.redirect(loginUrl("/student/bookings"));
    const list = await Booking.find({ student: student._id, status: { $ne: "pending_payment" } }).sort({ createdAt: -1 }).limit(50).lean();
    res.render("booking/list.ejs", { student, list: list.map(viewOf), msg: pick(MSG, req.query.msg), err: "" });
  } catch (err) {
    console.error("My bookings error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});
router.get("/student/bookings/:id", optionalStudentAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const student = await me(req);
    if (!student) return res.redirect(loginUrl("/student/bookings"));
    if (!isId(String(req.params.id))) return res.redirect("/student/bookings");
    let b = await Booking.findOne({ _id: req.params.id, student: student._id }).lean();
    if (!b) return res.redirect("/student/bookings");
    if (b.status === "pending_payment") { await checkOrder(b); b = await Booking.findById(b._id).lean(); }
    const state = b.status !== "pending_payment" ? "booked" : req.query.w === "1" ? "pending" : "notpaid";
    res.render("booking/one.ejs", { student, b: viewOf(b), state, dup: req.query.dup === "1", changed: req.query.changed === "1", fresh: !!(b.paidAt && Date.now() - new Date(b.paidAt) < 10 * 60e3 && b.status === "requested"),
      waOn: !!String(process.env.WA_TEMPLATE_BOOKING_REQUESTED || "").trim(), err: "" });
  } catch (err) {
    console.error("Booking page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});
router.post("/student/bookings/:id/cancel", optionalStudentAuth, async (req, res) => {
  const id = String(req.params.id);
  try {
    const student = await me(req);
    if (!student) return res.redirect(loginUrl("/student/bookings"));
    if (!isId(id)) return res.redirect("/student/bookings");
    const expect = /^\d{1,9}$/.test(String((req.body || {}).expect || "")) ? Number(req.body.expect) : null;   // the refund the student was shown
    try { await BK.close({ id, kind: "cancelled", by: "student", byName: [student.firstName, student.lastName].filter(Boolean).join(" "), studentId: student._id, expectRefund: expect }); }
    catch (e) {
      if (e.code === "changed") return res.redirect(`/student/bookings/${id}?changed=1#cancel`);
      if (e.code === "state" || e.code === "missing") return res.redirect(`/student/bookings/${id}`);
      if (e.code !== "busy") console.error("Booking cancel (refund will retry):", e.message);
    }
    res.redirect("/student/bookings?msg=cancelled");
  } catch (err) {
    console.error("Booking cancel error:", err.message);
    res.status(500).send("That could not be done. Please try again.");
  }
});

/* ── "My bookings" in the student menu: only for students who have booked ── */
const hasBooked = new Map();   // student id → { on, at } (a minute)
async function bookingsLink(req, res, next) {
  try {
    const st = res.locals.student;
    res.locals.hnMyBookings = false;
    if (st && st._id) {
      const k = String(st._id), hit = hasBooked.get(k);
      if (hit && Date.now() - hit.at < 60e3) res.locals.hnMyBookings = hit.on;
      else {
        const on = (await Booking.countDocuments({ student: st._id, status: { $ne: "pending_payment" } }, { limit: 1 })) > 0;
        if (hasBooked.size > 20000) hasBooked.clear();
        hasBooked.set(k, { on, at: Date.now() });
        res.locals.hnMyBookings = on;
      }
    }
  } catch (err) { console.error("My bookings link (non-fatal):", err.message); }
  next();
}
const forgetLink = id => hasBooked.delete(String(id));

module.exports = router;
module.exports.bookingsLink = bookingsLink;
module.exports.forgetLink = forgetLink;
