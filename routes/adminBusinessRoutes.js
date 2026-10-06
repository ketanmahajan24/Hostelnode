/* ============================================================
   routes/adminBusinessRoutes.js  —  Subscriptions Phase 5
   Mounted at /admin in app.js (before the main admin router).

     GET /admin/subscriptions                the business view
     GET /admin/subscriptions/payments.csv   every plan payment, for Excel

   Admin-only and read-only: nothing on this page changes any record.
   All money figures come from the same "subscriptionpayments" records
   as /admin/payments, so the totals always agree.
============================================================ */

const express = require("express");
const router  = express.Router();

const Admin               = require("../models/admin");
const Owner               = require("../models/owner");
const Subscription        = require("../models/subscription");
const SubscriptionPayment = require("../models/subscriptionPayment");
const BillingSettings     = require("../models/billingSettings");
const { jwtAdminAuth } = require("../Middlewares/jwtAuth");

router.use("/subscriptions", (req, res, next) => (process.env.HN_BILLING === "0" ? next("router") : next()));

const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;
const MAX_ROWS = 50000;          // safety cap on how many records one page load reads
const SOON_DAYS = 14;

// "2026-10" for a moment, in India time
const monthKey = d => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 7);
const monthLabel = key => new Date(key + "-15T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

async function buildOverview(now = new Date()) {
  const [settings, ownerIds, activeSubs, paid, refunded] = await Promise.all([
    BillingSettings.read(),
    Owner.find().select("_id").limit(MAX_ROWS + 1).lean(),
    Subscription.find({ status: "active" }).select("owner plan snapshot.name snapshot.role source startsAt expiresAt").sort({ startsAt: -1, _id: -1 }).limit(MAX_ROWS + 1).lean(),
    SubscriptionPayment.find({ status: "paid" }).select("amount paidAt plan snapshot.name").sort({ paidAt: -1 }).limit(MAX_ROWS + 1).lean(),
    SubscriptionPayment.find({ status: "refunded" }).select("amount").limit(MAX_ROWS + 1).lean(),
  ]);
  const totalOwners = ownerIds.length;
  const isOwner = new Set(ownerIds.map(o => String(o._id)));
  const graceMs = Math.max(0, Number(settings.graceDays) || 0) * DAY;

  // Each owner's current plan = their newest "active" record (the list is newest first).
  const current = new Map();
  // Plan records of an owner account that has since been deleted are left out.
  for (const s of activeSubs) { const k = String(s.owner); if (isOwner.has(k) && !current.has(k)) current.set(k, s); }

  const counts = { paying: 0, trial: 0, grace: 0 };
  // One row per plan (by its id, so two plans with the same name stay separate
  // and a renamed plan stays one row, shown under the name seen first here:
  // current subscribers first, then the newest payment).
  const byPlan = new Map();
  const plan = (id, name) => { const k = String(id || name); if (!byPlan.has(k)) byPlan.set(k, { name, subscribers: 0, payments: 0, income: 0 }); return byPlan.get(k); };
  const soon = [], inGrace = [];

  for (const s of current.values()) {
    const exp = s.expiresAt ? new Date(s.expiresAt) : null;
    const name = (s.snapshot && s.snapshot.name) || "Plan";
    const isTrial = s.source === "trial" || (s.snapshot && s.snapshot.role === "trial");
    if (!exp || now <= exp) {
      if (isTrial) counts.trial++; else { counts.paying++; plan(s.plan, name).subscribers++; }
      if (exp && exp - now <= SOON_DAYS * DAY) soon.push({ owner: s.owner, name, isTrial, expiresAt: exp, daysLeft: Math.max(0, Math.ceil((exp - now) / DAY)) });
    } else if (now - exp <= graceMs) {
      counts.grace++;
      inGrace.push({ owner: s.owner, name, isTrial, expiresAt: exp, graceEndsAt: new Date(exp.getTime() + graceMs) });
    }
    // otherwise: expired and past grace → on the Default plan
  }
  counts.free = Math.max(0, totalOwners - counts.paying - counts.trial - counts.grace);

  // Income
  const thisKey = monthKey(now);
  const lastKey = monthKey(new Date(Date.UTC(Number(thisKey.slice(0, 4)), Number(thisKey.slice(5)) - 2, 15)));
  const months = new Map();
  for (let i = 5; i >= 0; i--) {
    const k = monthKey(new Date(Date.UTC(Number(thisKey.slice(0, 4)), Number(thisKey.slice(5)) - 1 - i, 15)));
    months.set(k, { key: k, label: monthLabel(k), payments: 0, income: 0 });
  }
  const income = { all: 0, count: paid.length, thisMonth: 0, lastMonth: 0, refunded: refunded.reduce((a, r) => a + (Number(r.amount) || 0), 0), refundedCount: refunded.length };
  for (const p of paid) {
    const amt = Number(p.amount) || 0;
    income.all += amt;
    const k = p.paidAt ? monthKey(p.paidAt) : "";
    if (k === thisKey) income.thisMonth += amt;
    if (k === lastKey) income.lastMonth += amt;
    if (months.has(k)) { const m = months.get(k); m.payments++; m.income += amt; }
    const row = plan(p.plan, (p.snapshot && p.snapshot.name) || "Plan"); row.payments++; row.income += amt;
  }

  // Names for the two short lists
  soon.sort((a, b) => a.expiresAt - b.expiresAt);
  inGrace.sort((a, b) => a.graceEndsAt - b.graceEndsAt);
  const listed = soon.slice(0, 50).concat(inGrace.slice(0, 50));
  const owners = listed.length
    ? await Owner.find({ _id: { $in: listed.map(x => x.owner) } }).select("name email phone").lean()
    : [];
  const ownerById = new Map(owners.map(o => [String(o._id), o]));
  listed.forEach(x => { x.who = ownerById.get(String(x.owner)) || null; });

  return {
    totalOwners, counts, income,
    months: [...months.values()],
    plans: [...byPlan.values()].sort((a, b) => b.income - a.income || b.subscribers - a.subscribers || a.name.localeCompare(b.name)),
    soon: soon.slice(0, 50), soonTotal: soon.length,
    inGrace: inGrace.slice(0, 50), graceTotal: inGrace.length,
    graceDays: Math.round(graceMs / DAY), soonDays: SOON_DAYS,
    capped: [ownerIds, activeSubs, paid, refunded].some(list => list.length > MAX_ROWS),
    monthLabels: { thisMonth: monthLabel(thisKey), lastMonth: monthLabel(lastKey) },
  };
}

router.get("/subscriptions", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select("-password");
    if (!admin) { res.clearCookie("adminToken"); return res.redirect("/admin/login"); }
    res.render("admin/subscriptions.ejs", { admin, o: await buildOverview() });
  } catch (err) {
    console.error("Admin subscriptions overview error:", err.message);
    res.status(500).send("Server Error");
  }
});

// One cell of a CSV file. Text that a spreadsheet could read as a formula
// (starts with = + - @) is prefixed with ' so it stays plain text.
function cell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const istStamp = d => (d ? new Date(new Date(d).getTime() + IST).toISOString().slice(0, 16).replace("T", " ") : "");

router.get("/subscriptions/payments.csv", jwtAdminAuth, async (req, res) => {
  try {
    // Same check as every admin page: the admin account must still exist.
    if (!(await Admin.exists({ _id: req.admin.id }))) { res.clearCookie("adminToken"); return res.redirect("/admin/login"); }
    const rows = await SubscriptionPayment.find()
      .select("paidAt createdAt receipt owner snapshot.name snapshot.duration amount status method via razorpayOrderId razorpayPaymentId")
      .sort({ createdAt: -1 }).limit(MAX_ROWS + 1).populate("owner", "name email phone").lean();
    const truncated = rows.length > MAX_ROWS;
    if (truncated) rows.length = MAX_ROWS;
    const head = ["Date (IST)", "Receipt no.", "Owner", "Email", "Phone", "Plan", "Duration", "Amount (INR)", "Status", "Method", "Confirmed by", "Razorpay order ID", "Razorpay payment ID"];
    const lines = [head.map(cell).join(",")];
    for (const r of rows) {
      const snap = r.snapshot || {}, d = snap.duration || {};
      lines.push([
        istStamp(r.paidAt || r.createdAt), r.receipt,
        r.owner && r.owner.name, r.owner && r.owner.email, r.owner && r.owner.phone,
        snap.name, d.value ? `${d.value} ${d.unit}${d.value === 1 ? "" : "s"}` : "",
        r.amount, r.status, r.method, r.via, r.razorpayOrderId, r.razorpayPaymentId,
      ].map(cell).join(","));
    }
    if (truncated) lines.push(cell(`Only the newest ${MAX_ROWS} payments are in this file.`));
    const stamp = new Date(Date.now() + IST).toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="hostelnode-plan-payments-${stamp}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(String.fromCharCode(0xFEFF) + lines.join("\r\n") + "\r\n");   // byte-order mark first, so Excel reads the rupee sign and names correctly
  } catch (err) {
    console.error("Admin payments CSV error:", err.message);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
module.exports.buildOverview = buildOverview;
