/* ============================================================
   routes/myPgRoutes.js  —  Property Operations Phase 7: My PG (hostelnode.com)
   Mounted at / in app.js (before the student routes).

     GET  /student/my-pg                    the tenant's PG: due now, months, receipts, deposit, notice
     GET  /student/my-pg/pay                pay rent: amount, fee, total (?m=<stay>&amount=)
     POST /student/my-pg/order              start a Razorpay order (JSON)
     POST /student/my-pg/verify             the browser's return after paying (JSON)
     GET  /student/my-pg/paid/:id           result: paid / confirming / not paid
     GET  /student/my-pg/receipt/:pid.pdf   a receipt (any payment of their own stay, cash ones too)
     GET  /student/my-pg/notice             give notice to leave (?m=<stay>)
     POST /student/my-pg/notice             send the request to the owner
     POST /student/my-pg/notice/withdraw    take back a request still waiting

   A student sees a stay only when its tenant mobile number is their own
   HostelNode login number (verified with OTP). Amounts are worked out on
   the server; a payment is recorded only after Razorpay confirms it
   (utils/onlineRent.js, shared with the owner dashboard's webhook).
============================================================ */
const express = require("express");
const router = express.Router();
const moment = require("moment-timezone");
const { optionalStudentAuth } = require("../Middlewares/jwtAuth");
const Student = require("../models/studentSchema");
const Member = require("../models/member");
const Hostel = require("../models/hostel");
const Room = require("../models/room");
const Floor = require("../models/floor");
const Payment = require("../models/payment");
const RentOrder = require("../models/rentOrder");
const PayoutSettings = require("../models/payoutSettings");
const OR = require("../utils/onlineRent");
const L = require("../utils/ledger");
const T = require("../utils/tenants");
const P = require("../utils/payments");
const PDF = require("../utils/ledgerPdf");
const rzp = require("../utils/razorpay");
const { TZ } = require("../utils/tenantOps");

const HOME = "/student/my-pg";
const isId = v => typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);
const clean = (s, max = 120) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
const dayTime = d => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
const loginUrl = () => "/student/login?next=" + encodeURIComponent(HOME);
const json = res => res.set("Cache-Control", "no-store");

// Logged in? Otherwise the page explains My PG and offers log in / sign up; actions answer 401.
function needStudent(req, res, next) {
  if (req.student && req.student.id) return next();
  if (req.method === "GET") return res.redirect(loginUrl());
  return res.status(401).json({ ok: false, error: "Please log in again.", redirect: loginUrl() });
}

/** The logged-in student, and the stays that belong to their mobile number. */
async function mine(req) {
  const student = await Student.findById(req.student.id, { firstName: 1, lastName: 1, phone: 1, email: 1, profileImage: 1, status: 1 }).lean();
  if (!student || (student.status && student.status !== "Active")) return { student: null, stays: [] };   // (as at login: active accounts only)
  return { student, stays: await OR.staysFor(student.phone) };
}
/** One of the student's stays (by ?m=, or their newest), with payments. */
async function stayOf(req, id) {
  const { student, stays } = await mine(req);
  if (!student) return { student: null };
  const pick = (id && stays.find(s => String(s._id) === String(id))) || (!id ? stays[0] : null);
  const m = pick ? await Member.findById(pick._id).populate("payments") : null;
  return { student, stays, m };
}

/** Everything the My PG page shows for one stay. */
async function viewOf(m) {
  const [hostel, room] = await Promise.all([
    Hostel.findById(m.hostel, { hostelName: 1, city: 1, owner: 1, onlineRent: 1 }).lean(),
    m.assignedRoom_id ? Room.findById(m.assignedRoom_id).lean() : null,
  ]);
  const floor = room && room.floor_id ? await Floor.findById(room.floor_id, { floor_name: 1 }).lean() : null;
  const lg = L.ledgerOf(m);
  const av = await OR.availability(m, { hostel });
  const dueDay = T.dueDayOf(m);
  const live = lg.payments.slice().reverse();   // newest first
  const settled = !!(m.settlement && m.settlement.at && !m.settlement.undoneAt);
  const owing = lg.owing.slice();
  const oldest = owing[0];
  return {
    id: String(m._id), name: m.name, first: String(m.name || "").split(" ")[0],
    property: (hostel && hostel.hostelName) || "Your PG", city: (hostel && hostel.city) || "",
    roomLine: [m.assignedRoom ? "Room " + m.assignedRoom : "", m.bedLabel ? "bed " + m.bedLabel : "", floor && floor.floor_name ? floor.floor_name : ""].filter(Boolean).join(" · "),
    since: T.dayYear(m.joiningDate), rent: OR.rentOf(m, room), dueDay: dueDay ? T.ordinal(dueDay) : "",
    due: lg.due, advance: lg.advance, owing,
    duePill: !lg.due ? null : lg.notYetDue ? { text: oldest && oldest.status ? oldest.status.label : "Coming up", tone: "blue" } : lg.daysLate > 0 ? { text: `Overdue · ${lg.daysLate} day${lg.daysLate === 1 ? "" : "s"}`, tone: "bad" } : { text: "Due today", tone: "warn" },
    months: lg.months.filter(mo => mo.charged > 0).map(mo => {
      const rentAmt = mo.charges.filter(c => c.kind === "rent").reduce((s, c) => s + c.amount, 0);
      const extras = mo.charges.filter(c => c.kind !== "rent");
      const parts = [rentAmt ? "Rent " + T.inr(rentAmt) : ""].concat(extras.map(c => (c.kind === "extra" ? (L.CATEGORIES[c.entry.category] || L.CATEGORIES.other).label.toLowerCase() : c.label.toLowerCase()) + " " + T.inr(c.amount))).filter(Boolean);
      const sub = parts.join(" + ").replace(/^./, c => c.toUpperCase()) + (mo.balance > 0 && mo.paid > 0 ? " · paid " + T.inr(mo.paid) : "");
      const pill = !mo.balance ? { text: "Paid", tone: "ok" } : mo.status.key === "upcoming" ? { text: T.inr(mo.balance) + " · " + mo.status.label.toLowerCase(), tone: "blue" } : { text: T.inr(mo.balance) + " due", tone: mo.paid > 0 ? "warn" : "bad" };
      return { label: mo.label, sub, pill };
    }),
    receipts: live.slice(0, 30).map(p => ({
      id: String(p._id), amount: T.inr(p.amountPaid), way: L.kindOf(p) === "depositAdjust" ? "from the deposit" : wayOf(p.paymentMode),
      when: T.day(p.paymentDate), no: p.receiptNo || "", by: p.recordedBy && p.recordedBy.role === "tenant" ? "paid by you" : "recorded by the owner",
      pdf: L.kindOf(p) === "payment",
    })),
    deposit: { held: settled ? 0 : Number(m.depositPaid) || 0, settled },
    notice: noticeView(m),
    online: { can: av.can, why: av.why },
  };
}
// "cash", "bank transfer", "UPI", "UPI online", "card online" (as the tenant reads it).
function wayOf(mode) {
  const t = String(mode || "").replace(" (online)", " online").trim();
  return /^(UPI|EMI)\b/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}
function noticeView(m) {
  const r = OR.noticeOf(m);
  if (m.leavingDate) return { state: "set", date: T.dayYear(m.leavingDate), fromRequest: !!(r && r.status === "accepted") };
  if (r && r.status === "pending") return { state: "pending", date: T.dayYear(r.date), reason: r.reason || "", at: T.day(r.at) };
  if (r && r.status === "declined") return { state: "declined", date: T.dayYear(r.date), at: T.day(r.decidedAt) };
  return { state: "none" };
}
const pick = (table, k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(table, k) ? table[k] : "");
// Messages after an action (only these: the address never carries text to show).
const MSG = {
  nothing_due: "Nothing is due right now.",
  sent: "Sent. The owner will confirm your leaving date.",
  already_set: "Your leaving date is already set. Talk to the owner to change it.",
  withdrawn: "Request taken back. You are staying on.",
  nothing_waiting: "There was no request waiting.",
};
const NOTICE_ERR = {
  date: "Choose the date you plan to leave.",
  past: "Choose today or a later date.",
  far: "Choose a date within a year from today.",
  before: "That date is before you joined.",
};
const WHY = {
  cash_only: "This PG takes rent directly. Pay the owner in cash or by UPI, and they record it here.",
  no_account: "Online payment is not set up for this PG yet. Pay the owner directly for now.",
  off: "Online payment is not available right now. Pay the owner directly for now.",
  property: "Online payment is not available for this PG. Pay the owner directly.",
  left: "",
};

/* ── My PG ─────────────────────────────────────────────────── */
router.get(HOME, optionalStudentAuth, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (!req.student || !req.student.id) return res.render("mypg/landing.ejs", { loginHref: loginUrl(), student: null });
    const { student, stays, m } = await stayOf(req, isId(String(req.query.m || "")) ? String(req.query.m) : "");
    if (!student) return res.redirect(loginUrl());
    if (!m) return res.render("mypg/empty.ejs", { student, phone: student.phone, asked: !!req.query.m });
    const v = await viewOf(m);
    const others = [];
    if (stays.length > 1) for (const s of stays) others.push({ id: String(s._id), name: ((await Hostel.findById(s.hostel, { hostelName: 1 }).lean()) || {}).hostelName || "PG", on: String(s._id) === v.id });
    res.render("mypg/home.ejs", { student, v, others, why: WHY[v.online.why] || "", flash: { msg: pick(MSG, req.query.msg), err: pick(WHY, req.query.err) }, receiptWa: PDF.receiptOn() });
  } catch (err) {
    console.error("My PG page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

/* ── Pay rent ──────────────────────────────────────────────── */
// The rent lines an amount pays, oldest first (what the tenant sees before paying).
function linesFor(owing, amount) {
  const out = [];
  let left = amount;
  for (const o of owing) {
    if (left <= 0) break;
    const take = Math.min(left, o.amount);
    out.push({ label: o.label + (take < o.amount ? " (part)" : ""), amount: take });
    left -= take;
  }
  return out;
}
router.get(HOME + "/pay", optionalStudentAuth, needStudent, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { student, m } = await stayOf(req, isId(String(req.query.m || "")) ? String(req.query.m) : "");
    if (!student) return res.redirect(loginUrl());
    if (!m) return res.redirect(HOME);
    const v = await viewOf(m);
    if (!v.online.can) return res.redirect(HOME + "?m=" + v.id + "&err=" + (WHY[v.online.why] ? v.online.why : "off"));
    if (v.due <= 0) return res.redirect(HOME + "?m=" + v.id + "&msg=nothing_due");
    const min = Math.min(OR.MIN, v.due);
    const asked = String(req.query.amount || "").replace(/[,₹\s]/g, "");
    let amount = v.due, error = "";
    if (asked) {
      const n = Number(asked);
      if (Number.isInteger(n) && n >= min && n <= v.due) amount = n;
      else error = `Choose an amount from ${T.inr(min)} to ${T.inr(v.due)}.`;
    }
    const av = await OR.availability(m);
    const settings = await PayoutSettings.read();
    const q = OR.quote(amount, settings, av.account);
    res.render("mypg/pay.ejs", {
      student, v, amount, min, error, q, lines: linesFor(v.owing, amount), changing: req.query.change === "1" || !!error,
      feeLabel: settings.feeType === "fixed" ? "" : " (" + (Number(settings.feeValue) || 0) + "%)",
      pay: { m: v.id, amount, keyId: rzp.keyId(), testMode: String(rzp.keyId()).startsWith("rzp_test_"), property: v.property,
        prefill: { name: [student.firstName, student.lastName].filter(Boolean).join(" "), contact: student.phone || "", email: student.email || "" } },
    });
  } catch (err) {
    console.error("My PG pay page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

router.post(HOME + "/order", optionalStudentAuth, needStudent, async (req, res) => {
  json(res);
  try {
    const b = req.body || {};
    const { student, m } = await stayOf(req, isId(String(b.m || "")) ? String(b.m) : "__none__");
    if (!student) return res.status(401).json({ ok: false, error: "Please log in again.", redirect: loginUrl() });
    if (!m) return res.status(404).json({ ok: false, error: "We could not find your stay. Please go back to My PG." });
    const amount = Number(String(b.amount || "").replace(/[,₹\s]/g, ""));
    const { order } = await OR.startOrder({ member: m, studentId: student._id, amount });
    res.json({ ok: true, orderId: order.razorpayOrderId, amount: order.amountPaise, recordId: String(order._id) });
  } catch (err) {
    if (err.code === "amount" || err.code === "nothing_due" || err.code === "not_available") return res.status(400).json({ ok: false, error: err.message });
    console.error("My PG order error:", err.message);
    res.status(502).json({ ok: false, error: "We could not start the payment. Nothing was charged. Please try again." });
  }
});

router.post(HOME + "/verify", optionalStudentAuth, needStudent, async (req, res) => {
  json(res);
  try {
    const b = req.body || {};
    const orderId = typeof b.razorpay_order_id === "string" ? b.razorpay_order_id : "";
    const paymentId = typeof b.razorpay_payment_id === "string" ? b.razorpay_payment_id : "";
    const signature = typeof b.razorpay_signature === "string" ? b.razorpay_signature : "";
    // The order must be this student's own.
    const rec = orderId ? await RentOrder.findOne({ razorpayOrderId: orderId, student: req.student.id }).select("_id amountPaise status razorpayPaymentId").lean() : null;
    if (!rec) return res.status(400).json({ ok: false, error: "We could not match this payment. If money was deducted, it is recorded automatically or refunded." });
    const doneUrl = `${HOME}/paid/${rec._id}`;
    if (!rzp.validCheckoutSignature({ orderId, paymentId, signature })) {
      console.error("My PG verify: bad signature for order", orderId);
      return res.status(400).json({ ok: false, error: "We could not confirm this payment yet.", redirect: doneUrl + "?w=1" });
    }
    // The signature is genuine. Make sure the money is collected ("captured") for this order and amount;
    // if Razorpay only holds it ("authorized"), collect it. If Razorpay cannot be reached right now,
    // the genuine signature is accepted (Razorpay's standard check).
    // Already paid with another payment (a second tab): this one is not collected, so Razorpay returns it.
    // (If Razorpay collected it anyway, it is noted for HostelNode to refund; it is never counted as rent.)
    if (rec.status === "paid" && rec.razorpayPaymentId && rec.razorpayPaymentId !== paymentId) {
      try { const p2 = await rzp.fetchPayment(paymentId); if (p2 && p2.order_id === orderId && p2.status === "captured") await OR.fulfil({ id: rec._id }, { paymentId, via: "checkout" }); }
      catch (e) { console.error("My PG verify: second payment check (non-fatal):", e.message); }
      return res.json({ ok: true, redirect: doneUrl + "?dup=1" });
    }
    // Rent is recorded only once Razorpay shows the money collected ("captured")
    // for this order and amount; if Razorpay only holds it ("authorized"), it is collected here. If Razorpay
    // cannot be reached right now, the result page (and the webhook) record it as soon as it can be checked.
    let pay;
    try {
      pay = await rzp.fetchPayment(paymentId);
      if (pay.order_id !== orderId || Number(pay.amount) !== rec.amountPaise || pay.currency !== "INR") {
        console.error("My PG verify: payment does not match order", orderId, paymentId);
        return res.status(400).json({ ok: false, error: "We could not confirm this payment yet.", redirect: doneUrl + "?w=1" });
      }
      if (pay.status === "authorized") {
        try { pay = await rzp.capturePayment(paymentId, rec.amountPaise); }
        catch (e) { pay = await rzp.fetchPayment(paymentId); }
      }
    } catch (err) {
      console.error("My PG verify: Razorpay could not be reached; the result page checks again:", err.message);
      return res.json({ ok: true, waiting: true, redirect: doneUrl + "?w=1" });
    }
    if (!pay || pay.status !== "captured") return res.json({ ok: true, waiting: true, redirect: doneUrl + "?w=1" });
    const result = await OR.fulfil({ id: rec._id }, { paymentId, method: pay.method || "", via: "checkout", at: pay.created_at });
    OR.afterPaid(result);
    res.json({ ok: !!result.ok, redirect: doneUrl + (result.duplicate ? "?dup=1" : !result.ok || result.pending ? "?w=1" : "") });
  } catch (err) {
    console.error("My PG verify error:", err.message);
    res.status(500).json({ ok: false, error: "Your payment is being confirmed. Please check My PG in a minute." });
  }
});

/* ── Result ────────────────────────────────────────────────── */
// The tenant came back but we have not heard from Razorpay: ask Razorpay about the order (at most every 5 seconds).
const lastAsk = new Map();
async function checkOrder(rec) {
  if (rec.status === "paid" || Date.now() - new Date(rec.createdAt) > 3 * 86400e3) return null;
  const k = String(rec._id);
  if (Date.now() - (lastAsk.get(k) || 0) < 5000) return null;
  lastAsk.set(k, Date.now());
  if (lastAsk.size > 5000) lastAsk.clear();
  try {
    const list = await rzp.call("GET", `/v1/orders/${rec.razorpayOrderId}/payments`);
    const items = Array.isArray(list && list.items) ? list.items : [];
    let pay = items.find(p => p && p.status === "captured" && Number(p.amount) === rec.amountPaise && p.currency === "INR");
    if (!pay) {
      const held = items.find(p => p && p.status === "authorized" && Number(p.amount) === rec.amountPaise && p.currency === "INR");
      if (held) { try { const c = await rzp.capturePayment(held.id, rec.amountPaise); if (c && c.status === "captured") pay = c; } catch { /* the webhook or the next look */ } }
    }
    if (!pay) return null;
    const result = await OR.fulfil({ id: rec._id }, { paymentId: pay.id, method: pay.method || "", via: "check", at: pay.created_at });
    OR.afterPaid(result);
    return result;
  } catch (err) {
    console.error("My PG order check (non-fatal):", err.message);
    return null;
  }
}
router.get(HOME + "/paid/:id", optionalStudentAuth, needStudent, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (!isId(String(req.params.id))) return res.redirect(HOME);
    let rec = await RentOrder.findOne({ _id: req.params.id, student: req.student.id }).lean();
    if (!rec) return res.redirect(HOME);
    if (rec.status !== "paid") { await checkOrder(rec); rec = await RentOrder.findById(rec._id).lean(); }
    const [student, hostel] = await Promise.all([Student.findById(req.student.id, { firstName: 1, phone: 1 }).lean(), Hostel.findById(rec.hostel, { hostelName: 1 }).lean()]);
    const entry = rec.payment ? await Payment.findById(rec.payment).lean() : null;
    const waiting = req.query.w === "1" && rec.status !== "paid";
    const state = entry ? "success" : waiting ? "pending" : "notpaid";
    res.render("mypg/paid.ejs", {
      student, state, rec, property: (hostel && hostel.hostelName) || "your PG", m: String(rec.member),
      done: entry ? {
        amount: T.inr(entry.amountPaid), total: rec.total !== rec.amount ? T.inr(rec.total) : "", when: dayTime(entry.paymentDate), receiptNo: entry.receiptNo || "",
        way: String(entry.paymentMode || "Online").replace(" (online)", ""), payId: rec.razorpayPaymentId, forText: P.forText(entry.appliedTo), dueAfter: typeof entry.dueAfter === "number" ? T.inr(entry.dueAfter) : "",
        receipt: `${HOME}/receipt/${entry._id}.pdf`,
      } : null,
      failure: rec.status === "failed" ? rec.failureReason : "", receiptWa: PDF.receiptOn(), dup: req.query.dup === "1",
    });
  } catch (err) {
    console.error("My PG result error:", err.message);
    res.status(500).send("Something went wrong. Please check My PG.");
  }
});

/* ── Receipts ──────────────────────────────────────────────── */
router.get(HOME + "/receipt/:pid.pdf", optionalStudentAuth, needStudent, async (req, res) => {
  try {
    if (!isId(String(req.params.pid))) return res.status(404).send("Receipt not found.");
    const p = await Payment.findById(req.params.pid).lean();
    if (!p || !(Number(p.amountPaid) > 0) || p.cancelledAt || L.kindOf(p) !== "payment") return res.status(404).send("Receipt not found.");
    const { stays } = await mine(req);
    if (!stays.some(s => String(s._id) === String(p.memberId))) return res.status(404).send("Receipt not found.");
    const m = await Member.findById(p.memberId).populate("payments");
    const r = await P.receiptFor(p.user, m, p);
    const pdf = PDF.buildReceiptPdf(r);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Receipt-${r.receiptNo.replace(/[^A-Za-z0-9-]/g, "")}.pdf"`, "Cache-Control": "private, no-store" });
    res.send(pdf);
  } catch (err) {
    console.error("My PG receipt error:", err.message);
    res.status(500).send("The receipt could not be made. Please try again.");
  }
});

/* ── Notice to leave ───────────────────────────────────────── */
const todayIST = () => moment().tz(TZ).startOf("day");
function dateIn(v) {
  const s = String(v || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = moment.tz(s, "YYYY-MM-DD", true, TZ);
  return d.isValid() ? d : null;
}
router.get(HOME + "/notice", optionalStudentAuth, needStudent, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { student, m } = await stayOf(req, isId(String(req.query.m || "")) ? String(req.query.m) : "");
    if (!student) return res.redirect(loginUrl());
    if (!m) return res.redirect(HOME);
    const v = await viewOf(m);
    res.render("mypg/notice.ejs", { student, v, error: pick(NOTICE_ERR, req.query.err), values: { date: "", reason: "" },
      min: todayIST().format("YYYY-MM-DD"), max: todayIST().add(1, "year").format("YYYY-MM-DD") });
  } catch (err) {
    console.error("My PG notice page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});
router.post(HOME + "/notice", optionalStudentAuth, needStudent, async (req, res) => {
  try {
    const b = req.body || {};
    const { student, m } = await stayOf(req, isId(String(b.m || "")) ? String(b.m) : "__none__");
    if (!student) return res.redirect(loginUrl());
    if (!m) return res.redirect(HOME);
    const back = err => res.redirect(`${HOME}/notice?m=${m._id}&err=${err}`);
    if (m.leavingDate) return res.redirect(`${HOME}?m=${m._id}&msg=already_set`);
    const d = dateIn(b.date);
    if (!d) return back("date");
    if (d.isBefore(todayIST())) return back("past");
    if (d.isAfter(todayIST().add(1, "year"))) return back("far");
    if (m.joiningDate && d.isBefore(moment(m.joiningDate).tz(TZ).startOf("day"))) return back("before");
    const ok = await OR.requestNotice(m, { date: d.toDate(), reason: clean(b.reason || "", 60) });
    if (!ok) return res.redirect(HOME);
    res.redirect(`${HOME}?m=${m._id}&msg=sent`);
  } catch (err) {
    console.error("My PG notice error:", err.message);
    res.status(500).send("That could not be sent. Please try again.");
  }
});
router.post(HOME + "/notice/withdraw", optionalStudentAuth, needStudent, async (req, res) => {
  try {
    const b = req.body || {};
    const { student, m } = await stayOf(req, isId(String(b.m || "")) ? String(b.m) : "__none__");
    if (!student) return res.redirect(loginUrl());
    if (!m) return res.redirect(HOME);
    const ok = await OR.withdrawNotice(m);
    res.redirect(`${HOME}?m=${m._id}&msg=${ok ? "withdrawn" : "nothing_waiting"}`);
  } catch (err) {
    console.error("My PG notice withdraw error:", err.message);
    res.status(500).send("That could not be done. Please try again.");
  }
});

/* ── "My PG" in the student menu: only for students who are tenants somewhere ── */
const linked = new Map();   // phone → { on, at } (a minute)
async function myPgLink(req, res, next) {
  try {
    const st = res.locals.student;
    res.locals.hnMyPg = false;
    if (st && st.phone) {
      const hit = linked.get(st.phone);
      if (hit && Date.now() - hit.at < 60e3) res.locals.hnMyPg = hit.on;
      else {
        const on = (await Member.countDocuments({ mobileNo: { $in: OR.mobileVariants(st.phone) }, leftDate: null, removedAt: null }, { limit: 1 })) > 0;
        if (linked.size > 20000) linked.clear();
        linked.set(st.phone, { on, at: Date.now() });
        res.locals.hnMyPg = on;
      }
    }
  } catch (err) {
    console.error("My PG link (non-fatal):", err.message);
  }
  next();
}

module.exports = router;
module.exports.myPgLink = myPgLink;
