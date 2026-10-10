/* ============================================================
   routes/kycRoutes.js  —  Property Operations Phase 4 (DigiLocker KYC), hostelnode.com
   Mounted at / in app.js (before the student routes).

     GET  /kyc?p=<property>         the page owners send: "Sai PG asked you to verify"
     POST /student/kyc/start        open DigiLocker for the logged-in student
     GET  /kyc/return?vid=…         back from DigiLocker (works without the login cookie,
                                    which browsers do not send on a link from another site)
     GET  /student/edit-profile     (adds the KYC card's data, then the profile page as before)

   Kept: verified name, date of birth, gender, state and the last 4 Aadhaar digits.
============================================================ */
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { jwtStudentAuth, optionalStudentAuth } = require("../Middlewares/jwtAuth");
const Student = require("../models/studentSchema");
const Hostel = require("../models/hostel");
const KycSession = require("../models/kycSession");
const kyc = require("../utils/kyc");

const mainSite = req => {
  const set = String(process.env.HN_MAIN_SITE_URL || "").trim().replace(/\/$/, "");
  if (/^https?:\/\/[^\s"'<>]+$/.test(set)) return set;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
};
const validId = v => typeof v === "string" && mongoose.isValidObjectId(v) && /^[0-9a-f]{24}$/i.test(v);
const propertyOf = async p => (validId(p) ? (await Hostel.findById(p, { hostelName: 1, owner: 1 }).lean()) : null);
const propertyName = async p => ((await propertyOf(p)) || {}).hostelName || "";

// The KYC card on the student's profile page (data only; the page itself is unchanged).
async function kycCardData(req, res, next) {
  try {
    const st = req.student && req.student.id ? await Student.findById(req.student.id, { phone: 1, firstName: 1 }).lean() : null;
    const s = await kyc.settings();
    if (st) await kyc.catchUp(st.phone);   // an attempt whose return page was never opened
    const record = st ? await kyc.recordFor(st.phone) : null;
    const verified = !!(record && record.status === "verified");
    // Not this student's own verification (done on a PG owner's phone, or by another account that had
    // this number before): the details are not shown here, and the student can verify themselves.
    const byOwnerPhone = verified && String(record.student || "") !== String(st && st._id);
    res.locals.hnKyc = { on: s.canVerify, badge: byOwnerPhone ? kyc.badgeOf(null) : kyc.badgeOf(record), byOwnerPhone, elsewhere: byOwnerPhone && record.via === "owner" ? "owner" : "account", record: verified && !byOwnerPhone ? {
      name: record.name, dob: kyc.dobText(record.dob, record.dobYearOnly), gender: record.gender, last4: record.last4, verifiedAt: kyc.dobText(record.verifiedAt) } : null,
      failed: !!(record && record.status === "failed") };
  } catch (err) {
    console.error("Profile KYC card (non-fatal):", err.message);
  }
  next();
}
router.get("/student/edit-profile", jwtStudentAuth, kycCardData);
router.post("/student/edit-profile", jwtStudentAuth, kycCardData);

// The page owners send.
router.get("/kyc", optionalStudentAuth, async (req, res) => {
  try {
    const p = validId(String(req.query.p || "")) ? String(req.query.p) : "";
    const [s, prop] = await Promise.all([kyc.settings(), propertyOf(p)]);
    const property = prop ? prop.hostelName || "" : "";
    let student = null, record = null;
    if (req.student && req.student.id) {
      student = await Student.findById(req.student.id, { firstName: 1, phone: 1 }).lean();
      if (student) await kyc.catchUp(student.phone);
      record = student ? await kyc.recordFor(student.phone) : null;
    }
    const here = "/kyc" + (p ? "?p=" + p : "");
    res.set("Cache-Control", "no-store");
    const shared = !!(prop && kyc.sharedWith(record, prop.owner));
    // Not this student's own verification (see the profile card above): offer to verify.
    const byOwnerPhone = !!(student && record && record.status === "verified" && String(record.student || "") !== String(student._id));
    res.render("kyc/landing.ejs", { s, property, p, student, record, badge: kyc.badgeOf(byOwnerPhone ? null : record), here, shared: shared && !byOwnerPhone, byOwnerPhone, sharedNow: req.query.shared === "1",
      loginHref: "/student/login?next=" + encodeURIComponent(here), err: String(req.query.err || "") === "1" });
  } catch (err) {
    console.error("KYC page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

router.post("/student/kyc/start", jwtStudentAuth, async (req, res) => {
  const p = validId(String(req.body.p || "")) ? String(req.body.p) : "";
  const back = "/kyc" + (p ? "?p=" + p + "&" : "?") + "err=1";
  try {
    const s = await kyc.settings();
    if (!s.canVerify) return res.redirect(back);
    const st = await Student.findById(req.student.id, { phone: 1 }).lean();
    if (!st) return res.redirect("/student/login");
    const rec = await kyc.recordFor(st.phone);
    // Already verified by this student: nothing to redo. (One made on an owner's phone, or by another
    // account that had this number before, may be replaced.)
    if (rec && rec.status === "verified" && String(rec.student || "") === String(st._id)) return res.redirect("/kyc" + (p ? "?p=" + p : ""));
    const prop = await propertyOf(p);   // verifying from a PG's link shares the result with that PG (the page says so)
    const { url } = await kyc.start({ phone: st.phone, via: "student", studentId: st._id, hostelId: prop ? prop._id : null, shareOwnerId: prop ? prop.owner : null, returnUrl: `${mainSite(req)}/kyc/return` });
    res.redirect(url);
  } catch (err) {
    console.error("KYC start (student) error:", err.message);
    res.redirect(back);
  }
});

// "Share with <PG>": the student agrees to show their verified details to that PG's owner.
router.post("/student/kyc/share", jwtStudentAuth, async (req, res) => {
  const p = validId(String(req.body.p || "")) ? String(req.body.p) : "";
  try {
    const [st, prop] = await Promise.all([Student.findById(req.student.id, { phone: 1 }).lean(), propertyOf(p)]);
    if (!st || !prop) return res.redirect("/kyc" + (p ? "?p=" + p : ""));
    // Only their own verification can be shared (not one done on an owner's phone or by another account).
    const rec = await kyc.recordFor(st.phone);
    if (!rec || String(rec.student || "") !== String(st._id)) return res.redirect("/kyc?p=" + p);
    await kyc.share(st.phone, prop.owner, prop._id);
    res.redirect(`/kyc?p=${p}&shared=1`);
  } catch (err) {
    console.error("KYC share error:", err.message);
    res.redirect("/kyc" + (p ? "?p=" + p + "&" : "?") + "err=1");
  }
});

// Back from DigiLocker: finish the check, then show the result (no personal details on this page).
router.get("/kyc/return", async (req, res) => {
  try {
    const vid = String(req.query.vid || req.query.verification_id || "");
    const session = /^[A-Za-z0-9._-]{1,50}$/.test(vid) ? await KycSession.findById(vid).lean() : null;
    // Property Operations Phase 8: verifying while booking a bed goes back to that booking.
    const book = validId(String(req.query.book || "")) ? String(req.query.book) : "";
    if (!session || session.via !== "student") return res.status(404).render("kyc/return.ejs", { out: { state: "failed", reason: "unknown" }, vid: "", tries: 99, next: "/kyc", book: "" });
    const out = await kyc.finish(vid);
    const tries = Math.min(20, Math.max(0, parseInt(req.query.t, 10) || 0));
    res.set("Cache-Control", "no-store");
    res.render("kyc/return.ejs", { out, vid, tries, book, next: book ? "/student/book/" + book : session.hostel ? "/kyc?p=" + session.hostel : "/student/edit-profile" });
  } catch (err) {
    console.error("KYC return (student) error:", err.message);
    res.status(500).send("Something went wrong. Open your profile to check your KYC.");
  }
});

module.exports = router;
