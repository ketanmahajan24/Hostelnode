/* ============================================================
   routes/adminPlansRoutes.js  —  Subscriptions Phase 1
   Mounted at /admin in app.js (before the main admin router).

     GET    /admin/plans                 list of plans + settings
     GET    /admin/plans/new             new plan form
     POST   /admin/plans                 create
     GET    /admin/plans/:id/edit        edit form
     POST   /admin/plans/:id             save changes
     POST   /admin/plans/:id/duplicate   copy a plan (copy starts hidden)
     PATCH  /admin/plans/:id/visibility  show / hide for owners
     PATCH  /admin/plans/:id/restore     bring an archived plan back
     DELETE /admin/plans/:id             remove (archives if owners bought it)
     POST   /admin/plans/settings        grace days, start free trials on/off

   Admin-only (same login as the rest of /admin). Touches only the
   new "plans" and "billingsettings" collections. Nothing here is
   visible to owners, tenants or flatmate users.

   Off switch: set HN_BILLING=0 and these pages disappear.
============================================================ */

const express  = require("express");
const mongoose = require("mongoose");
const router   = express.Router();

const Admin           = require("../models/admin");
const Plan            = require("../models/plan");
const BillingSettings = require("../models/billingSettings");
const { jwtAdminAuth } = require("../Middlewares/jwtAuth");
const { LIMITS, FEATURES, DURATION_UNITS, ROLES } = require("../config/planFeatures");

const UNIT_KEYS = DURATION_UNITS.map(u => u.key);
const ROLE_KEYS = ROLES.map(r => r.key);
const MAX_DURATION = { day: 3650, month: 120, year: 10 };
const MAX_POINTS = 10;

// Off switch — leave this router so /admin/plans is simply "not found".
router.use("/plans", (req, res, next) => (process.env.HN_BILLING === "0" ? next("router") : next()));

/* ── helpers ─────────────────────────────────────────────── */

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// "" → null ; "123" → 123 ; anything else → NaN
function wholeNumber(v) {
  if (typeof v !== "string") return v === undefined ? null : NaN;
  const s = v.trim();
  if (s === "") return null;
  return /^\d{1,9}$/.test(s) ? Number(s) : NaN;
}

// "2026-12-31" → the end of that day in India (23:59:59 IST)
function endOfDayIST(v) {
  if (typeof v !== "string" || v.trim() === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return NaN;
  const d = new Date(v.trim() + "T23:59:59.999+05:30");
  if (isNaN(d.getTime())) return NaN;
  // Reject impossible dates such as 31 February (JavaScript would roll them forward).
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) === v.trim() ? d : NaN;
}

// Date → "YYYY-MM-DD" in India, for the date input
function dateInputIST(d) {
  if (!d) return "";
  return new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

const validId = id => typeof id === "string" && mongoose.isValidObjectId(id);

// How many owners have (ever) bought this plan. The "subscriptions"
// collection arrives in Phase 2; until then this is always 0.
async function subscriberCounts(planIds) {
  const out = new Map();
  if (!planIds.length) return out;
  try {
    const rows = await mongoose.connection.db.collection("subscriptions")
      .aggregate([{ $match: { plan: { $in: planIds } } }, { $group: { _id: "$plan", n: { $sum: 1 } } }])
      .toArray();
    rows.forEach(r => out.set(String(r._id), r.n));
  } catch (err) {
    console.error("Plans: subscriber count failed:", err.message);
    planIds.forEach(id => out.set(String(id), -1));   // unknown → treat as "has subscribers"
  }
  return out;
}

// The values shown in the form, as strings (what the admin typed).
function formFromPlan(p) {
  const f = {
    name: p.name || "", description: p.description || "",
    price: String(p.price ?? 0),
    strikePrice: p.strikePrice == null ? "" : String(p.strikePrice),
    durationValue: String(p.duration?.value ?? 1), durationUnit: p.duration?.unit || "month",
    offerEndsAt: dateInputIST(p.offerEndsAt),
    displayPoints: (p.displayPoints || []).join("\n"),
    badge: p.badge || "", isVisible: p.isVisible !== false,
    sortOrder: String(p.sortOrder ?? 0), role: p.role || "normal",
    limits: {}, features: {},
  };
  LIMITS.forEach(l => { const v = p.limits && p.limits[l.key]; f.limits[l.key] = v == null ? "" : String(v); });
  FEATURES.forEach(x => { f.features[x.key] = !!(p.features && p.features[x.key]); });
  return f;
}

function formFromBody(b) {
  const f = {
    name: text(b.name, 200), description: text(b.description, 500),
    price: text(b.price, 20), strikePrice: text(b.strikePrice, 20),
    durationValue: text(b.durationValue, 20), durationUnit: text(b.durationUnit, 10),
    offerEndsAt: text(b.offerEndsAt, 20),
    displayPoints: typeof b.displayPoints === "string" ? b.displayPoints.slice(0, 2000) : "",
    badge: text(b.badge, 60), isVisible: b.isVisible === "on",
    sortOrder: text(b.sortOrder, 20), role: text(b.role, 10),
    limits: {}, features: {},
  };
  LIMITS.forEach(l => { f.limits[l.key] = text(b["limit_" + l.key], 20); });
  FEATURES.forEach(x => { f.features[x.key] = b["feat_" + x.key] === "on"; });
  return f;
}

// Check the form and turn it into the record to save.
function validate(f) {
  const errors = [];
  const data = { limits: {}, features: {} };

  data.name = f.name;
  if (!data.name) errors.push("Plan name is required.");
  else if (data.name.length > 60) errors.push("Plan name can be at most 60 characters.");

  data.description = f.description;
  if (data.description.length > 200) errors.push("Short description can be at most 200 characters.");

  data.role = ROLE_KEYS.includes(f.role) ? f.role : "normal";
  const isFree = data.role !== "normal";

  const price = wholeNumber(f.price);
  if (isFree) data.price = 0;
  else if (price === null || Number.isNaN(price)) errors.push("Price must be a whole number of rupees (0 or more).");
  else if (price > 1000000) errors.push("Price cannot be more than ₹10,00,000.");
  else data.price = price;

  const strike = wholeNumber(f.strikePrice);
  if (isFree || strike === null) data.strikePrice = null;
  else if (Number.isNaN(strike)) errors.push("Strike-through price must be a whole number of rupees, or left empty.");
  else if (strike > 1000000) errors.push("Strike-through price cannot be more than ₹10,00,000.");
  else if (data.price !== undefined && strike <= data.price) errors.push("Strike-through price must be higher than the price.");
  else data.strikePrice = strike;

  const unit = UNIT_KEYS.includes(f.durationUnit) ? f.durationUnit : null;
  const dv = wholeNumber(f.durationValue);
  if (!unit) errors.push("Choose days, months or years for the duration.");
  else if (dv === null || Number.isNaN(dv) || dv < 1) errors.push("Duration must be a whole number, 1 or more.");
  else if (dv > MAX_DURATION[unit]) errors.push(`Duration can be at most ${MAX_DURATION[unit]} ${unit}s.`);
  else data.duration = { value: dv, unit };

  const offer = endOfDayIST(f.offerEndsAt);
  if (isFree || offer === null) data.offerEndsAt = null;
  else if (Number.isNaN(offer)) errors.push("Offer end date is not a valid date.");
  else data.offerEndsAt = offer;

  LIMITS.forEach(l => {
    const n = wholeNumber(f.limits[l.key]);
    if (Number.isNaN(n)) errors.push(`"${l.label}" must be a whole number, or left empty for unlimited.`);
    else data.limits[l.key] = n;
  });
  FEATURES.forEach(x => { data.features[x.key] = !!f.features[x.key]; });

  const points = f.displayPoints.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (points.length > MAX_POINTS) errors.push(`Display points: at most ${MAX_POINTS} lines.`);
  else if (points.some(p => p.length > 80)) errors.push("Each display point can be at most 80 characters.");
  else data.displayPoints = points;

  data.badge = f.badge;
  if (data.badge.length > 24) errors.push("Badge can be at most 24 characters.");

  const order = wholeNumber(f.sortOrder);
  if (Number.isNaN(order)) errors.push("Display order must be a whole number.");
  else data.sortOrder = order === null ? 0 : Math.min(order, 9999);

  // Trial / Default plans are assigned automatically, never bought.
  data.isVisible = isFree ? false : !!f.isVisible;

  return { errors, data };
}

// Only one live Trial plan and one live Default plan may exist.
async function roleConflict(role, exceptId) {
  if (role === "normal") return null;
  const q = { role, archivedAt: null };
  if (exceptId) q._id = { $ne: exceptId };
  return Plan.findOne(q).select("name").lean();
}

// Safety net for two saves landing at the same moment: if more than one
// live plan now holds this role, this plan steps back to a hidden Normal plan.
async function settleRole(planId, role) {
  if (role === "normal") return false;
  const live = await Plan.countDocuments({ role, archivedAt: null });
  if (live <= 1) return false;
  await Plan.updateOne({ _id: planId }, { $set: { role: "normal", isVisible: false } });
  return true;
}

const NOTICES = {
  created:    "Plan created.",
  saved:      "Plan saved.",
  copied:     "Plan copied. The copy is hidden until you make it visible.",
  deleted:    "Plan deleted.",
  archived:   "Owners have bought this plan, so it was archived instead of deleted. They keep it until it expires.",
  restored:   "Plan restored. It is hidden until you make it visible.",
  settings:   "Settings saved.",
  notfound:   "That plan no longer exists.",
  roleclash:  "Saved, but another plan already holds that Trial/Default role, so this one was saved as a hidden Normal plan.",
  badsetting: "Grace days must be a whole number from 0 to 60.",
};

async function loadAdmin(req, res) {
  const admin = await Admin.findById(req.admin.id).select("-password");
  if (!admin) { res.clearCookie("adminToken"); res.redirect("/admin/login"); return null; }
  return admin;
}

function renderForm(res, admin, { plan, form, errors, status, notice }) {
  res.status(status || 200).render("admin/planForm.ejs", {
    admin, plan: plan || null, form, errors: errors || [], notice: notice || "",
    LIMITS, FEATURES, DURATION_UNITS, ROLES,
  });
}

/* ── LIST ────────────────────────────────────────────────── */
router.get("/plans", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await loadAdmin(req, res);
    if (!admin) return;

    const [all, settings] = await Promise.all([
      Plan.find().sort({ sortOrder: 1, createdAt: 1 }).lean(),
      BillingSettings.read(),
    ]);
    const counts = await subscriberCounts(all.map(p => p._id));
    all.forEach(p => { p.subscribers = counts.get(String(p._id)) || 0; });

    const plans    = all.filter(p => !p.archivedAt);
    const archived = all.filter(p => p.archivedAt);
    const key = typeof req.query.ok === "string" ? req.query.ok : "";

    res.render("admin/plans.ejs", {
      admin, plans, archived, settings,
      notice: Object.prototype.hasOwnProperty.call(NOTICES, key) ? NOTICES[key] : "",
      noticeIsError: key === "notfound" || key === "badsetting" || key === "roleclash",
      hasTrial:   plans.some(p => p.role === "trial"),
      hasDefault: plans.some(p => p.role === "default"),
      LIMITS, FEATURES, now: new Date(),
    });
  } catch (err) {
    console.error("Admin plans list error:", err.message);
    res.status(500).send("Server Error");
  }
});

/* ── SETTINGS ────────────────────────────────────────────── */
router.post("/plans/settings", jwtAdminAuth, async (req, res) => {
  try {
    const n = wholeNumber(req.body.graceDays);
    if (n === null || Number.isNaN(n) || n > 60) return res.redirect("/admin/plans?ok=badsetting");
    const save = () => BillingSettings.updateOne(
      { key: "billing" },
      { $set: {
        graceDays: n,
        trialsEnabled: req.body.trialsEnabled === "on",
        enforcementEnabled: req.body.enforcementEnabled === "on",   // Phase 4
        remindersEnabled: req.body.remindersEnabled === "on",       // Phase 4
        updatedBy: req.admin.id,
      } },
      { upsert: true, runValidators: true }
    );
    // Two first-ever saves at the same moment: the second one simply retries.
    try { await save(); } catch (e) { if (e && e.code === 11000) await save(); else throw e; }
    res.redirect("/admin/plans?ok=settings");
  } catch (err) {
    console.error("Admin plan settings error:", err.message);
    res.status(500).send("Server Error");
  }
});

/* ── NEW ─────────────────────────────────────────────────── */
router.get("/plans/new", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await loadAdmin(req, res);
    if (!admin) return;
    const form = formFromPlan({ duration: { value: 1, unit: "month" }, isVisible: false, limits: {}, features: {} });
    renderForm(res, admin, { form });
  } catch (err) {
    console.error("Admin plan new error:", err.message);
    res.status(500).send("Server Error");
  }
});

router.post("/plans", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await loadAdmin(req, res);
    if (!admin) return;
    const form = formFromBody(req.body || {});
    const { errors, data } = validate(form);
    if (!errors.length) {
      const other = await roleConflict(data.role, null);
      if (other) errors.push(`"${other.name}" is already the ${data.role === "trial" ? "Trial" : "Default"} plan. Change that plan to Normal first.`);
    }
    if (errors.length) return renderForm(res, admin, { form, errors, status: 400 });

    const created = await Plan.create({ ...data, createdBy: req.admin.id, updatedBy: req.admin.id });
    const clash = await settleRole(created._id, data.role);
    res.redirect("/admin/plans?ok=" + (clash ? "roleclash" : "created"));
  } catch (err) {
    console.error("Admin plan create error:", err.message);
    res.status(500).send("Server Error");
  }
});

/* ── EDIT ────────────────────────────────────────────────── */
router.get("/plans/:id/edit", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await loadAdmin(req, res);
    if (!admin) return;
    const plan = validId(req.params.id) ? await Plan.findById(req.params.id).lean() : null;
    if (!plan) return res.redirect("/admin/plans?ok=notfound");
    renderForm(res, admin, { plan, form: formFromPlan(plan), notice: req.query.ok === "copied" ? NOTICES.copied : "" });
  } catch (err) {
    console.error("Admin plan edit error:", err.message);
    res.status(500).send("Server Error");
  }
});

router.post("/plans/:id/duplicate", jwtAdminAuth, async (req, res) => {
  try {
    const src = validId(req.params.id) ? await Plan.findById(req.params.id).lean() : null;
    if (!src) return res.redirect("/admin/plans?ok=notfound");
    const copy = await Plan.create({
      name: (src.name.slice(0, 53) + " (copy)"),
      description: src.description, price: src.price, strikePrice: src.strikePrice,
      duration: src.duration, offerEndsAt: src.offerEndsAt,
      limits: src.limits, features: src.features,
      displayPoints: src.displayPoints, badge: src.badge,
      sortOrder: src.sortOrder, role: "normal", isVisible: false,
      createdBy: req.admin.id, updatedBy: req.admin.id,
    });
    res.redirect(`/admin/plans/${copy._id}/edit?ok=copied`);
  } catch (err) {
    console.error("Admin plan duplicate error:", err.message);
    res.status(500).send("Server Error");
  }
});

router.post("/plans/:id", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await loadAdmin(req, res);
    if (!admin) return;
    const plan = validId(req.params.id) ? await Plan.findById(req.params.id).lean() : null;
    if (!plan) return res.redirect("/admin/plans?ok=notfound");

    const form = formFromBody(req.body || {});
    const { errors, data } = validate(form);
    if (!errors.length && !plan.archivedAt) {
      const other = await roleConflict(data.role, plan._id);
      if (other) errors.push(`"${other.name}" is already the ${data.role === "trial" ? "Trial" : "Default"} plan. Change that plan to Normal first.`);
    }
    if (errors.length) return renderForm(res, admin, { plan, form, errors, status: 400 });

    if (plan.archivedAt) data.isVisible = false;   // archived plans stay hidden
    await Plan.updateOne({ _id: plan._id }, { $set: { ...data, updatedBy: req.admin.id } }, { runValidators: true });
    const clash = plan.archivedAt ? false : await settleRole(plan._id, data.role);
    res.redirect("/admin/plans?ok=" + (clash ? "roleclash" : "saved"));
  } catch (err) {
    console.error("Admin plan save error:", err.message);
    res.status(500).send("Server Error");
  }
});

/* ── SHOW / HIDE ─────────────────────────────────────────── */
router.patch("/plans/:id/visibility", jwtAdminAuth, async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, error: "Plan not found" });
    const want = req.body && req.body.isVisible === true;
    const r = await Plan.updateOne(
      { _id: req.params.id, archivedAt: null, role: "normal" },
      { $set: { isVisible: want, updatedBy: req.admin.id } }
    );
    if (!r.matchedCount) return res.status(400).json({ success: false, error: "Only normal, non-archived plans can be shown or hidden" });
    res.json({ success: true });
  } catch (err) {
    console.error("Admin plan visibility error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ── RESTORE (un-archive) ────────────────────────────────── */
router.patch("/plans/:id/restore", jwtAdminAuth, async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, error: "Plan not found" });
    const plan = await Plan.findOne({ _id: req.params.id, archivedAt: { $ne: null } }).lean();
    if (!plan) return res.status(404).json({ success: false, error: "Plan not found" });
    // If another plan took over its Trial/Default role meanwhile, it comes back as Normal.
    const role = (await roleConflict(plan.role, plan._id)) ? "normal" : plan.role;
    await Plan.updateOne({ _id: plan._id }, { $set: { archivedAt: null, isVisible: false, role, updatedBy: req.admin.id } });
    await settleRole(plan._id, role);
    res.json({ success: true });
  } catch (err) {
    console.error("Admin plan restore error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ── REMOVE ──────────────────────────────────────────────── */
router.delete("/plans/:id", jwtAdminAuth, async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, error: "Plan not found" });
    const plan = await Plan.findById(req.params.id).select("_id archivedAt").lean();
    if (!plan) return res.status(404).json({ success: false, error: "Plan not found" });

    const bought = (await subscriberCounts([plan._id])).get(String(plan._id)) || 0;
    if (bought !== 0) {
      // Never delete a plan an owner has bought: archive it instead.
      if (!plan.archivedAt) {
        await Plan.updateOne({ _id: plan._id }, { $set: { archivedAt: new Date(), isVisible: false, updatedBy: req.admin.id } });
      }
      return res.json({ success: true, archived: true });
    }
    await Plan.deleteOne({ _id: plan._id });
    res.json({ success: true, archived: false });
  } catch (err) {
    console.error("Admin plan delete error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
