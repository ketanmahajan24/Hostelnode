/* =================studentroutes.js===========================================
   STUDENT ROUTES — HostelNode
   Mount in app.js:  app.use('/student', studentRouter)
============================================================ */

const express       = require("express");
const router        = express.Router();
const bcrypt        = require("bcryptjs");
const path          = require("path");
const fs            = require("fs");
const multer        = require("multer");
const Student       = require("../models/studentSchema");    // adjust path
const { generateToken, jwtStudentAuth } = require("../Middlewares/jwtAuth"); // adjust path

const Listing = require("../models/listingProperty");    // adjust path
const { scoreLead } = require("../utils/leadScoring");
const { logSearch } = require("../utils/searchLogger");

const otpStore = new Map();
const { sendWhatsAppOTP , sendOwnerEnquiryMessage} = require("../models/Whatsapp.js");
// const { sendWhatsAppOTP } = require("../models/whatsappBaileys.js");

const sendOtp = async (phone, otp) => {
  return await sendWhatsAppOTP(phone, otp);
};

 
/* ──────────────────────────────────────────────────────────
   MULTER — Student profile images
────────────────────────────────────────────────────────── */
const studentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const UPLOAD_BASE = '/secure_uploads';

const dir = path.join(UPLOAD_BASE, 'students');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const crypto = require("crypto");
    cb(null, crypto.randomBytes(16).toString("hex") + path.extname(file.originalname));
  }
});

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only images allowed"), false);
};

const studentUpload = multer({
  storage: studentStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }   // 5MB
});

// Serve student images
// Add to app.js:  app.use('/student-images', express.static(path.join(__dirname, 'secure_uploads/students')));

/* ──────────────────────────────────────────────────────────
   JWT MIDDLEWARE for students
   Add this to your jwtAuth.js or inline here:
────────────────────────────────────────────────────────── */


  // function jwtStudentAuth(req, res, next) {
  //   const token = req.cookies.studentToken;
  //   if (!token) return res.redirect('/student/login');
  //   try {
  //     const decoded = jwt.verify(token, process.env.JWT_SECRET);
  //     req.student = decoded;
  //     next();
  //   } catch {
  //     res.clearCookie('studentToken');
  //     return res.redirect('/student/login');
  //   }
  // }

/* ============================================================
   GET  /student/signup
============================================================ */
router.get("/signup", (req, res) => {
  res.render("student/studentSignup.ejs");
});

/* ============================================================
   GET  /student/login
============================================================ */
router.get("/login", (req, res) => {
  res.render("student/studentLogin.ejs", { error: undefined });
});

/* ============================================================
   POST /student/send-otp
   Reuses your existing OTP infrastructure
============================================================ */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.json({ success: false, error: "Invalid phone number" });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Store in otpStore (Map)
    otpStore.set(phone, {
      otp,
      verified: false,
      expiresAt: Date.now() + 5 * 60 * 1000   // 5 min expiry
    });

    // Send via your SMS provider (Twilio / MSG91 etc.)
    await sendOtp(phone, otp);   // reuse your existing sendOtp util

    //console.log(`📱 OTP sent to ${phone}: ${otp}`);
    res.json({ success: true });

  } catch (err) {
    //console.error("OTP send error:", err);
    res.json({ success: false, error: "Failed to send OTP" });
  }
});

/* ============================================================
   POST /student/verify-otp
============================================================ */
router.post("/verify-otp", (req, res) => {
  try {
    const { phone, otp } = req.body;
    const stored = otpStore.get(phone);

    if (!stored) return res.json({ success: false, error: "OTP not sent or expired" });
    if (Date.now() > stored.expiresAt) {
      otpStore.delete(phone);
      return res.json({ success: false, error: "OTP expired. Request a new one" });
    }
    if (stored.otp !== otp) return res.json({ success: false, error: "Incorrect OTP" });

    // Mark as verified
    otpStore.set(phone, { ...stored, verified: true });
    res.json({ success: true });

  } catch (err) {
    //console.error("OTP verify error:", err);
    res.json({ success: false, error: "Server error" });
  }
});

/* ============================================================
   POST /student/signup
   Quick signup: firstName, lastName, phone only
============================================================ */
router.post("/signup", async (req, res) => {
  try {
    //console.log("\n=========== 🎓 STUDENT SIGNUP START ===========");

    const { firstName, lastName, phone } = req.body;

    // ── Validation ──
    if (!firstName || !lastName || !phone) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }
    if (firstName.trim().length < 2) {
      return res.status(400).json({ success: false, error: "First name too short" });
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, error: "Invalid phone number" });
    }

    // ── OTP verified check ──
    const otpData = otpStore.get(phone);
    if (!otpData || !otpData.verified) {
      return res.status(400).json({ success: false, error: "Phone not verified" });
    }
    otpStore.delete(phone);

    // ── Duplicate check ──
    const existing = await Student.findOne({ phone });
    if (existing) {
      return res.status(400).json({ success: false, error: "Phone already registered" });
    }

    // ── Create student ──
    const student = new Student({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      phone,
      status: "Active"
    });

    await student.save();
    //console.log("✅ Student saved:", student._id);

    // ── Issue JWT ──
    const token = generateToken({
      id:    student._id,
      phone: student.phone,
      role:  "Student"
    });

    res.cookie("studentToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",  // HTTPS pe auto-true
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // ── Welcome email (if email filled later, skip now) ──
    //console.log("🎉 Student signup complete");
    //console.log("=========== ✅ END ===========\n");

    // Redirect to edit profile to fill remaining details
    // ── Send Welcome WhatsApp on Signup ──
setImmediate(async () => {
  try {
    const { sendTemplateMessage } = require("../utils/leadWhatsapp");
    await sendTemplateMessage(
      student.phone,
      "hostelnode_welcome_signup",
      [student.firstName]
    );
    console.log(`✅ Signup welcome WA sent → ${student.phone}`);
  } catch (e) {
    console.error("Signup WA welcome failed (non-critical):", e.message);
  }
});

res.json({ success: true, redirect: "/student/edit-profile?new=1" });

  } catch (err) {
    //console.error("❌ Student signup error:", err);
    res.status(500).json({ success: false, error: "Server error. Please try again" });
  }
});

/* ============================================================
   POST /student/login
   Login via phone + OTP
============================================================ */
router.post("/login", async (req, res) => {
  try {
    //console.log("\n=========== 🎓 STUDENT LOGIN START ===========");

    const { phone } = req.body;

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.json({ success: false, error: "Invalid phone number" });
    }

    // ── OTP verified check ──
    const otpData = otpStore.get(phone);
    if (!otpData || !otpData.verified) {
      return res.json({ success: false, error: "Phone not verified" });
    }
    otpStore.delete(phone);

    // ── Find student ──
    const student = await Student.findOne({ phone, status: { $in: ["Active"] } });
    if (!student) {
      return res.json({ success: false, error: "No account found. Please sign up first" });
    }

    // ── Update last login ──
    student.lastLogin = new Date();
    await student.save();

    // ── Issue JWT ──
    const token = generateToken({
      id:    student._id,
      phone: student.phone,
      role:  "Student"
    });

    res.cookie("studentToken", token, {
      httpOnly: true,
        secure: process.env.NODE_ENV === "production",   
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
      // ── REDIRECT TO ORIGINAL PAGE IF `next` EXISTS ──
       // ── Send Welcome WhatsApp on Login ──
setImmediate(async () => {
  try {
    const { sendTemplateMessage } = require("../utils/leadWhatsapp");
    await sendTemplateMessage(
      student.phone,
      "hostelnode_welcome_login",
      [student.firstName]
    );
    console.log(`✅ Login welcome WA sent → ${student.phone}`);
  } catch (e) {
    console.error("Login WA welcome failed (non-critical):", e.message);
  }
});

const redirectTo = req.body.next || req.query.next || "/";
res.json({ success: true, redirect: redirectTo });
          //console.log(`✅ Student login: ${student.phone}`);
          //console.log("=========== ✅ END ===========\n");
 
  } catch (err) {
    //console.error("❌ Student login error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ============================================================
   GET  /student/dashboard
============================================================ */
router.get("/", jwtStudentAuth, async (req, res) => {
  try {
    const student = await Student.findById(req.student.id)
                                 .populate("wishlist");
    const listings = await Listing.find({}).limit(24).sort({ createdAt: -1 }) // latest first;
    //console.log("User session:", req.session);
    // if (!student) return res.redirect("/student/login");

    //console.log("Home Page loaded '/student' route");
    console.log("Student Dashboard accessed by:", student.phone);
   res.render("listings/findHostels.ejs", { listings, student});
    // res.redirect("/")
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

/* ============================================================
   GET  /student/edit-profile
============================================================ */
router.get("/edit-profile", jwtStudentAuth, async (req, res) => {
  try {
    const student = await Student.findById(req.student.id);
    if (!student) return res.redirect("/student/login");

    const isNew = req.query.new === "1";
    res.render("student/studentEditProfile.ejs", { student, isNew });
  } catch (err) {
    //console.error(err);
    res.status(500).send("Server Error");
  }
});

/* ============================================================
   POST /student/edit-profile
============================================================ */
router.post(
  "/edit-profile",
  jwtStudentAuth,
  studentUpload.single("profileImage"),
  async (req, res) => {
    try {
      const student = await Student.findById(req.student.id);
      if (!student) return res.redirect("/student/login");

      const {
        firstName, lastName, email,
        gender, dob, collegeName, course, year,
        city, state, pincode,
         profession 
      } = req.body;

      // Basic fields
      if (firstName) student.firstName = firstName.trim();
      if (lastName)  student.lastName  = lastName.trim();

      // Email uniqueness check
      if (email && email.trim()) {
        const emailExists = await Student.findOne({
          email: email.toLowerCase().trim(),
          _id: { $ne: student._id }
        });
        if (emailExists) {
          const isNew = req.body.isNew === "1";
          return res.render("student/studentEditProfile.ejs", {
            student, isNew,
            error: "Email already in use by another account"
          });
        }
        student.email = email.toLowerCase().trim();
      }

      // Profile fields
      if (gender)    student.gender      = gender;
      if (dob)       student.dob         = new Date(dob);
      if (collegeName) student.collegeName = collegeName.trim();
      if (course)    student.course      = course.trim();
      if (year)      student.year        = year;
      if (city)      student.city        = city.trim();
      if (state)     student.state       = state.trim();
      if (pincode)   student.pincode     = pincode.trim();
      if ( profession) student. profession =  profession;
      

      // Profile image
      if (req.file) {
        // Delete old image if exists
        if (student.profileImage) {
          const oldPath = path.join('/secure_uploads/students', student.profileImage);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        student.profileImage = req.file.filename;
      }

      await student.save();
      //console.log("✅ Student profile updated:", student._id);

      // If newly signed up, send welcome email
      if (req.body.isNew === "1" && student.email) {
        await sendMail(
          student.email,
          "🎓 Welcome to HostelNode!",
          `<div style="font-family:Arial;padding:20px">
            <h2 style="color:#09B850;">Welcome to HostelNode 🎓</h2>
            <p>Hi ${student.firstName},</p>
            <p>Your student profile is all set! Start exploring verified hostels near your college — zero broker fee.</p>
            <a href="https://hostelnode.com/findHostels"
              style="display:inline-block;padding:12px 20px;background:#09B850;
              color:white;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:12px;">
              🔍 Find Hostels Now
            </a>
            <p style="margin-top:20px;color:#888;">— Team HostelNode</p>
          </div>`
        );
      }

      res.redirect("/student");

    } catch (err) {
      //console.error("❌ Edit profile error:", err);
      res.status(500).send("Server Error");
    }
  }
);

 /* ============================================================
    

   GET  /student/wishlist  — show saved hostels
============================================================ */

router.get("/wishlist", jwtStudentAuth, async (req, res) => {
  try {
    const student = await Student.findById(req.student.id)
      .populate({
        path: "wishlist",
        model: "Listing",
        // Only fetch what the card needs — keeps it lean
        select: "title slug gender propertyType location images startingPrice rooms amenities rating reviewCount views isVerified contact"
      });

    if (!student) return res.redirect("/student/login");

    res.render("student/studentWishlist.ejs", {
      student,
      wishlist: student.wishlist || [],
    });

  } catch (err) {
    //console.error("Wishlist error:", err);
    res.status(500).send("Server Error");
  }
});
/* ============================================================
   POST /student/wishlist/toggle/:listingId
============================================================ */
router.post("/wishlist/toggle/:listingId", jwtStudentAuth, async (req, res) => {
  try {
    const student = await Student.findById(req.student.id);
    if (!student) return res.status(401).json({ success: false, error: "Not logged in" });

    const { listingId } = req.params;

    // Validate the listing actually exists
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ success: false, error: "Listing not found" });

    const alreadySaved = student.wishlist.some(id => id.toString() === listingId);

    if (alreadySaved) {
      student.wishlist = student.wishlist.filter(id => id.toString() !== listingId);
    } else {
      student.wishlist.push(listingId);
    }

    await student.save();

    res.json({
      success: true,
      saved: !alreadySaved,
      wishlistCount: student.wishlist.length
    });

  } catch (err) {
    //console.error("Wishlist toggle error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// /-----------------------------------------------------------------------/
/* ============================================================
   POST /student/review/:listingId
   Submit a rating + review for a hostel
============================================================ */
router.post("/review/:listingId", jwtStudentAuth, async (req, res) => {
  try {
    const { rating, comment } = req.body;

    // Validate rating
    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) {
      return res.status(400).json({ success: false, error: "Rating must be 1–5" });
    }

    const listing = await Listing.findById(req.params.listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: "Hostel not found" });
    }

    const student = await Student.findById(req.student.id);
    if (!student) {
      return res.status(401).json({ success: false, error: "Not logged in" });
    }

    // ── Check if student already reviewed this listing ──
    const alreadyReviewed = listing.reviews.some(
      rv => rv.student?.toString() === req.student.id
    );
    if (alreadyReviewed) {
      return res.status(400).json({ success: false, error: "You have already reviewed this hostel" });
    }

    // ── Add review ──
    listing.reviews.push({
      student:  student._id,
      userName: `${student.firstName} ${student.lastName}`,
      avatar:   student.profileImage || null,
      rating:   r,
      comment:  comment?.trim() || ""
    });

    // ── Recalculate rating average ──
    const total = listing.reviews.reduce((sum, rv) => sum + rv.rating, 0);
    listing.rating      = Math.round((total / listing.reviews.length) * 10) / 10;
    listing.reviewCount = listing.reviews.length;

    await listing.save();

    res.json({
      success: true,
      review: {
        userName: `${student.firstName} ${student.lastName}`,
        avatar:   student.profileImage,
        rating:   r,
        comment:  comment?.trim() || "",
        date:     new Date().toISOString()
      },
      newRating:      listing.rating,
      newReviewCount: listing.reviewCount
    });

  } catch (err) {
    //console.error("Review submit error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* ============================================================
   DELETE /student/review/:listingId
   Delete own review
============================================================ */
router.delete("/review/:listingId", jwtStudentAuth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.listingId);
    if (!listing) return res.status(404).json({ success: false, error: "Hostel not found" });

    const before = listing.reviews.length;
    listing.reviews = listing.reviews.filter(
      rv => rv.student?.toString() !== req.student.id
    );

    if (listing.reviews.length === before) {
      return res.status(404).json({ success: false, error: "Review not found" });
    }

    // Recalculate
    if (listing.reviews.length > 0) {
      const total = listing.reviews.reduce((sum, rv) => sum + rv.rating, 0);
      listing.rating = Math.round((total / listing.reviews.length) * 10) / 10;
    } else {
      listing.rating = 0;
    }
    listing.reviewCount = listing.reviews.length;

    await listing.save();

    res.json({
      success:        true,
      newRating:      listing.rating,
      newReviewCount: listing.reviewCount
    });

  } catch (err) {
    //console.error("Review delete error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


// ----------------------------------------------------------------------------------
// ENQUIRIES
/* ============================================================
   POST /student/enquiry
   Send an enquiry to hostel owner (via WhatsApp)
============================================================ */
const Enquiry = require("../models/enquiry");
router.post("/enquiry", jwtStudentAuth, async (req, res) => {
  try {
    const student = await Student.findById(req.student.id);

    if (!student) {
      return res.status(401).json({ success: false });
    }

    const {
      hostelId,
      hostelName,
      roomType,
      contactMethod,
      preferredDate,
      moveIn,
      message
    } = req.body;

    // 🔥 Get listing (IMPORTANT)
    const listing = await Listing.findById(hostelId);

    if (!listing) {
      return res.status(404).json({ success: false });
    }

    // 🔥 Get owner phone
    const ownerPhone =
      listing.contact?.whatsapp || listing.contact?.phone;

    // ✅ Save enquiry
    const newEnquiry = new Enquiry({
      student: student._id,
      listing: hostelId,
      hostelName,
      roomType,
      contactMethod,
      preferredDate,
      moveIn,
      message
    });

    await newEnquiry.save();

    //console.log(`📩 Enquiry Saved`);

    // 🔥 SEND WHATSAPP
    if (ownerPhone) {
      await sendOwnerEnquiryMessage(ownerPhone, {
        studentName: student.firstName,
        studentPhone: student.phone,
        hostelName,
        roomType,
        moveIn,
        message
      });
    }

    res.json({ success: true });

  } catch (err) {
    //console.error(err);
    res.status(500).json({ success: false });
  }
});

/* ============================================================
   POST /student/contact-owner
   New unified Contact Owner modal — creates a scored lead
============================================================ */
/* ============================================================
   POST /student/contact-owner
   Unified Contact Owner modal — creates scored lead + WA notify
============================================================ */
router.post("/contact-owner", jwtStudentAuth, async (req, res) => {
  try {
    const student = await Student.findById(req.student.id);
    if (!student) return res.status(401).json({ success: false, error: "Not logged in" });

    const {
      hostelId,
      hostelName,
      actionType,
      moveIn,
      budgetRange,
      message,
      visitDate,
      preferredDate,
    } = req.body;

    if (!hostelId || !actionType) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // ── Validate actionType ──────────────────────────────────
    const validActions = ["request_callback", "whatsapp_callback", "schedule_visit", "virtual_tour"];
    if (!validActions.includes(actionType)) {
      return res.status(400).json({ success: false, error: "Invalid action type" });
    }

    const listing = await Listing.findById(hostelId).populate("owner", "name phone");
    const resolvedHostelName = hostelName || listing.title || "This Hostel"; // ✅ fallback
    if (!listing) return res.status(404).json({ success: false, error: "Hostel not found" });

    // ── Map actionType → contactMethod ───────────────────────
    const contactMethodMap = {
      request_callback:  "call",
      whatsapp_callback: "whatsapp",
      schedule_visit:    "visit",
      virtual_tour:      "visit"
    };

    // ── Score the lead ────────────────────────────────────────
    const { score, category } = scoreLead({ actionType, moveIn, budgetRange, message });

    // ── Save enquiry ──────────────────────────────────────────
    const newEnquiry = new Enquiry({
      student:       student._id,
      listing:       hostelId,
      hostelName,
      contactMethod: contactMethodMap[actionType] || "call",
      actionType,
      moveIn,
      budgetRange,
      message,
      leadScore:     score,
      leadCategory:  category,
      status:        "New"
    });
    await newEnquiry.save();

    // ── Lead pipeline log (non-critical) ─────────────────────
    try {
      const { createLead } = require("../utils/leadLogger");
      const leadTypeMap = {
        request_callback:  "wants_to_call",
        whatsapp_callback: "wants_whatsapp",
        schedule_visit:    "wants_to_visit",
        virtual_tour:      "wants_to_meet"
      };
      await createLead({
        req,
        leadType:  leadTypeMap[actionType] || "wants_to_call",
        hostelId,
        hostelName,
        moveIn,
        message
      });
    } catch (e) {
      console.error("Lead pipeline log failed (non-critical):", e.message);
    }

    // ── Notify owner via WhatsApp template ───────────────────
    const ownerPhone = listing.contact?.whatsapp
                    || listing.contact?.phone
                    || listing.owner?.phone;

    if (ownerPhone) {
      // ── Template map ───────────────────────────────────────
      const templateMap = {
        request_callback:  "hostelnode_callback_lead",
        whatsapp_callback: "hostelnode_whatsapp_lead",
        schedule_visit:    "hostelnode_physical_visit",
        virtual_tour:      "hostelnode_virtual_tour"
      };

      // ── Variables per template ─────────────────────────────
      const studentName    = `${student.firstName} ${student.lastName || ""}`.trim();
      const studentPhone   = student.phone   || "Not provided";
      const studentCollege = student.collegeName || "Not mentioned";
      const budget         = budgetRange || "Not specified";

      const variablesMap = {
        request_callback: [
          studentName,
          studentPhone,
          studentCollege,
          resolvedHostelName,
          moveIn      || "Not specified",
          budget
        ],
        whatsapp_callback: [
          studentName,
          studentPhone,
          studentCollege,
          resolvedHostelName, // hostelName
          moveIn      || "Not specified",
          budget
        ],
        schedule_visit: [
          studentName,
          studentPhone,
          studentCollege,
          resolvedHostelName, // hostelName
          visitDate   || moveIn || "Not specified",
          budget
        ],
        virtual_tour: [
          studentName,
          studentPhone,
          studentCollege,
          resolvedHostelName, // hostelName
          preferredDate || moveIn || "Not specified",
          budget
        ]
      };

      const templateName = templateMap[actionType];
      const variables    = variablesMap[actionType];

      // ── Send (non-critical — enquiry already saved) ────────
      setImmediate(async () => {
        try {
          const { sendTemplateMessage } = require("../utils/leadWhatsapp");
          const result = await sendTemplateMessage(ownerPhone, templateName, variables);
          if (result.success) {
            console.log(`✅ Owner notified [${templateName}] → ${ownerPhone}`);
          } else {
            console.error(`🔴 Template failed [${templateName}]:`, result.error);
          }
        } catch (e) {


          console.error("WA template notify failed (non-critical):", e.message);
        }
      });
      // ── Notify STUDENT via WhatsApp confirmation ──────────────
    setImmediate(async () => {
      try {
        const { sendTemplateMessage } = require("../utils/leadWhatsapp");

        const actionLabelMap = {
          request_callback:  "Callback Request",
          whatsapp_callback: "WhatsApp Callback",
          schedule_visit:    "Physical Visit",
          virtual_tour:      "Virtual Tour"
        };

        const hostelLink = `https://hostelnode.com/hostel/${listing.slug}`;

        const result = await sendTemplateMessage(
          student.phone,
          "hostelnode_student_confirmation",
          [
            student.firstName,                         // {{1}} name
            resolvedHostelName,                        // {{2}} hostel name
            actionLabelMap[actionType] || actionType,  // {{3}} action
            moveIn || "Not specified",                 // {{4}} move-in
            hostelLink                                 // {{5}} hostel link
          ]
        );

        if (result.success) {
          console.log(`✅ Student confirmation WA sent → ${student.phone}`);
        } else {
          console.error(`🔴 Student WA failed:`, result.error);
        }

      } catch (e) {
        console.error("Student WA notify failed (non-critical):", e.message);
      }
    });
    } else {
      console.warn("⚠️ No owner phone found for listing:", hostelId);
    }

    return res.json({
      success:  true,
      leadId:   newEnquiry._id,
      category,
      message:  "Your enquiry has been sent to the property owner."
    });

  } catch (err) {
    console.error("contact-owner error:", err);
    return res.status(500).json({ success: false, error: "Server error. Please try again." });
  }
});





/* ============================================================
   POST /student/logout
============================================================ */
router.post("/logout", (req, res) =>{
  res.clearCookie("studentToken");
  res.redirect("/student/login");
});


/* ============================================================
   GET  /student/logout  (for link-based logout)
============================================================ */
router.get("/logout", (req, res) => {
  res.clearCookie("studentToken");
  res.redirect("/");
});
 
router.post("/logout", (req, res) => {
  res.clearCookie("studentToken");
  res.redirect("/");
});


/* ============================================================
   GET /student/nearby
   ?lat=18.9&lng=72.8&radius=5
   No auth required — works for guests too
============================================================ */
router.get("/nearby", async (req, res) => {
  try {
    const lat    = parseFloat(req.query.lat);
    const lng    = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 5;

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, error: "Invalid coordinates" });
    }

    /* Pull approved listings that have coordinates saved */
    const all = await Listing.find({
      status: "Approved",
      "location.coordinates.lat": { $exists: true, $ne: null },
      "location.coordinates.lng": { $exists: true, $ne: null },
    }).select(
      "title slug gender propertyType location images startingPrice rooms amenities rating reviewCount views isVerified contact"
    );

    /* Haversine distance in km */
    function haversine(lat1, lng1, lat2, lng2) {
      const R    = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a    =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const nearby = all
      .map(l => {
        const obj = l.toObject();
        obj.distanceKm = haversine(
          lat, lng,
          l.location.coordinates.lat,
          l.location.coordinates.lng
        );
        return obj;
      })
      .filter(l => l.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm);
      // ─────────────────────────────────────────────
// LOG NEARBY SEARCH
// ─────────────────────────────────────────────

await logSearch({
  req,
  searchType: "nearby_click",
  searchQuery: "Near Me",
  resolvedCity: "",
  resolvedArea: "",
  resultsCount: nearby.length,
  lat: lat,
  lng: lng,
});

    res.json({ success: true, count: nearby.length, listings: nearby });

  } catch (err) {
    console.error("Nearby route error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


module.exports = router;

/* ============================================================
   ADD TO app.js:
   const studentRouter = require('./routes/studentRoutes');
   app.use('/student', studentRouter);
   app.use('/student-images', express.static(path.join(__dirname, 'secure_uploads/students')));
============================================================ */
