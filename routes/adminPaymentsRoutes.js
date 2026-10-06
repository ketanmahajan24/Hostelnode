/* ============================================================
   routes/adminPaymentsRoutes.js  —  Subscriptions Phase 3
   Mounted at /admin in app.js (before the main admin router).

     GET  /admin/payments                  every online plan payment
     POST /admin/payments/:id/mark-paid    rescue: activate a plan for a payment
                                           you can see in Razorpay but that did
                                           not activate here

   Admin-only. Payments themselves are taken in the owner dashboard;
   this page only shows them. Refunds are made in the Razorpay
   dashboard, never from here.
============================================================ */

const express  = require("express");
const mongoose = require("mongoose");
const router   = express.Router();

const Admin               = require("../models/admin");
const SubscriptionPayment = require("../models/subscriptionPayment");
require("../models/owner");
const { jwtAdminAuth } = require("../Middlewares/jwtAuth");
const { fulfilPayment } = require("../utils/subscriptionPayments");

router.use("/payments", (req, res, next) => (process.env.HN_BILLING === "0" ? next("router") : next()));

const STATUSES = ["paid", "created", "failed", "refunded"];
const PAGE = 30;
const validId = id => typeof id === "string" && mongoose.isValidObjectId(id);

const NOTICES = {
  marked:   ["ok",  "Marked as paid. The owner's plan is active now."],
  already:  ["ok",  "That payment had already activated its plan. Nothing changed."],
  badid:    ["err", "Enter the Razorpay payment ID exactly as shown in Razorpay (it starts with pay_)."],
  used:     ["err", "That Razorpay payment ID is already recorded against another payment."],
  refunded: ["err", "That payment was refunded, so it cannot activate a plan."],
  notfound: ["err", "That payment record no longer exists."],
  busy:     ["err", "This payment is being activated right now. Reload in a minute; if the plan is still not active, try again."],
  failed:   ["err", "That could not be saved. Please try again."],
};

router.get("/payments", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select("-password");
    if (!admin) { res.clearCookie("adminToken"); return res.redirect("/admin/login"); }

    const status = STATUSES.includes(req.query.status) ? req.query.status : "";
    const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const filter = status ? { status } : {};

    const [rows, total, paidAgg] = await Promise.all([
      SubscriptionPayment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE)
        .populate("owner", "name email phone").lean(),
      SubscriptionPayment.countDocuments(filter),
      // Only the amount of each paid record is read, then added up here
      // (the same way /admin/subscriptions does it, so the two always agree).
      SubscriptionPayment.find({ status: "paid" }).select("amount -_id").limit(50001).lean(),
    ]);

    const key = typeof req.query.ok === "string" ? req.query.ok : "";
    const n = Object.prototype.hasOwnProperty.call(NOTICES, key) ? NOTICES[key] : null;
    res.render("admin/payments.ejs", {
      admin, rows, total, status, page, totalPages: Math.max(1, Math.ceil(total / PAGE)),
      paidCount: paidAgg.length, paidSum: paidAgg.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
      paidCapped: paidAgg.length > 50000,
      notice: n ? n[1] : "", noticeIsError: !!n && n[0] === "err",
    });
  } catch (err) {
    console.error("Admin payments list error:", err.message);
    res.status(500).send("Server Error");
  }
});

router.post("/payments/:id/mark-paid", jwtAdminAuth, async (req, res) => {
  const back = key => res.redirect("/admin/payments?ok=" + key);
  try {
    if (!validId(req.params.id)) return back("notfound");
    const rec = await SubscriptionPayment.findById(req.params.id).select("_id status subscription").lean();
    if (!rec) return back("notfound");
    if (rec.subscription) return back("already");
    if (rec.status === "refunded") return back("refunded");

    const payId = typeof (req.body || {}).razorpayPaymentId === "string" ? req.body.razorpayPaymentId.trim() : "";
    if (!/^pay_[A-Za-z0-9]{6,40}$/.test(payId)) return back("badid");
    if (await SubscriptionPayment.exists({ razorpayPaymentId: payId, _id: { $ne: rec._id } })) return back("used");

    const r = await fulfilPayment({ id: rec._id }, { razorpayPaymentId: payId, via: "admin", adminId: req.admin.id });
    if (r.ok && r.pending) return back("busy");
    back(r.ok ? (r.fresh ? "marked" : "already") : (r.error === "refunded" ? "refunded" : "failed"));
  } catch (err) {
    console.error("Admin mark-paid error:", err.message);
    back(err && err.code === 11000 ? "used" : "failed");
  }
});

module.exports = router;
