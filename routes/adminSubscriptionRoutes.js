/* ============================================================
   routes/adminSubscriptionRoutes.js  —  Subscriptions Phase 2
   Mounted at /admin in app.js (before the main admin router).

     GET  /admin/owners/:id                        owner page: details + plan
     POST /admin/owners/:id/subscription/grant     give a plan now
     POST /admin/owners/:id/subscription/extend    add days to the current plan
     POST /admin/owners/:id/subscription/cancel    end the current plan now

   Admin-only. Writes only to the new "subscriptions" collection;
   the owner record itself is never changed here.

   Off switch: with HN_BILLING=0 these routes step aside and the
   original /admin/owners/:id route answers (without plan controls).
============================================================ */

const express  = require("express");
const mongoose = require("mongoose");
const router   = express.Router();

const Admin        = require("../models/admin");
const Owner        = require("../models/owner");
const Hostel       = require("../models/hostel");
const Listing      = require("../models/listingProperty");
const Plan         = require("../models/plan");
const Subscription = require("../models/subscription");
const { jwtAdminAuth } = require("../Middlewares/jwtAuth");
const { LIMITS } = require("../config/planFeatures");
const { resolveOwnerPlan, ownerUsage, grantPlan, extendPlan, cancelPlan } = require("../utils/subscription");

router.use("/owners", (req, res, next) => (process.env.HN_BILLING === "0" ? next("router") : next()));

const validId = id => typeof id === "string" && mongoose.isValidObjectId(id);

// "" → null ; "30" → 30 ; anything else → NaN
function days(v) {
  if (typeof v !== "string" || v.trim() === "") return null;
  return /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
}

const NOTICES = {
  granted:   ["ok",  "Plan given. It is active for this owner now."],
  extended:  ["ok",  "Plan extended."],
  cancelled: ["ok",  "Plan cancelled. The owner is now on the Default plan."],
  badplan:   ["err", "Choose a plan to give."],
  baddays:   ["err", "Days must be a whole number from 1 to 3650."],
  noplan:    ["err", "This owner has no current plan."],
  noexpiry:  ["err", "This owner's plan never expires, so there is nothing to extend."],
  failed:    ["err", "That could not be saved. Please try again."],
};

router.get("/owners/:id", jwtAdminAuth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(404).send("Owner not found");
    const owner = await Owner.findById(req.params.id).select("-password -otp -otpExpires -resetPasswordToken -resetPasswordExpires").lean();
    if (!owner) return res.status(404).send("Owner not found");
    const admin = await Admin.findById(req.admin.id).select("-password");
    if (!admin) { res.clearCookie("adminToken"); return res.redirect("/admin/login"); }

    const [hostels, listings, current, usage, history, plans] = await Promise.all([
      Hostel.find({ owner: owner._id }).lean(),
      Listing.find({ owner: owner._id }).sort({ createdAt: -1 }).lean(),
      resolveOwnerPlan(owner._id),
      ownerUsage(owner._id),
      Subscription.find({ owner: owner._id }).sort({ startsAt: -1, _id: -1 }).limit(50).lean(),
      Plan.find({ archivedAt: null, role: { $ne: "default" } }).sort({ sortOrder: 1, createdAt: 1 }).select("name price duration role isVisible").lean(),
    ]);

    const key = typeof req.query.ok === "string" ? req.query.ok : "";
    const n = Object.prototype.hasOwnProperty.call(NOTICES, key) ? NOTICES[key] : null;
    res.render("admin/ownerDetail.ejs", {
      admin, owner, hostels, listings,
      sub: { current, usage, history, plans, LIMITS },
      notice: n ? n[1] : "", noticeIsError: !!n && n[0] === "err",
    });
  } catch (err) {
    console.error("Admin owner detail error:", err.message);
    res.status(500).send("Server Error");
  }
});

// Shared start for the three actions: a real owner, or stop.
async function ownerOr404(req, res) {
  if (!validId(req.params.id)) { res.status(404).send("Owner not found"); return null; }
  const owner = await Owner.findById(req.params.id).select("_id").lean();
  if (!owner) { res.status(404).send("Owner not found"); return null; }
  return owner;
}
const back = (res, id, key) => res.redirect(`/admin/owners/${id}?ok=${key}`);

router.post("/owners/:id/subscription/grant", jwtAdminAuth, async (req, res) => {
  try {
    const owner = await ownerOr404(req, res); if (!owner) return;
    const b = req.body || {};
    if (!validId(b.planId)) return back(res, owner._id, "badplan");
    const d = days(b.days);
    if (Number.isNaN(d) || d === 0 || d > 3650) return back(res, owner._id, "baddays");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
    const r = await grantPlan({ ownerId: owner._id, planId: b.planId, adminId: req.admin.id, days: d, note });
    back(res, owner._id, r.ok ? "granted" : "badplan");
  } catch (err) {
    console.error("Admin grant plan error:", err.message);
    res.redirect(`/admin/owners/${encodeURIComponent(String(req.params.id))}?ok=failed`);
  }
});

router.post("/owners/:id/subscription/extend", jwtAdminAuth, async (req, res) => {
  try {
    const owner = await ownerOr404(req, res); if (!owner) return;
    const d = days((req.body || {}).days);
    if (d === null || Number.isNaN(d) || d === 0 || d > 3650) return back(res, owner._id, "baddays");
    const r = await extendPlan({ ownerId: owner._id, days: d, adminId: req.admin.id });
    back(res, owner._id, r.ok ? "extended" : (/never expires/.test(r.error) ? "noexpiry" : "noplan"));
  } catch (err) {
    console.error("Admin extend plan error:", err.message);
    res.redirect(`/admin/owners/${encodeURIComponent(String(req.params.id))}?ok=failed`);
  }
});

router.post("/owners/:id/subscription/cancel", jwtAdminAuth, async (req, res) => {
  try {
    const owner = await ownerOr404(req, res); if (!owner) return;
    const r = await cancelPlan({ ownerId: owner._id, adminId: req.admin.id });
    back(res, owner._id, r.ok ? "cancelled" : "noplan");
  } catch (err) {
    console.error("Admin cancel plan error:", err.message);
    res.redirect(`/admin/owners/${encodeURIComponent(String(req.params.id))}?ok=failed`);
  }
});

module.exports = router;
