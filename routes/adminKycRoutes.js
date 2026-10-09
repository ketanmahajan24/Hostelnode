/* ============================================================
   routes/adminKycRoutes.js  —  Property Operations Phase 4 (DigiLocker KYC), admin
   Mounted at /admin in app.js (before the main admin router).
     GET  /admin/kyc            Cashfree connection, the two switches, counts
     POST /admin/kyc/settings   save the switches
============================================================ */
const express = require("express");
const router = express.Router();
const Admin = require("../models/admin");
const KycRecord = require("../models/kycRecord");
const KycSettings = require("../models/kycSettings");
const { jwtAdminAuth } = require("../Middlewares/jwtAuth");
const kyc = require("../utils/kyc");
const cf = require("../utils/cashfreeKyc");

router.get("/kyc", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select("-password");
    if (!admin) { res.clearCookie("adminToken"); return res.redirect("/admin/login"); }
    kyc.forgetSettings();
    const monthStart = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const [s, verified, thisMonth, unfinished, viaOwner] = await Promise.all([
      kyc.settings(),
      KycRecord.countDocuments({ status: "verified" }),
      KycRecord.countDocuments({ status: "verified", verifiedAt: { $gte: new Date(monthStart.getTime() - 5.5 * 3600e3) } }),
      KycRecord.countDocuments({ status: { $in: ["pending", "failed"] }, updatedAt: { $gte: weekAgo } }),
      KycRecord.countDocuments({ status: "verified", via: "owner" }),
    ]);
    const saved = req.query.saved === "1";
    res.render("admin/kyc.ejs", { admin, s, mode: cf.mode(), signed: !!(process.env.CASHFREE_KYC_PUBLIC_KEY || process.env.CASHFREE_KYC_PUBLIC_KEY_PATH),
      counts: { verified, thisMonth, unfinished, viaOwner }, saved });
  } catch (err) {
    console.error("Admin KYC page error:", err.message);
    res.status(500).send("Something went wrong. Please try again.");
  }
});

router.post("/kyc/settings", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select("name email");
    if (!admin) return res.redirect("/admin/login");
    const set = { studentsCanVerify: req.body.studentsCanVerify === "1", requiredForAdmission: req.body.requiredForAdmission === "1", updatedBy: admin.email || admin.name || "" };
    await KycSettings.updateOne({ key: "main" }, { $set: set }, { upsert: true });
    kyc.forgetSettings();
    res.redirect("/admin/kyc?saved=1");
  } catch (err) {
    console.error("Admin KYC settings error:", err.message);
    res.status(500).send("The settings could not be saved. Please try again.");
  }
});

module.exports = router;
