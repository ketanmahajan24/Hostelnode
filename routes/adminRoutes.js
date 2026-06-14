/* ============================================================
   ADMIN ROUTES — HostelNode Super Admin Panel
   Mount: app.use('/admin', adminRouter)
============================================================ */

const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcryptjs");
const Admin    = require("../models/admin");
const Owner    = require("../models/owner");
const Student  = require("../models/studentSchema");
const Listing  = require("../models/listingProperty");
const Hostel   = require("../models/hostel");
const Member   = require("../models/member");
const Room     = require("../models/room");
const Enquiry  = require("../models/enquiry");
const Payment  = require("../models/payment");
const SearchLog = require("../models/searchLog");

const { sendMail } = require("../utils/sendMail");
const { jwtAdminAuth, generateAdminToken } = require("../Middlewares/jwtAuth");
const { sendWhatsAppOTP } = require("../models/Whatsapp");
 
const otpStore = new Map();   // phone OTPs
const emailOtpStore = new Map(); // email OTPs

// Add with other requires at top of adminRoutes.js
const visitorRouter = require("./visitorRoutes");

// Add before module.exports = router
router.use("/visitors", visitorRouter);

/* ── helpers ── */
const sendOtp = async (phone, otp) => sendWhatsAppOTP(phone, otp);

// Simple email OTP sender (reuse your sendMail)
const sendEmailOtp = async (email, otp) => {
  await sendMail(email, "🔐 HostelNode Admin — Email Verification OTP",
    `<div style="font-family:Arial;padding:24px">
      <h2 style="color:#09B850">Admin Email Verification</h2>
      <p>Your OTP is:</p>
      <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0f1117;
        background:#e8f9ef;padding:16px 24px;border-radius:12px;display:inline-block;margin:12px 0">
        ${otp}
      </div>
      <p style="color:#888;margin-top:12px">Expires in 5 minutes. Do not share.</p>
    </div>`
  );
};

/* ============================================================
   AUTH ROUTES
============================================================ */

/* GET /admin/login */
router.get("/login", (req, res) => {
    //console.log("Admin Login page loaded");
  res.render("admin/login.ejs", { error: null });
});

/* GET /admin/signup */
// router.get("/signup", async (req, res) => {
//   // Only allow signup if no admin exists
//   const count = await Admin.countDocuments();
//   if (count > 0) return res.redirect("/admin/login");
//   res.render("admin/signup.ejs", { error: null });
// });

/* POST /admin/send-phone-otp */
router.post("/send-phone-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!/^[6-9]\d{9}$/.test(phone))
      return res.json({ success: false, error: "Invalid phone number" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
    otpStore.set(phone, { otp, verified: false, expiresAt: Date.now() + 5 * 60 * 1000 });
    await sendOtp(phone, otp);
    //console.log(`🔐 Admin phone OTP [${phone}]: ${otp}`);
    res.json({ success: true });
  } catch (err) {
    //console.error(err);
    res.json({ success: false, error: "Failed to send OTP" });
  }
});

/* POST /admin/verify-phone-otp */
router.post("/verify-phone-otp", (req, res) => {
  const { phone, otp } = req.body;
  const stored = otpStore.get(phone);
  if (!stored) return res.json({ success: false, error: "OTP not sent" });
  if (Date.now() > stored.expiresAt) { otpStore.delete(phone); return res.json({ success: false, error: "OTP expired" }); }
  if (stored.otp !== otp) return res.json({ success: false, error: "Incorrect OTP" });
  otpStore.set(phone, { ...stored, verified: true });
  res.json({ success: true });
});

/* POST /admin/send-email-otp */
router.post("/send-email-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.json({ success: false, error: "Invalid email" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    emailOtpStore.set(email, { otp, verified: false, expiresAt: Date.now() + 5 * 60 * 1000 });
    await sendEmailOtp(email, otp);
    //console.log(`📧 Admin email OTP [${email}]: ${otp}`);
    res.json({ success: true });
  } catch (err) {
    //console.error(err);
    res.json({ success: false, error: "Failed to send email OTP" });
  }
});

/* POST /admin/verify-email-otp */
router.post("/verify-email-otp", (req, res) => {
  const { email, otp } = req.body;
  const stored = emailOtpStore.get(email);
  if (!stored) return res.json({ success: false, error: "OTP not sent" });
  if (Date.now() > stored.expiresAt) { emailOtpStore.delete(email); return res.json({ success: false, error: "OTP expired" }); }
  if (stored.otp !== otp) return res.json({ success: false, error: "Incorrect OTP" });
  emailOtpStore.set(email, { ...stored, verified: true });
  res.json({ success: true });
});

/* POST /admin/signup */
router.post("/signup", async (req, res) => {
  try {
    const count = await Admin.countDocuments();
    if (count > 0) return res.status(403).json({ success: false, error: "Admin already exists" });

    const { name, email, phone, password, address } = req.body;

    // Verify phone OTP
    const phoneOtp = otpStore.get(phone);
    if (!phoneOtp?.verified) return res.status(400).json({ success: false, error: "Phone not verified" });

    // Verify email OTP
    const emailOtp = emailOtpStore.get(email);
    if (!emailOtp?.verified) return res.status(400).json({ success: false, error: "Email not verified" });

    if (password.length < 8) return res.status(400).json({ success: false, error: "Password must be 8+ characters" });

    const admin = new Admin({ name: name.trim(), email, phone, password, address: address?.trim() });
    await admin.save();

    otpStore.delete(phone);
    emailOtpStore.delete(email);

    res.json({ success: true, redirect: "/admin/login" });
  } catch (err) {
    //console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* POST /admin/login — Step 3: password after OTPs */
router.post("/login", async (req, res) => {
  try {
    const { phone, email, password } = req.body;

    // Verify phone OTP
    const phoneOtp = otpStore.get(phone);
    if (!phoneOtp?.verified) return res.json({ success: false, error: "Phone OTP not verified" });

    // Verify email OTP
    const emailOtp = emailOtpStore.get(email);
    if (!emailOtp?.verified) return res.json({ success: false, error: "Email OTP not verified" });

    const admin = await Admin.findOne({ email, phone, isActive: true });
    if (!admin) return res.json({ success: false, error: "Admin not found" });

    const match = await admin.comparePassword(password);
    if (!match) return res.json({ success: false, error: "Incorrect password" });

    // Update last login
    admin.lastLogin = new Date();
    admin.loginHistory.push({ ip: req.ip, userAgent: req.headers["user-agent"] });
    if (admin.loginHistory.length > 10) admin.loginHistory = admin.loginHistory.slice(-10);
    await admin.save();

    otpStore.delete(phone);
    emailOtpStore.delete(email);

    const token = generateAdminToken({ id: admin._id, email: admin.email, role: "SuperAdmin" });
    res.cookie("adminToken", token, {
      httpOnly: true, secure: false, sameSite: "strict",
      maxAge: 12 * 60 * 60 * 1000
    });

    res.json({ success: true, redirect: "/admin" });
  } catch (err) {
    //console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* GET /admin/logout */
router.get("/logout", (req, res) => {
  res.clearCookie("adminToken");
  res.redirect("/admin/login");
});

/* ============================================================
   DASHBOARD
============================================================ */
router.get("/", jwtAdminAuth, async (req, res) => {
  try {
    const [
      totalOwners, pendingOwners, activeOwners,
      totalStudents, activeStudents, bannedStudents,
      totalListings, pendingListings, approvedListings, rejectedListings,
      totalHostels, totalEnquiries, totalMembers,
      recentOwners, recentStudents, recentListings, recentEnquiries,
       
    ] = await Promise.all([
      Owner.countDocuments(),
      Owner.countDocuments({ status: "Pending" }),
      Owner.countDocuments({ status: "Active" }),
      Student.countDocuments(),
      Student.countDocuments({ status: "Active" }),
      Student.countDocuments({ status: "Banned" }),
      Listing.countDocuments(),
      Listing.countDocuments({ status: "Pending" }),
      Listing.countDocuments({ status: "Approved" }),
      Listing.countDocuments({ status: "Rejected" }),
      Hostel.countDocuments(),
      Enquiry.countDocuments(),
      Member.countDocuments(),
      Owner.find().sort({ createdAt: -1 }).limit(5).select("name email phone status createdAt businessName"),
      Student.find().sort({ createdAt: -1 }).limit(5).select("firstName lastName phone email status createdAt city"),
      Listing.find().sort({ createdAt: -1 }).limit(5).populate("owner", "name").select("title status location startingPrice propertyType createdAt"),
      Enquiry.find().sort({ createdAt: -1 }).limit(5).populate("student", "firstName lastName").populate("listing", "title"),
    
  
    ]);

    // Chart data — signups per month (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const ownerSignups = await Owner.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const studentSignups = await Student.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Top cities for listings
    const topCities = await Listing.aggregate([
      { $group: { _id: "$location.city", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ]);

    // Listing status breakdown
    const listingsByType = await Listing.aggregate([
      { $group: { _id: "$propertyType", count: { $sum: 1 } } }
    ]);

    // Total views across all listings
    const viewsResult = await Listing.aggregate([{ $group: { _id: null, total: { $sum: "$views" } } }]);
    const totalViews = viewsResult[0]?.total || 0;

    const admin = await Admin.findById(req.admin.id).select("-password");

    res.render("admin/dashboard.ejs", {
      admin,
      stats: {
        totalOwners, pendingOwners, activeOwners,
        totalStudents, activeStudents, bannedStudents,
        totalListings, pendingListings, approvedListings, rejectedListings,
        totalHostels, totalEnquiries, totalMembers, totalViews,   // 👈 ADD THIS
      },
      recentOwners, recentStudents, recentListings, recentEnquiries,
      chartData: {
        ownerSignups: JSON.stringify(ownerSignups),
        studentSignups: JSON.stringify(studentSignups),
        topCities: JSON.stringify(topCities),
        listingsByType: JSON.stringify(listingsByType),
        
      }
    });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

/* ============================================================
   OWNERS
============================================================ */
router.get("/owners", jwtAdminAuth, async (req, res) => {
  try {
    const { status, search, page = 1 } = req.query;
    const limit = 20;
    const skip  = (page - 1) * limit;

    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (search) filter.$or = [
      { name:  { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { businessName: { $regex: search, $options: "i" } }
    ];

    const [owners, total] = await Promise.all([
      Owner.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Owner.countDocuments(filter)
    ]);

    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/owners.ejs", {
      admin, owners, total,
      currentPage: +page, totalPages: Math.ceil(total / limit),
      filters: { status, search }
    });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

router.get("/owners/:id", jwtAdminAuth, async (req, res) => {
  try {
    const owner    = await Owner.findById(req.params.id);
    if (!owner) return res.status(404).send("Owner not found");
    const [hostels, listings] = await Promise.all([
      Hostel.find({ owner: owner._id }),
      Listing.find({ owner: owner._id }).sort({ createdAt: -1 })
    ]);
    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/ownerDetail.ejs", { admin, owner, hostels, listings });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

/* PATCH /admin/owners/:id/status */
router.patch("/owners/:id/status", jwtAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["Active", "Inactive", "Pending", "Banned"];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: "Invalid status" });
    await Owner.findByIdAndUpdate(req.params.id, { status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* DELETE /admin/owners/:id */
router.delete("/owners/:id", jwtAdminAuth, async (req, res) => {
  try {
    await Owner.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ============================================================
   STUDENTS
============================================================ */
router.get("/students", jwtAdminAuth, async (req, res) => {
  try {
    const { status, search, page = 1 } = req.query;
    const limit = 20, skip = (page - 1) * limit;

    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (search) filter.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName:  { $regex: search, $options: "i" } },
      { phone:     { $regex: search, $options: "i" } },
      { email:     { $regex: search, $options: "i" } },
      { city:      { $regex: search, $options: "i" } }
    ];

    const [students, total] = await Promise.all([
      Student.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Student.countDocuments(filter)
    ]);

    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/students.ejs", {
      admin, students, total,
      currentPage: +page, totalPages: Math.ceil(total / limit),
      filters: { status, search }
    });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

router.get("/students/:id", jwtAdminAuth, async (req, res) => {
  try {
    const student  = await Student.findById(req.params.id).populate("wishlist", "title location startingPrice status");
    if (!student) return res.status(404).send("Student not found");
    const enquiries = await Enquiry.find({ student: student._id }).populate("listing", "title location");
    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/studentDetail.ejs", { admin, student, enquiries });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

/* PATCH /admin/students/:id/status */
router.patch("/students/:id/status", jwtAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Active", "Inactive", "Banned"].includes(status))
      return res.status(400).json({ success: false, error: "Invalid status" });
    await Student.findByIdAndUpdate(req.params.id, { status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* DELETE /admin/students/:id */
router.delete("/students/:id", jwtAdminAuth, async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ============================================================
   LISTINGS
============================================================ */
router.get("/listings", jwtAdminAuth, async (req, res) => {
  try {
    const { status, search, type, page = 1 } = req.query;
    const limit = 20, skip = (page - 1) * limit;

    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (type   && type   !== "all") filter.propertyType = type;
    if (search) filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { "location.city":  { $regex: search, $options: "i" } },
      { "location.state": { $regex: search, $options: "i" } }
    ];

    const [listings, total] = await Promise.all([
      Listing.find(filter).populate("owner", "name email phone").sort({ createdAt: -1 }).skip(skip).limit(limit),
      Listing.countDocuments(filter)
    ]);

    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/listings.ejs", {
      admin, listings, total,
      currentPage: +page, totalPages: Math.ceil(total / limit),
      filters: { status, search, type }
    });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

router.get("/listings/:id", jwtAdminAuth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate("owner", "name email phone businessName city")
      .populate("reviews.student", "firstName lastName");
    if (!listing) return res.status(404).send("Listing not found");
    const enquiries = await Enquiry.find({ listing: listing._id })
      .populate("student", "firstName lastName phone").sort({ createdAt: -1 });
    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/listingDetail.ejs", { admin, listing, enquiries });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

/* PATCH /admin/listings/:id/status */
router.patch("/listings/:id/status", jwtAdminAuth, async (req, res) => {
  try {
    const { status, isVerified } = req.body;
    const update = {};
    if (status)     update.status     = status;
    if (isVerified !== undefined) update.isVerified = isVerified;
    await Listing.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* DELETE /admin/listings/:id */
router.delete("/listings/:id", jwtAdminAuth, async (req, res) => {
  try {
    await Listing.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ============================================================
   HOSTELS
============================================================ */
router.get("/hostels", jwtAdminAuth, async (req, res) => {
  try {
    const { search, status, page = 1 } = req.query;
    const limit = 20, skip = (page - 1) * limit;
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (search) filter.$or = [
      { hostelName: { $regex: search, $options: "i" } },
      { city:       { $regex: search, $options: "i" } }
    ];
    const [hostels, total] = await Promise.all([
      Hostel.find(filter).populate("owner", "name email phone").sort({ createdAt: -1 }).skip(skip).limit(limit),
      Hostel.countDocuments(filter)
    ]);
    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/hostels.ejs", {
      admin, hostels, total,
      currentPage: +page, totalPages: Math.ceil(total / limit),
      filters: { search, status }
    });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

/* ============================================================
   ENQUIRIES
============================================================ */
/* ============================================================
   ENQUIRIES
============================================================ */
router.get("/enquiries", jwtAdminAuth, async (req, res) => {
  try {
    const { status, category, page = 1 } = req.query;
    const limit = 20, skip = (page - 1) * limit;

    const filter = {};
    if (status   && status   !== "all") filter.status       = status;
    if (category && category !== "all") filter.leadCategory = category;

    const [enquiries, total, categoryBreakdown] = await Promise.all([
      Enquiry.find(filter)
        .populate("student", "firstName lastName phone email")
        .populate("listing", "title location startingPrice")
        .sort({ createdAt: -1 }).skip(skip).limit(limit),
      Enquiry.countDocuments(filter),

      // Hot/Warm/Cold breakdown (across all enquiries, not just this page)
      Enquiry.aggregate([
        { $group: { _id: "$leadCategory", count: { $sum: 1 } } }
      ])
    ]);

    const catMap = { Hot: 0, Warm: 0, Cold: 0 };
    categoryBreakdown.forEach(c => { if (c._id) catMap[c._id] = c.count; });

    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/enquiries.ejs", {
      admin, enquiries, total,
      currentPage: +page, totalPages: Math.ceil(total / limit),
      filters: { status, category },
      catMap
    });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

router.patch("/enquiries/:id/status/:status", jwtAdminAuth, async (req, res) => {
  const { id, status } = req.params;
  if (!["New", "Contacted", "Closed"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  await Enquiry.findByIdAndUpdate(id, { status });
  res.json({ ok: true });
});



/* ============================================================
   ANALYTICS
============================================================ */
router.get("/analytics", jwtAdminAuth, async (req, res) => {
  try {
    // Monthly signups — last 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const [
      ownerTrend, studentTrend, listingTrend,
      topCities, listingsByType, listingsByStatus,
      topRatedListings, mostViewedListings,
      enquiriesByStatus, enquiriesByMonth
    ] = await Promise.all([
      Owner.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        { $group: { _id: { m: { $month: "$createdAt" }, y: { $year: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } }
      ]),
      Student.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        { $group: { _id: { m: { $month: "$createdAt" }, y: { $year: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } }
      ]),
      Listing.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        { $group: { _id: { m: { $month: "$createdAt" }, y: { $year: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } }
      ]),
      Listing.aggregate([
        { $group: { _id: "$location.city", count: { $sum: 1 }, views: { $sum: "$views" } } },
        { $sort: { count: -1 } }, { $limit: 10 }
      ]),
      Listing.aggregate([{ $group: { _id: "$propertyType", count: { $sum: 1 } } }]),
      Listing.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Listing.find({ status: "Approved" }).sort({ rating: -1 }).limit(5).select("title rating reviewCount location startingPrice"),
      Listing.find({ status: "Approved" }).sort({ views: -1 }).limit(5).select("title views location startingPrice"),
      Enquiry.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Enquiry.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        { $group: { _id: { m: { $month: "$createdAt" }, y: { $year: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { "_id.y": 1, "_id.m": 1 } }
      ])
    ]);

    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/analytics.ejs", {
      admin,
      chartData: {
        ownerTrend:       JSON.stringify(ownerTrend),
        studentTrend:     JSON.stringify(studentTrend),
        listingTrend:     JSON.stringify(listingTrend),
        topCities:        JSON.stringify(topCities),
        listingsByType:   JSON.stringify(listingsByType),
        listingsByStatus: JSON.stringify(listingsByStatus),
        enquiriesByStatus:JSON.stringify(enquiriesByStatus),
        enquiriesByMonth: JSON.stringify(enquiriesByMonth)
      },
      topRatedListings,
      mostViewedListings
    });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});



 ////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GET /admin/search-analytics
/////////////////////////////////////////////////////////////////////////////////////////////////////////////


router.get("/search-analytics", jwtAdminAuth, async (req, res) => {
  try {
    const { range = "7" } = req.query;  // days
    const days = parseInt(range) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      totalSearches,
      topCities,
      topAreas,
      searchTypes,
      recentSearches,
      dailyTrend,
      loggedInSearches,
    ] = await Promise.all([

      // Total searches in period
      SearchLog.countDocuments({ createdAt: { $gte: since } }),

      // Top searched cities
      SearchLog.aggregate([
        { $match: { createdAt: { $gte: since }, resolvedCity: { $ne: "" } } },
        { $group: { _id: "$resolvedCity", count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 }
      ]),

      // Top searched areas
      SearchLog.aggregate([
        { $match: { createdAt: { $gte: since }, resolvedArea: { $ne: "" } } },
        { $group: { _id: "$resolvedArea", count: { $sum: 1 }, city: { $first: "$resolvedCity" } } },
        { $sort: { count: -1 } }, { $limit: 10 }
      ]),

      // Breakdown by search type
      SearchLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$searchType", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),

      // Recent searches (last 50)
      SearchLog.find({ createdAt: { $gte: since } })
        .sort({ createdAt: -1 }).limit(50)
        .select("searchQuery searchType resolvedCity resolvedArea studentName studentPhone ip createdAt resultsCount"),

      // Daily trend
      SearchLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ]),

      // Searches by logged-in students
      SearchLog.countDocuments({ createdAt: { $gte: since }, studentId: { $ne: null } }),
    ]);

    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/searchAnalytics.ejs", {
      admin,
      stats: { totalSearches, loggedInSearches },
      topCities,
      topAreas,
      searchTypes,
      recentSearches,
      dailyTrend: JSON.stringify(dailyTrend),
      range,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});







/* ============================================================
   PROFILE
============================================================ */
router.get("/profile", jwtAdminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select("-password");
    res.render("admin/profile.ejs", { admin });
  } catch (err) {
    res.status(500).send("Server Error");
  }
});

router.patch("/profile", jwtAdminAuth, async (req, res) => {
  try {
    const { name, address } = req.body;
    await Admin.findByIdAndUpdate(req.admin.id, { name, address });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

router.patch("/profile/password", jwtAdminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await Admin.findById(req.admin.id);
    const match = await admin.comparePassword(currentPassword);
    if (!match) return res.json({ success: false, error: "Current password is wrong" });
    if (newPassword.length < 8) return res.json({ success: false, error: "Password must be 8+ characters" });
    admin.password = newPassword;
    await admin.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;