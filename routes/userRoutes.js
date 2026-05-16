const express = require('express');
const router = express.Router();
const Admin = require("../models/admin.js"); // Floor SCHEMA
const session = require("express-session");
// const Owner = require('../models/user');  // Adjust path if necessary
const otpGenerator = require("otp-generator");
const Otp = require("../models/Otp");
const { sendWhatsAppOTP } = require("../models/Whatsapp.js");
// const { sendWhatsAppOTP } = require("../models/whatsappBaileys.js");
const multer = require("multer");
const path = require("path");
// listing property schema
const Listing = require("../models/listingProperty");  
const Owner = require("../models/owner");
 

const {jwtAuthMiddleware,generateToken}=require('./../jwt.js') 
 const otpStore = new Map();
// ///////////////////////////////////////////
// SCHEMA CONNECTIN $ REQUIRE 
// ///////////////////////////////////////////
const Enquiry = require("../models/enquiry");
const Floor = require("../models/floor.js"); // Floor SCHEMA
const Room = require("../models/room.js"); // room SCHEMA
const Member = require("../models/member.js"); // room SCHEMA
const Payment = require("../models/payment.js"); // Payment SCHEMA
const Hostel = require("../models/hostel.js");
// const Owner = require('./models/user.js'); 
/////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////
////// admin dashboard 
const crypto = require('crypto');
const fs = require('fs');
const moment = require("moment-timezone");
const bcrypt = require("bcrypt");
const validator = require("validator");



const handleMulterError = (fn) => (req, res, next) => {
  fn(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(413).send("❌ File too large! Max 100MB per image.");
    if (err.code === "LIMIT_FILE_COUNT")
      return res.status(413).send("❌ Too many files! Max 15 images.");
    return res.status(500).send("❌ Upload failed. Try again.");
  });
};

// 🔐 Secure folder path
const uploadDir = '/secure_uploads/profiles';
// const uploadDir = '/app/secure_uploads/profiles'; // ✅ absolute path for Docker

// Ensure folder exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ✅ Multer Config (UPDATED)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // ✅ secure path
  },
  filename: function (req, file, cb) {
    const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName); // ✅ random secure filename
  }
});

// ✅ File filter (only images)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, WEBP allowed'), false);
  }
};

// ✅ Multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Shows only  the hostels of the logged-in owner in the dropdown (for selection) in navbar
// ✅ Middleware to attach hostels to res.locals for easy access in all routes
const attachHostel = async (req, res, next) => { // Middleware to attach hostels to res.locals
  try {
    const userId = req.user?.id;

    if (!userId) return next();

    const hostels = await Hostel.find({ owner: userId });

    let selectedHostel = null;

    if (req.session && req.session.selectedHostel) {
      selectedHostel = await Hostel.findById(req.session.selectedHostel);
    }

    if (!selectedHostel && hostels.length > 0) {
      selectedHostel = hostels[0];
    }
    
    // 🔥 GLOBAL VARIABLES
    res.locals.hostels = hostels;
    res.locals.selectedHostel = selectedHostel;

    next();
  } catch (err) {
    // console.error("Attach Hostel Error:", err);
    next();
  }
}; 




/* ============================================================
   POST /user/send-otp
============================================================ */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.json({ success: false, error: "Invalid phone number" });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    otpStore.set(phone, {
      otp,
      verified: false,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    await sendWhatsAppOTP(phone, otp);
    // console.log(`📱 Owner OTP sent to ${phone}: ${otp}`);

    res.json({ success: true });
  } catch (err) {
    // console.error("OTP send error:", err);
    res.json({ success: false, error: "Failed to send OTP" });
  }
});

/* ============================================================
   POST /user/verify-otp
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

    otpStore.set(phone, { ...stored, verified: true });
    res.json({ success: true });
  } catch (err) {
    // console.error("OTP verify error:", err);
    res.json({ success: false, error: "Server error" });
  }
});















// ✅ POST /signup
router.post("/signup", upload.single("profileImage"), async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // ===============================
    // 🧪 VALIDATION
    // ===============================

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (name.trim().length < 3) {
      return res.status(400).json({ error: "Name must be at least 3 characters" });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    if (!validator.isStrongPassword(password, { minLength: 6, minNumbers: 1 })) {
      return res.status(400).json({ error: "Password must be 6+ chars with at least 1 number" });
    }

    // ===============================
    // 🔐 OTP CHECK
    // ===============================
    const otpData = otpStore.get(phone);

    if (!otpData) {
      return res.status(400).json({ error: "OTP not sent or expired. Please request a new OTP." });
    }

    if (Date.now() > otpData.expiresAt) {
      otpStore.delete(phone);
      return res.status(400).json({ error: "OTP expired. Please request a new one." });
    }

    if (!otpData.verified) {
      return res.status(400).json({ error: "Phone not verified. Please enter the OTP first." });
    }

    otpStore.delete(phone); // ✅ cleanup

    // ===============================
    // 🔁 DUPLICATE CHECK
    // ===============================
    const existingEmail = await Owner.findOne({ email: email.toLowerCase().trim() });
    if (existingEmail) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const existingPhone = await Owner.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ error: "Phone already registered" });
    }

    // ===============================
    // 🔐 HASH PASSWORD
    // ===============================
    const hashedPassword = await bcrypt.hash(password, 10);

    // ===============================
    // 🖼️ IMAGE HANDLING
    // ===============================
    const profileImage = req.file ? req.file.filename : null;

    // ===============================
    // 📦 CREATE OWNER
    // ===============================
    const newOwner = new Owner({
      name:            name.trim(),
      email:           email.toLowerCase().trim(),
      phone,
      password:        hashedPassword,
      profileImage,
      hostels:         [],      // ✅ correct schema field (ObjectId refs, starts empty)
      listings:        [],      // ✅ correct schema field (ObjectId refs, starts empty)
      status:          "Active",
      isPhoneVerified: true,    // ✅ they just verified via OTP
      role:            "Owner"  // ✅ explicit, matches schema default
      // ✅ no createdAt — { timestamps: true } handles createdAt + updatedAt automatically
      // ✅ gender, dob, businessName, businessType, whatsapp, city, state,
      //    country, pincode, location — all optional, filled later from profile
    });

    // ===============================
    // 💾 SAVE TO DB
    // ===============================
    await newOwner.save();

    // ===============================
    // 📧 WELCOME EMAIL
    // Non-blocking — a mail failure won't crash signup
    // ===============================
    sendMail(
      newOwner.email,
      "🎉 Welcome to HostelNode!",
      `
      <div style="font-family:Arial;padding:20px">
        <h2 style="color:#09B850;">Welcome to HostelNode 🚀</h2>
        <p>Hi ${newOwner.name},</p>
        <p>🎉 Your account has been successfully created!</p>
        <p>HostelNode helps you manage your hostel easily — rooms, members, payments, everything in one place.</p>
        <hr style="margin:20px 0;">
        <h3>📺 Watch Demo</h3>
        <p>Learn how to use HostelNode in 2 minutes:</p>
        <a href="https://your-demo-video-link.com"
          style="display:inline-block;padding:12px 18px;background:#09B850;color:white;
                 text-decoration:none;border-radius:8px;font-weight:bold;">
          ▶ Watch Demo
        </a>
        <hr style="margin:20px 0;">
        <h3>📘 User Manual</h3>
        <p>Step-by-step guide to use HostelNode:</p>
        <a href="https://your-manual-link.com"
          style="display:inline-block;padding:12px 18px;background:#0f172a;color:white;
                 text-decoration:none;border-radius:8px;font-weight:bold;">
          📖 Open Manual
        </a>
        <hr style="margin:20px 0;">
        <p style="color:#555;">If you need help, feel free to contact us anytime.</p>
        <p style="font-weight:bold;">Happy Managing! 🏨</p>
        <p style="color:#09B850;font-weight:bold;">— Team HostelNode</p>
      </div>
      `
    ).catch(err => console.error("📧 Welcome email failed (non-fatal):", err.message));

    // ===============================
    // 🎉 SUCCESS
    // ===============================
    res.status(201).render("authPrivate/signupSuccess.ejs", {
      message: "Signup successful",
      user: {
        name:   newOwner.name,
        email:  newOwner.email,
        status: newOwner.status
      }
    });

  } catch (err) {
    console.error("SIGNUP ERROR:", err);

    // Handle MongoDB duplicate key error (race condition — two signups same time)
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0]; // "email" or "phone"
      return res.status(400).json({
        error: `${field === "email" ? "Email" : "Phone"} already registered`
      });
    }

    res.status(500).json({ error: "Server error. Please try again later" });
  }
});

router.post('/login', async (req, res) => {
  
  try {
    // console.log("\n================= 🚀 LOGIN START =================");
    // console.log("📥 BODY:", req.body);

    // Extract from nested user object
    const { email, password, role } = req.body.user;
    // console.log("📥 Login Attempt:", { email, role });

    // Basic validation
    if (!email || !password || !role) {
      return res.render("authPrivate/login.ejs", { error: "Please enter email, password, and role" });
    }

    // Find user by email, role, and active status
    const user = await Owner.findOne({
      email: email.toLowerCase(),
      role: role,
      status: { $in: ["Pending", "Active" ,"Inactive"] } // Only allow login if status is "Pending" or "Active"  (admin approval)
    });

    if (!user) {
      return res.render("authPrivate/login.ejs", { error: "Invalid credentials or account not active" });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render("authPrivate/login.ejs", { error: "Invalid credentials" });
    }

    // Generate token
    const payload = { id: user._id, email: user.email, role: user.role };
    const token = generateToken(payload);

    // console.log(`Login Successful: ${user.email} (${user.role})`);

    // Set cookie
    res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'strict' });
// after successful login (password matched)

        // 📩 SEND LOGIN ALERT EMAIL
        await sendMail(
          user.email,
          "🔐 New Login Detected - HostelNode",
          `
          <div style="font-family:Arial;padding:20px">
            <h2 style="color:#09B850;">New Login Alert 🔐</h2>

            <p>Hello ${user.name},</p>

            <p>Your HostelNode account was just accessed.</p>

            <ul style="line-height:1.6">
              <li><b>Time:</b> ${new Date().toLocaleString()}</li>
              <li><b>Device:</b> ${req.headers["user-agent"]}</li>
              <li><b>IP Address:</b> ${req.ip}</li>
            </ul>

            <p style="color:#555;">
              If this was you, you can safely ignore this email.
            </p>

            <p style="color:red;font-weight:bold;">
              ⚠️ If this was NOT you, please reset your password immediately.
            </p>

            <a href="http://localhost:6060/user/forgot-password"
              style="display:inline-block;padding:10px 18px;
              background:#dc2626;color:white;text-decoration:none;
              border-radius:6px;margin-top:10px;">
              Reset Password Now
            </a>

            <hr style="margin:20px 0;">

            <p style="font-size:12px;color:#888;">
              HostelNode Security System
            </p>
          </div>
          `
        );

        // console.log("📧 Login alert sent");
    // Redirect
    res.redirect('/user');

  } catch (err) {
    // console.error("Login Error:", err);
    res.status(500).render("authPrivate/login.ejs", { error: "Server error. Please try again later" });
  }
});
// GET method to get the dashboard data
router.get('/', jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await Owner.findById(userId);

    // 🔥 STEP 1: CHECK HOSTELS FIRST
    const hostels = await Hostel.find({ owner: userId });

    // ❌ If no hostel → show onboarding page
    if (!hostels || hostels.length === 0) {
      return res.render("onboarding.ejs", {
        user
      });
    }

    // 🔥 STEP 2: SELECT HOSTEL (AUTO FIRST)
    let selectedHostel = res.locals.selectedHostel?._id;
    // const selectedHostel = res.locals.selectedHostel?._id;
    if (!selectedHostel){
      selectedHostel = hostels[0]._id; // ✅ auto first hostel
    }

    // ✅ FILTER BY HOSTEL
    const rooms = await Room.find({ user: userId, hostel: selectedHostel });
    const floors = await Floor.find({ user: userId, hostel: selectedHostel });

    const members = await Member.find({ user: userId, hostel: selectedHostel })
      .populate("payments")
      .exec();

    // ✅ Calculations
    const totalBeds = rooms.reduce((sum, room) => sum + room.sharing_capacity, 0);
    const availableBeds = totalBeds - rooms.reduce((sum, room) => sum + room.occupied_beds, 0);
    const bookedRooms = rooms.filter(room => room.occupied_beds > 0).length;
    const totalRooms = rooms.length;
    const totalStudents = members.length;

    let totalExpectedRevenue = 0;
    let totalFeesCollected = 0;
    let totalPendingAmount = 0;
    let totalAdvancedPaid = 0;
    let paidAccounts = 0;
    let dueAccounts = 0;

    members.forEach(member => {
      const totalRoomFees = member.payments.reduce((sum, p) => sum + (p.roomFees || 0), 0);
      const totalPaid = member.payments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);

      const dueAmount = totalRoomFees - totalPaid;
      const advancedPaid = totalPaid > totalRoomFees ? totalPaid - totalRoomFees : 0;

      totalExpectedRevenue += totalRoomFees;
      totalFeesCollected += totalPaid;
      totalPendingAmount += dueAmount > 0 ? dueAmount : 0;
      totalAdvancedPaid += advancedPaid > 0 ? advancedPaid : 0;

      if (totalPaid >= totalRoomFees) {
        paidAccounts++;
      } else {
        dueAccounts++;
      }
    });

    let feesCollectionCompleted = totalExpectedRevenue > 0
      ? ((totalFeesCollected / totalExpectedRevenue) * 100).toFixed(2)
      : 0;

    const formatCurrency = (amount) => {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);
    };

    // ✅ FINAL RENDER DASHBOARD
    res.status(200).render('dashboard.ejs', {
      user,
      hostels,
      selectedHostel: res.locals.selectedHostel, // 🔥 important
      availableBeds,
      totalBeds,
      bookedRooms,
      totalRooms,
      totalStudents,
      totalPendingAmount: formatCurrency(totalPendingAmount),
      totalAdvancedPaid: formatCurrency(totalAdvancedPaid),
      totalFeesCollected: formatCurrency(totalFeesCollected),
      totalExpectedRevenue: formatCurrency(totalExpectedRevenue),
      balance: formatCurrency(totalExpectedRevenue - totalFeesCollected),
      feesCollectionCompleted,
      paidAccounts,
      dueAccounts
    });

    // console.log("✅ Dashboard loaded");

  } catch (err) {
    // console.error(err);
    res.status(500).send("Server Error");
  }
});

// Edit Owner Profile Page
  router.get("/editOwner", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const user = await Owner.findById(req.user.id);
    res.render("showPage/owner/editOwner.ejs", { user });
  } catch (err) {
    // console.error(err);
    res.status(500).send("Error loading page");
  }
});

// Edit Owner Profile Handler (POST)
router.post("/editOwner", jwtAuthMiddleware, handleMulterError(upload.single("profileImage")), async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      name,
      phone,
      whatsapp,
      businessName,
      businessType,
      city,
      state,
      country,
      pincode
    } = req.body;

    let updateData = {
      name,
      phone,
      whatsapp,
      businessName,
      businessType,
      city,
      state,
      country,
      pincode,
      location: `${city}, ${state}, ${country}`
    };

    if (req.file) {
      updateData.profileImage = req.file.filename;
    }

    await Owner.findByIdAndUpdate(userId, updateData);

    res.redirect("/user");

  } catch (err) {
    // console.error(err);
    res.status(500).send("Update failed");
  }
});

//Select Hostel - when user will select the hostel from dropdown in navbar
router.get("/hostel/:id", jwtAuthMiddleware, async (req, res) => { 
  const hostelId = req.params.id; 

  // ✅ Save selected hostel in session
  req.session.selectedHostel = hostelId;
  res.redirect("/user"); // Redirect to dashboard or any page you want
});

router.get("/profile",jwtAuthMiddleware, attachHostel,async(req,res)=>{
    try{
        userData=req.user;
        // console.log("USER DATA",userData);
        const userId=userData.id;
        // const user = await Owner.findById(userId);
        // res.status(200).render('dashboard.ejs');
        res.status(200).send("heelo i m profile")
    }catch(err){
        // console.error(err);
        res.status(500).json({error:"internal server "})
    }
})
/////////////////////// ➕ Add New Hostel Page ///////////////////////////////////////////////////////////////////////////

router.get("/addnewhostel", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id; // logged-in owner ID
    const user = await Owner.findById(userId);
    const hostels = await Hostel.find({ owner: userId });
    // Render your EJS file
    res.status(200).render("showPage/hostels/addnewhostel.ejs", {
      user,
      hostels,
    });
    
  } catch (err) {
    // console.error("Error loading add new hostel page:", err);
    res.status(500).send("Internal Server Error");
  }
});

/////////////////////////////////////// ➕ Create New Hostel/////////////////////////////////////////////////////////////
router.post("/create-hostel", jwtAuthMiddleware,attachHostel, async (req, res) => {
  try {
    // console.log("\n🏨 ===== CREATE HOSTEL START =====");

    const userId = req.user.id;
    const user = await Owner.findById(userId);

    // 📥 Get form data
    const { hostelName, city, state, country, pincode } = req.body;

    // console.log("📥 BODY:", req.body);

    // ===============================
    // 🧪 VALIDATION
    // ===============================
    if (!hostelName || !city || !state || !country || !pincode) {
      return res.status(400).send("All fields are required");
    }

    if (hostelName.length < 3) {
      return res.status(400).send("Hostel name must be at least 3 characters");
    }

    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).send("Invalid pincode");
    }

    // ===============================
    // 🔥 GENERATE HOSTEL ID (CITY BASED)
    // ===============================
    const prefix = city.substring(0, 3).toUpperCase();

    const count = await Hostel.countDocuments({
      hostelId: { $regex: `^${prefix}` }
    });

    const newHostelId = prefix + String(count + 1).padStart(4, "0");

    // console.log("🏷️ Generated Hostel ID:", newHostelId);

    // ===============================
    // 🏨 CREATE HOSTEL  
    // ===============================
    const newHostel = new Hostel({
      hostelName: hostelName.trim(),
      city,
      state,
      country,
      pincode,
      location: `${city}, ${state}, ${country}`,
      hostelId: newHostelId,

      owner: userId, // 🔥 important (relation)
      createdAt: new Date()
    });

    // ===============================
    // 💾 SAVE HOSTEL 
    // ===============================
    await newHostel.save();
    // console.log("✅ Hostel saved:", newHostel);

    // ===============================
    // 🔗 LINK HOSTEL TO OWNER
    // ===============================
    await Owner.findByIdAndUpdate(userId, {
      $push: { hostelIds: newHostelId } // store hostelId in owner
    });

    // console.log("🔗 Hostel linked to owner");

    // ===============================
    // 🎉 RESPONSE
    // ===============================
    // console.log("🎉 ===== HOSTEL CREATED SUCCESS =====\n");

    res.redirect("/user"); // or dashboard / hostel list

  } catch (err) {
    // console.error("❌ Error creating hostel:", err);
    res.status(500).send("Server Error");
  }
});


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////// View all Floors//////////////////////////////////////////////////////////////////////////////////////////
    router.get("/floors",jwtAuthMiddleware,attachHostel,async(req,res)=>{
        
        const userId = req.user.id; // This is your user ID from the token
        // const OwnerId = req.user.id; // This is your user ID from the token
        const user= await Owner.findById(userId)
        const selectedHostel = res.locals.selectedHostel?._id;
        const allFloors = await Floor.find({ user: userId, hostel: selectedHostel }); // Fetch floors for the selected hostel and logged-in user
        // Find floors where userId matches the creator
        // const allFloors = await Floor.find({ user: userId });

        // // console.log(user);
        res.status(200).render("showPage/floors/floor.ejs",{allFloors,user});
      })
      //all Floor
    router.get("/managefloor",jwtAuthMiddleware,attachHostel, async (req,res)=>{ 
        const userId = req.user.id; // This is your user ID from the token
        const user= await Owner.findById(userId)

        const selectedHostel = res.locals.selectedHostel?._id;

        const allFloors = await Floor.find({
          user: userId,
          hostel: selectedHostel
        });
        
        res.status(200).render("showPage/floors/managefloor.ejs",{allFloors,user});
    })
    //Add New Floor
    router.get("/newfloor",jwtAuthMiddleware,attachHostel,async(req,res)=>{
        const userId = req.user.id; // This is your user ID from the token
        const user= await Owner.findById(userId)
        
        res.render("showPage/floors/newFloor.ejs",{user})
    })

    // Taking input values from newFloor // route ->{"/admin/students/new"}
    router.post("/newfloor", jwtAuthMiddleware, attachHostel, async (req, res) => {
      try {
        const { floor_name } = req.body.floor;

        const userId = req.user.id;
        const selectedHostel =
          res.locals.selectedHostel?._id || req.session?.selectedHostel;

        // ✅ Check hostel selected
        if (!selectedHostel) {
          return res.send("⚠️ Please select a hostel first");
        }

        // ✅ Duplicate check (FIXED)
        const existingFloor = await Floor.findOne({
          floor_name: floor_name.trim(),
          user: userId,
          hostel: selectedHostel
        });

        if (existingFloor) {
          return res
            .status(400)
            .send(`<h1>${floor_name} already exists in this hostel</h1>`);
        }

        // ✅ CREATE FLOOR (FIXED)
        const newFloor = new Floor({
          floor_name: floor_name.trim(),
          user: userId,
          hostel: selectedHostel   // 🔥 CRITICAL FIX
        });

        await newFloor.save();

        // console.log("✅ New Floor Added:", newFloor);

        res.redirect("/user/floors"); // ✅ fixed route

      } catch (error) {
        // console.error("❌ Error saving floor:", error);

        if (error.code === 11000) {
          res.status(400).send("Duplicate entry detected.");
        } else if (error.name === "ValidationError") {
          res.status(400).send("Validation Error: " + error.message);
        } else {
          res.status(500).send("Something went wrong");
        }
      }
    });

    // DELETE FLOOR /////////////////////////////////////////
    // //DELETE ROUTE
    router.delete("/managefloor/:id",jwtAuthMiddleware,attachHostel, async(req,res)=>{
        const userId = req.user.id; // This is your user ID from the token
        const user= await Owner.findById(userId)
    
      let {id}=req.params;
    //   const floor = await Floor.find({ user: userId });
      let deletefloor=  await Floor.findOneAndDelete({
                        _id: id,
                        user: userId,
                        hostel: selectedHostel
                      });
      // // console.log(deletedMember);
      res.redirect("/user/managefloor");
    })

///////
/////////////////////////----------/////////////////////////////////////////////////////

        //////////////////////// VIEW ALL ROOMS ///////////////////////
        router.get("/allrooms", jwtAuthMiddleware, attachHostel, async (req, res) => {
          try {
            const userId = req.user.id;
            const user = await Owner.findById(userId);

            const selectedHostel = res.locals.selectedHostel?._id;

            if (!selectedHostel) {
              return res.send("⚠️ Please select a hostel first");
            }

            const allRooms = await Room.find({
              user: userId,
              hostel: selectedHostel
            });

            const allFloors = await Floor.find({
              user: userId,
              hostel: selectedHostel
            });

            res.render("showPage/rooms/allrooms.ejs", {
              allRooms,
              allFloors,
              user
            });

          } catch (err) {
            // console.error(err);
            res.status(500).send("Server Error");
          }
        });

        /////////////////////// MANAGE ROOMS ///////////////////////
        router.get("/managerooms", jwtAuthMiddleware, attachHostel, async (req, res) => {
          try {
            const userId = req.user.id;
            const user = await Owner.findById(userId);

            const selectedHostel = res.locals.selectedHostel?._id;

            if (!selectedHostel) {
              return res.send("⚠️ Please select a hostel first");
            }

            const allRooms = await Room.find({
              user: userId,
              hostel: selectedHostel
            });

            res.render("showPage/rooms/managerooms.ejs", { allRooms, user });

          } catch (err) {
            // console.error(err);
            res.status(500).send("Server Error");
          }
        });

        /////////////////////// ADD NEW ROOM (GET) ///////////////////////
        router.get("/newroom", jwtAuthMiddleware, attachHostel, async (req, res) => {
          try {
            const userId = req.user.id;
            const user = await Owner.findById(userId);

            const selectedHostel = res.locals.selectedHostel?._id;

            if (!selectedHostel) {
              return res.send("⚠️ Please select a hostel first");
            }

            const floors = await Floor.find({
              user: userId,
              hostel: selectedHostel
            });

            res.render("showPage/rooms/newRoom.ejs", { floors, user });

          } catch (err) {
            // console.error(err);
            res.status(500).send("Server Error");
          }
        });

        /////////////////////// ADD NEW ROOM (POST) ///////////////////////
        router.post("/newroom", jwtAuthMiddleware, attachHostel, async (req, res) => {
          try {
            const userId = req.user.id;
            const selectedHostel = res.locals.selectedHostel?._id;

            if (!selectedHostel) {
              return res.send("⚠️ Please select a hostel first");
            }

            const { floor_id, room_number, room_fees, sharing_capacity, occupied_beds } = req.body.room;

            // ✅ Validate floor belongs to same hostel + user
            const floor = await Floor.findOne({
              _id: floor_id,
              user: userId,
              hostel: selectedHostel
            });

            if (!floor) {
              return res.status(404).send("Error: Floor not found or unauthorized.");
            }

            // ✅ Check duplicate room in same floor
            const existingRoom = await Room.findOne({
              room_number,
              floor_id,
              hostel: selectedHostel
            });

            if (existingRoom) {
              return res.status(400).send(`<h1>Room ${room_number} already exists on this floor.</h1>`);
            }

            // ✅ Create Room 
            const newRoom = new Room({
              user: userId,
              hostel: selectedHostel,   // ⭐ IMPORTANT FIX
              floor_id,
              floor_name: floor.floor_name,
              room_number,
              room_fees,
              sharing_capacity,
              occupied_beds
            });

            await newRoom.save();

            // ✅ Update floor stats
            await Floor.findByIdAndUpdate(floor_id, {
              $inc: {
                total_rooms: 1,
                total_beds: sharing_capacity
              }
            });

            // console.log("New Room Added:", newRoom);
            res.redirect("/user/allrooms");

          } catch (error) {
            // console.error("Error saving room:", error);

            if (error.code === 11000) {
              res.status(400).send("Duplicate room entry.");
            } else if (error.name === "ValidationError") {
              res.status(400).send("Validation Error: " + error.message);
            } else {
              res.status(500).send("Something went wrong");
            }
          }
        });

        /////////////////////// EDIT ROOM ///////////////////////
        router.get("/managerooms/:id/edit", jwtAuthMiddleware, attachHostel, async (req, res) => {
          const userId = req.user.id;
          const user = await Owner.findById(userId);

          const selectedHostel = res.locals.selectedHostel?._id;

          const room = await Room.findOne({
            _id: req.params.id,
            user: userId,
            hostel: selectedHostel
          });

          if (!room) return res.send("Room not found");

          res.render("showPage/rooms/Edit-Room.ejs", { room, user });
        });

        /////////////////////// UPDATE ROOM ///////////////////////
        router.put("/manageroom/:id", jwtAuthMiddleware, attachHostel, async (req, res) => {
          try {
            const { id } = req.params;

            const room = await Room.findById(id);

            // Remove old beds
            await Floor.findByIdAndUpdate(room.floor_id, {
              $inc: { total_beds: -room.sharing_capacity }
            });

            const { room_fees, sharing_capacity } = req.body.room;

            // Add new beds
            await Floor.findByIdAndUpdate(room.floor_id, {
              $inc: { total_beds: sharing_capacity }
            });

            await Room.findByIdAndUpdate(id, {
              room_fees,
              sharing_capacity
            });

            res.redirect("/user/managerooms");

          } catch (error) {
            // console.error(error);
            res.status(500).send("Update failed");
          }
        });

        /////////////////////// DELETE ROOM ///////////////////////
        router.delete("/managerooms/:id", jwtAuthMiddleware, attachHostel, async (req, res) => {
          try {
            const room = await Room.findById(req.params.id);

            await Room.findByIdAndDelete(req.params.id);

            await Floor.findByIdAndUpdate(room.floor_id, {
              $inc: {
                total_rooms: -1,
                occupied_beds: -room.occupied_beds,
                total_beds: -room.sharing_capacity,
                active_number: -room.occupied_beds
              }
            });

            if (room.sharing_capacity === room.occupied_beds) {
              await Floor.findByIdAndUpdate(room.floor_id, {
                $inc: { occupied_rooms: -1 }
              });
            }

            res.redirect("/user/managerooms");

          } catch (error) {
            // console.error(error);
            res.status(500).send("Delete failed");
          }
        });
            
            
      // MEMBERS //////////////////////////////////////////////////////////////////////////////////////////////////

// View all Members
router.get("/members", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await Owner.findById(userId);

    const selectedHostel = res.locals.selectedHostel?._id;
    if (!selectedHostel) {
      return res.send("⚠️ Please select a hostel first");
    }

    const members = await Member.find({
      user: userId,
      hostel: selectedHostel
    }).populate("payments");

    res.render("showPage/memberData/Allmember.ejs", {
      allMembers: members,
      user
    });

  } catch (err) {
    // console.error("Error loading members:", err);
    res.status(500).send("Server Error");
  }
});


// MEMBER EDIT PAGE
router.get("/member-edit/:id/edit", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await Owner.findById(userId);
    const selectedHostel = res.locals.selectedHostel?._id;

    if (!selectedHostel) {
      return res.send("⚠️ Please select a hostel first");
    }

    const { id } = req.params;

    const rooms = await Room.find({
      user: userId,
      hostel: selectedHostel
    });

    const member = await Member.findById(id).populate("payments");

    if (!member) {
      return res.status(404).send("Member not found");
    }

    res.render("showPage/memberData/Edit-Allmember.ejs", {
      allMembers: member,
      rooms,
      user
    });

  } catch (error) {
    // console.error("❌ Error loading member edit page:", error);
    res.status(500).send("Server Error");
  }
});


// UPDATE MEMBER
router.put("/member-edit/:id", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const { id } = req.params;

    const updatedMember = await Member.findByIdAndUpdate(
      id,
      { ...req.body.member },
      { new: true }
    );

    if (!updatedMember) {
      return res.status(404).send("Member not found");
    }

    res.redirect("/user/members");

  } catch (error) {
    // console.error("❌ Error updating member:", error);
    res.status(500).send("Server Error");
  }
});


// DELETE MEMBER
router.delete("/member/:id", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const { id } = req.params;

    const member = await Member.findById(id);
    if (!member) return res.status(404).send("Member not found");

    await Member.findByIdAndDelete(id);

    const room = await Room.findById(member.assignedRoom_id);
    if (room) {
      await Room.findByIdAndUpdate(member.assignedRoom_id, {
        $inc: { occupied_beds: -1 }
      });

      await Floor.findByIdAndUpdate(room.floor_id, {
        $inc: { active_number: -1, occupied_beds: -1 }
      });
    }

    res.redirect("/user/members");

  } catch (error) {
    // console.error("❌ Error deleting member:", error);
    res.status(500).send("Server Error");
  }
});


// ACTIVE MEMBERS
router.get("/activeMember", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await Owner.findById(userId);

    const selectedHostel = res.locals.selectedHostel?._id;
    if (!selectedHostel) {
      return res.send("⚠️ Please select a hostel first");
    }

    const allMembers = await Member.find({
      user: userId,
      hostel: selectedHostel
    });

    res.render("showPage/memberData/activeMember.ejs", { allMembers, user });

  } catch (err) {
    // console.error(err);
    res.status(500).send("Server Error");
  }
});


// MAKE MEMBER INACTIVE
router.get("/activeMember/:id", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const { id } = req.params;

    const member = await Member.findById(id);
    if (!member) return res.status(404).send("Member not found");

    member.status = "Inactive";
    member.leftDate = new Date();
    await member.save();

    const room = await Room.findById(member.assignedRoom_id);
    if (room) {
      await Room.findByIdAndUpdate(member.assignedRoom_id, {
        $inc: { occupied_beds: -1 }
      });

      await Floor.findByIdAndUpdate(room.floor_id, {
        $inc: { active_number: -1, occupied_beds: -1 }
      });
    }

    res.redirect("/user/members");

  } catch (error) {
    // console.error(error);
    res.status(500).send("Server Error");
  }
});


// NEW MEMBER PAGE
router.get("/newmember", jwtAuthMiddleware, attachHostel, async (req, res) => {
  const userId = req.user.id;
  const user = await Owner.findById(userId);

  const selectedHostel = res.locals.selectedHostel?._id;

  const rooms = await Room.find({
    user: userId,
    hostel: selectedHostel
  });
  

  const floors = await Floor.find({
    user: userId,
    hostel: selectedHostel
  });

  res.render("showPage/memberData/newmember.ejs", { rooms, floors, user });
});


// CREATE MEMBER
router.post("/newMember", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id;
    const selectedHostel = res.locals.selectedHostel?._id;

    const {
      assignedRoom_id,
      name,
      fatherName,
      mobileNo,
      aadharNo,
      address,
      profession,
      joiningDate
    } = req.body.member;

    const room = await Room.findById(assignedRoom_id);
    if (!room) return res.status(404).send("Room not found");

    if (room.sharing_capacity === room.occupied_beds) {
      return res.send("Room is full ❌");
    }

    const newMember = new Member({
      user: userId,
      hostel: selectedHostel,
      assignedRoom_id,
      name,
      fatherName,
      mobileNo,
      aadharNo,
      address,
      profession,
      joiningDate,
      assignedRoom: room.room_number,
      status: "Inactive"
    });

    const newPayment = new Payment({
      memberId: newMember._id,
      roomId: assignedRoom_id,
      roomFees: room.room_fees
    });

    await newPayment.save();
    newMember.payments.push(newPayment._id);
    await newMember.save();

    await Room.findByIdAndUpdate(assignedRoom_id, {
      $inc: { occupied_beds: 1 }
    });

    await Floor.findByIdAndUpdate(room.floor_id, {
      $inc: { active_number: 1, occupied_beds: 1 }
    });

    res.redirect("/user/newAdded/successfully");

  } catch (error) {
    // console.error("❌ Error saving member:", error);
    res.status(500).send("Error saving member");
  }
});


// SUCCESS PAGE ✅ FIXED SPELLING
router.get("/newAdded/successfully", jwtAuthMiddleware, attachHostel, async (req, res) => {
  const userId = req.user.id;
  const user = await Owner.findById(userId);

  res.render("showPage/memberData/newmemberADDED.ejs", { user });
});
       


/////////////////PAYMENTS//////////////////
   /////////////////////////////////////////////////////////////////
   
   
   // ADD PAYMENT TO PARTICULAR MEMBER                         
   router.get("/members/:id/addpayment",jwtAuthMiddleware, attachHostel, async (req, res) => {
     const {id} = req.params;
     
     const userId = req.user.id; // This is your user ID from the token
     const selectedHostel = res.locals.selectedHostel?._id;

     const user= await Owner.findById(userId)

     try {
       const member = await Member.findById(id).populate('payments');
       if (!member) return res.status(404).send("Error: Member not found.");
       // ✅ Calculate total fee
   
       const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);
   
       // Sum of all amountPaid from payments
       
       const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

       // Calculate dueAmount based on totalFees
       const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;
 
       // const totalFee = member.payments.reduce((sum,payment) => sum + payment.totalFees, 0)
       res.render("payments/addpayment.ejs", {member,dueAmount,user});
     } catch (err){
       // console.error("Error fetching member:", err);
       res.status(500).send("Server Error");
     }
   });
   //ADD PAYMENT ENTRY /////////////////////////////////////////////////////
   router.post("/addpayment/:id",jwtAuthMiddleware, attachHostel, async (req, res) => {
    
    const userId = req.user.id; // This is your user ID from the token
    const user= await Owner.findById(userId)
   
    
    const { id } = req.params;
     const { amountPaid, paymentMode, paymentDate } = req.body.payment;
   
     try {
       const member = await Member.findById(id);
       if (!member){
         return res.status(404).send("Member not found.");
       }
       const newPayment = new Payment({
         memberId: id,
         amountPaid,
         paymentMode,
         paymentDate,
       });
   
       const savedPayment = await newPayment.save();
   
       member.payments.push(savedPayment._id);
       member.status = "Active";
       member.leftDate ="";
       await member.save();
       // ✅ Instead of rendering, redirect to the GET receipt route
       res.redirect(`/user/payment-receipt/${savedPayment._id}`);
     } catch (error) {
       // console.error("Error adding payment:", error);
       res.status(500).send("Internal Server Error");
     }
   });


   router.get("/payment-receipt/:paymentId",jwtAuthMiddleware, attachHostel, async (req, res) => {
     const { paymentId } = req.params;
   
     const userId = req.user.id; // This is your user ID from the token
     const user= await Owner.findById(userId)
   
     try {
       const payment = await Payment.findById(paymentId);
       if (!payment) {
         return res.status(404).send("Payment not found.");
       }
   
       const member = await Member.findById(payment.memberId);
       if (!member) {
         return res.status(404).send("Member not found.");
       }
   
       // ✅ Render Payment Receipt Page from GET Route
       res.render("payments/paymentreciept.ejs", {
         member,
         payment,
         user
       });
     } catch (error) {
       // console.error("Error loading payment receipt:", error);
       res.status(500).send("Internal Server Error");
     }
   });
   
   // SEARCH MEMBER /////////////////////////////////////////////////////////////////////////
   
   // Route to handle search by mobile or name
   router.post("/member/search",jwtAuthMiddleware, attachHostel, async (req, res) => {
     try {
       let searchQuery = req.body.name; // Taking input from request
    
       const userId = req.user.id; // This is your user ID from the token
       const user= await Owner.findById(userId)
       
       //✅ Search by name or mobile number + filter by user ID
       const members = await Member.find({
         user: userId,
         $or: [
           { name: { $regex: searchQuery, $options: "i" } }, // Search by Name (Case-insensitive)
           { mobileNo: searchQuery } // Search by Mobile Number (Exact Match)
         ]
       }).populate('payments');
     
       // If no matching member is found
       if (members.length === 0) {
         return res.render("showPage/memberData/searchedNotFoundMember.ejs", { user: user,
           errorMessage: "Member NOT FOUND" 
         });
       }
   
       // If member(s) found, render the search results page
       res.render("showPage/memberData/searchedMember.ejs", { allMembers: members ,user});
   
     } catch (error) {
       // console.error("Error searching for member:", error);
   
       if (error.code === 11000) {
         res.status(400).send("Error: Duplicate entry detected. Please ensure unique values for unique fields.");
       } else if (error.name === "ValidationError") {
         res.status(400).send("Validation Error: " + error.message);
       } else {
         res.status(500).send("An unexpected error occurred. Please try again later.");
       }
     }
   });
     
   // PAYMENT STRUCTURE
   
   // SHOW ALL FEES RECORDR TO allrecords.ejs
 router.get("/allfeesrecords", jwtAuthMiddleware, attachHostel, async (req, res) => {
     try {
        
        const userId = req.user.id; // This is your user ID from the token
        const user= await Owner.findById(userId)
        const selectedHostel = res.locals.selectedHostel?._id;

        if (!selectedHostel) {
          return res.send("⚠️ Please select a hostel first");
        }
            // ✅ Fetch members securely
        const allMembers = await Member.find({
          user: userId,
          hostel: selectedHostel
        })
          .populate("payments")
          .sort({ createdAt: -1 }); // latest first
      
       const membersWithFees = allMembers.map((member) => {
         // Sum of all roomFees from payments
         const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);
   
         // Sum of all amountPaid from payments
         const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);
   
         // Calculate dueAmount based on totalFees
         const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;
         const advancedPaid = amountPaid > totalFees ? amountPaid - totalFees : 0;
   
         return {
           ...member.toObject(),
           totalFees,
           advancedPaid,
           amountPaid,
           dueAmount,
         };
       });
       
       res.render("payments/allrecords.ejs", { allMembers: membersWithFees ,user});
     } catch (err) {
       // console.error("Error fetching records:", err);
       res.status(500).send("Internal Server Error");
     }
   });
   
   // search fees record of member
   // SEARCH FEES RECORDS BASED ON MEMBER NAME OR MOBILE NUMBER
 router.post("/searchfeesrecords",jwtAuthMiddleware, attachHostel, async (req, res) =>{
     try {
         
        const userId = req.user.id; // This is your user ID from the token
        const user= await Owner.findById(userId)
      
       const searchQuery = req.body.searchQuery; // input from form (name or mobile number)
       const filteredMembers = await Member.find({ 
        user: req.user.id, // Filter by userId
        $or: [
          { name: { $regex: searchQuery, $options: "i" } }, // Case-insensitive name search
          { mobileNo: searchQuery } // Exact match for mobile number
        ]
      }).populate("payments");
      
       const membersWithFees = filteredMembers.map((member) => {
         // Calculate totalFees (sum of roomFees)
         const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);
   
         // Calculate amountPaid (sum of amountPaid)
         const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);
   
         // Calculate dueAmount and advancedPaid
         const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;
         const advancedPaid = amountPaid > totalFees ? amountPaid - totalFees : 0;
   
         return {
           ...member.toObject(),
           totalFees,
           advancedPaid,
           amountPaid,
           dueAmount,
         };
       });
   
       if (membersWithFees.length === 0) {
         return res.render("payments/allrecordsNotFound.ejs", {
           allMembers: [],
           errorMessage: "No records found for the search query.",
           user,
         });
       }
   
       res.render("payments/allrecords.ejs", {
         allMembers: membersWithFees,
         errorMessage: null,
         user
       });
     } catch (err) {
       // console.error("Error searching fee records:", err);
       res.status(500).send("Internal Server Error");
     }
   });
   
   
   /////////////////////////////////////////////////////////////////////////////
   ////////////////////////////////////////////////////////////////////////////////////////////
   router.get('/payment-history/:memberId',jwtAuthMiddleware, attachHostel, async (req, res) => {
     const memberId = req.params.memberId;
     
     const userId = req.user.id; // This is your user ID from the token
     const user= await Owner.findById(userId)

     
     try {
       const member = await Member.findById(memberId);
       const payments = await Payment.find({ memberId }).sort({ paymentDate: -1 });
       res.render('payments/PaymentHistoryOfOne.ejs', { member, payments ,user});
     } catch (err) {
       // console.error(err);
       res.status(500).send('Server Error');
     }
   });
   
    
   
   // ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
   // UPCOMING PAYMENTS///////////////////
router.get("/upcomingPayments",jwtAuthMiddleware, attachHostel, async (req, res) => {
     try {
          
     const userId = req.user.id; // This is your user ID from the token
     const user= await Owner.findById(userId)
    
        const selectedHostel = res.locals.selectedHostel?._id;

        if (!selectedHostel) {
          return res.send("⚠️ Please select a hostel first");
        }
       const today = new Date();
       const upcomingDays = [];
   
       // Generate day numbers for the next 5 days
       for (let i = 0; i <= 5; i++) {
         const date = new Date(today);
         date.setDate(today.getDate() + i);
         upcomingDays.push(date.getDate());
       }
        
       const members = await Member.find({user:userId, hostel: selectedHostel}).populate('payments');
   
       // Filter members whose joining day matches any of the upcoming days
       const upcomingPayments = members.filter(member => {
         const joiningDay = new Date(member.joiningDate).getDate();
         return upcomingDays.includes(joiningDay);
       });
   
       res.render("payments/upcomingPayments.ejs", { allMembers: upcomingPayments ,user});
     } catch (err) {
       // console.error("Error fetching upcoming payments:", err);
       res.status(500).send("Internal Server Error");
     }
   });
   
   //SHOW DUE AMOUNT//////////////////////////////////////
   router.get("/deureports",jwtAuthMiddleware,  attachHostel, async(req,res)=>{
    
   try {
      
    const userId = req.user.id; // This is your user ID from the token
    const user= await Owner.findById(userId)

    const selectedHostel = res.locals.selectedHostel?._id;

    if (!selectedHostel) {
      return res.send("⚠️ Please select a hostel first");
    } 
     const allMembers = await Member.find({user:userId, hostel: selectedHostel})
       .populate("payments") // Populate payment details
       .exec();
   
     const membersWithFees = allMembers.map((member) => {
       // Sum of all roomFees from payments
       const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);
   
       // Sum of all amountPaid from payments
       const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);
   
       // Calculate dueAmount based on totalFees
       const dueAmount = amountPaid >= totalFees ? 0 : totalFees - amountPaid;
       const advancedPaid = amountPaid > totalFees ? amountPaid - totalFees : 0;

       return {
         ...member.toObject(),
         totalFees,
         advancedPaid,
         amountPaid,
         dueAmount,
       };
     });
   
     res.render("payments/duesReport.ejs", { allMembers: membersWithFees,user });
   } catch (err) {
     // console.error("Error fetching records:", err);
     res.status(500).send("Internal Server Error");
   }
   })
   
//Revenue///////////////////////////////////////const express = require('express');
      
// =================== REVENUE ROUTE ===================
router.get("/revenue", jwtAuthMiddleware, attachHostel, async (req, res) =>{
    try {
        const userId = req.user.id;
        const user = await Owner.findById(userId);
        const selectedHostel = res.locals.selectedHostel?._id;
        if (!selectedHostel) {
            return res.send("⚠️ Please select a hostel first");   
        }
       // ✅ Step 1: Find all members associated with the logged-in user
        const allMembers = await Member.find({ user: userId, hostel: selectedHostel  })
            .populate("payments")
            .exec();
        // ✅ Handle case if no members exist
        if (allMembers.length === 0) {
            return res.render("payments/revenue", {
                totalExpectedRevenue: 0,
                totalFeesCollected: 0,
                totalPendingAmount: 0,
                totalAdvancedPaid: 0,
                balance: 0,
                paidAccounts: 0,
                dueAccounts: 0,
                feesCollectionCompleted: 0,
                user
            });
        }
        // ✅ Step 2: Calculate revenue data dynamically from payments
        const membersWithFees = allMembers.map((member) => {
            // ✅ Calculate Total Fees (Room Fees)
            const totalFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);

            // ✅ Calculate Total Amount Paid
            const amountPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

            // ✅ Calculate Due Amount (if amount paid < total fees)
            const dueAmount = totalFees - amountPaid;

            // ✅ Calculate Advanced Paid (if amount paid > total fees)
            const advancedPaid = amountPaid > totalFees ? amountPaid - totalFees : 0;
            return {
                totalFees,
                amountPaid,
                dueAmount,
                advancedPaid
            };
        });

        // ✅ Step 3: Calculate Overall Revenue Data
        const totalExpectedRevenue = membersWithFees.reduce((sum, member) => sum + member.totalFees, 0);
        const totalFeesCollected = membersWithFees.reduce((sum, member) => sum + member.amountPaid, 0);
        const totalPendingAmount = membersWithFees.reduce((sum, member) => sum + member.dueAmount, 0);
        const totalAdvancedPaid = membersWithFees.reduce((sum, member) => sum + member.advancedPaid, 0);
        // ✅ Calculate Balance (Expected - Collected)
        const balance = totalExpectedRevenue - totalFeesCollected;

        // ✅ Calculate Collection Percentage
        let feesCollectionCompleted = totalExpectedRevenue > 0
            ? ((totalFeesCollected / totalExpectedRevenue) * 100).toFixed(2)
            : 0;
        // ✅ Count Paid & Due Accounts
        let paidAccounts = 0;
        let dueAccounts = 0;
        allMembers.forEach(member => {
            const totalMemberFees = member.payments.reduce((sum, payment) => sum + (payment.roomFees || 0), 0);
            const totalMemberPaid = member.payments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

            if (totalMemberPaid >= totalMemberFees) {
                paidAccounts++;
            } else {
                dueAccounts++;
            }
        });

        // ✅ Format Numbers in Indian Currency without Decimal (.00)
        const formatCurrency = (amount) => {
            return new Intl.NumberFormat("en-IN", {
                minimumFractionDigits: 0,   // ✅ Removed .00 (No decimal)
                maximumFractionDigits: 0    // ✅ Removed .00 (No decimal)
            }).format(amount);
        };

        // ✅ Step 8: Render the Revenue Page
        res.render("payments/revenue", {
            totalExpectedRevenue: formatCurrency(totalExpectedRevenue),
            totalFeesCollected: formatCurrency(totalFeesCollected),
            totalPendingAmount: formatCurrency(totalPendingAmount),
            totalAdvancedPaid: formatCurrency(totalAdvancedPaid),
            balance: formatCurrency(balance),
            paidAccounts,
            dueAccounts,
            feesCollectionCompleted,
            user
        });

    } catch (error) {
        // console.log("Error in Revenue Route:", error);
        res.status(500).send("Server Error");
    }
});


//////////////////////////////////////////////////////////
// 🔐 FORGOT PASSWORD PAGE
//////////////////////////////////////////////////////////
router.get("/forgot-password", (req, res) => {
  res.render("authPrivate/forgotPassword.ejs");
});

//////////////////////////////////////////////////////////
// 📩 SEND RESET LINK
//////////////////////////////////////////////////////////
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.render("authPrivate/forgotPassword.ejs", {
        error: "Please enter your email"
      });
    }

    const user = await Owner.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.render("authPrivate/forgotPassword.ejs", {
        error: "Email not found"
      });
    }

    // 🔐 Generate Token
    const token = crypto.randomBytes(32).toString("hex");

    // ✅ FIXED (IMPORTANT)
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);

    await user.save();

    const resetLink = `https://hostelnode.com/user/reset-password/${token}`;

   await sendMail(
  user.email,
  "Reset Your Password - HostelNode",
  `
  <div style="font-family:Arial;padding:20px">
    <h2>🔐 Reset Your Password</h2>
    <p>Hello ${user.name},</p>
    <p>Click the button below to reset your password:</p>

    <a href="${resetLink}" 
       style="display:inline-block;padding:12px 20px;
       background:#09B850;color:white;text-decoration:none;
       border-radius:8px;font-weight:bold;">
       Reset Password
    </a>

    <p style="margin-top:15px;color:#555;">
      This link will expire in 15 minutes.
    </p>

    <p>If you didn’t request this, ignore this email.</p>
  </div>
  `
);
    // console.log("⏳ Expires at:", user.resetPasswordExpires);
    res.render("authPrivate/forgotPassword.ejs", {
      message: "Reset Link sent to your Email Check your inbox!"
    });

  } catch (err) {
    // console.error("Forgot Password Error:", err);
    res.status(500).send("Server Error");
  }
}); 
//////////////////////////////////////////////////////////
// 🔑 RESET PASSWORD PAGE (VERIFY TOKEN)
//////////////////////////////////////////////////////////
router.get("/reset-password/:token", async (req, res) => {
  try {
    // console.log("Incoming token:", req.params.token);

    const user = await Owner.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: new Date() } // ✅ FIXED
    });

    // console.log("User found:", user ? "YES" : "NO");

    if (!user) {
      return res.send("❌ Token expired or invalid");
    }

    res.render("authPrivate/resetPassword.ejs", {
      token: req.params.token
    });

  } catch (err) {
    // console.error("Reset GET Error:", err);
    res.status(500).send("Server Error");
  }
});

//////////////////////////////////////////////////////////
// 🔁 UPDATE PASSWORD
//////////////////////////////////////////////////////////
router.post("/reset-password/:token", async (req, res) => {
  try {
          const { password, confirmPassword } = req.body; 
           // ✅ 🔥 ADD THIS HERE (IMPORTANT)
    if (password !== confirmPassword) {
      return res.render("authPrivate/resetPassword.ejs", {
        error: "Passwords do not match ❌",
        token: req.params.token
      });
    }
 
    if (!password) {
      return res.send("Password is required");
    }

    const user = await Owner.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: new Date() } // ✅ FIXED
    });

    if (!user) {
      return res.send("❌ Token expired or invalid");
    }

    // 🔐 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Update user
    user.password = hashedPassword;

    // ❌ Remove token after use
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();
await user.save();

    // 📩 SEND CONFIRMATION EMAIL (ADD HERE)
    await sendMail(
      user.email,
      "✅ Password Changed - HostelNode",
      `
      <div style="font-family:Arial;padding:20px">
        <h2 style="color:#09B850;">Password Updated Successfully ✅</h2>

        <p>Hello ${user.name},</p>

        <p>Your HostelNode account password has been successfully changed.</p>

        <p style="color:#555;">
          If this was you, no action is needed.
        </p>

        <p style="color:red;font-weight:bold;">
          ⚠️ If you did NOT change your password, please contact support immediately.
        </p>

        <hr style="margin:20px 0;">

        <p style="font-size:12px;color:#888;">
          This is an automated message from HostelNode Security System.
        </p>
      </div>
      `
    );

    // console.log("📧 Confirmation email sent");

    res.redirect("/login");
        // console.log("✅ Password reset successful");
 

  } catch (err) {
    // console.error("Reset POST Error:", err);
    res.status(500).send("Error resetting password");
  }
});
const nodemailer = require("nodemailer");

const sendMail = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "hostelnodehelp@gmail.com",       // 🔥 your Gmail
        pass: "sxiwxzxbdujxiyra"           // 🔥 App Password
      }
    });

    const mailOptions = {
      from: `"HostelNode" <hostelnodehelp@gmail.com>`,
      to,
      subject,
      html
    };

    await transporter.sendMail(mailOptions);

    // console.log("📧 Email sent successfully");

  } catch (error) {
    // console.error("❌ Email Error:", error);
  }
};

module.exports = sendMail;

/////Log Out//////route
    router.get("/logout",jwtAuthMiddleware,(req, res) => {
        res.clearCookie("token"); // Clear the JWT token from cookies
        res.redirect("/login");   // Redirect to login page
      });

router.post("/send-otp", async (req, res) => {
   try {
    const { phone } = req.body;

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return res.json({ success: false, error: "Invalid phone" });
    }

    // 🔍 Check existing user
    const existingUser = await Owner.findOne({ phone });
    if (existingUser) {
      return res.json({ success: false, error: "Phone already registered ❌" });
    }

    // 🔢 Generate OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // 🧠 Store OTP
    otpStore.set(phone, {
      otp,
      expires: Date.now() + 5 * 60 * 1000
    });

    // 📲 SEND WHATSAPP OTP
   const result = await sendWhatsAppOTP(phone, otp);

if (!result.success) {
  return res.json({
    success: false,
    error: result.error
  });
}

res.json({ success: true });

  } catch (err) {
    // console.error(err);
    res.json({ success: false, error: "Failed to send OTP" });
  }
});
// 🔐 VERIFY OTP
router.post("/verify-otp", (req, res) => {
  const { phone, otp } = req.body;
  const data = otpStore.get(phone);

  if (!data) {
    return res.json({ success: false, error: "OTP not found" });
  }

  if (Date.now() > data.expires) {
    otpStore.delete(phone);
    return res.json({ success: false, error: "OTP expired" });
  }

  if (data.otp !== otp) {
    return res.json({ success: false, error: "Invalid OTP" });
  }

  // ✅ MARK VERIFIED
  data.verified = true;
  otpStore.set(phone, data);

  res.json({ success: true });
});

// List Your Property Page---start--------------------------------------------





// 🏠 LIST PROPERTY PAGE
router.get("/list-property", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await Owner.findById(userId);

    const hostels = await Hostel.find({ owner: userId });

    res.status(200).render("listings/listproperty.ejs", {
      user,
      hostels,
      selectedHostel: res.locals.selectedHostel
    });


  } catch (err) {
    // console.error("❌ Error loading list property page:", err);
    res.status(500).send("Server Error");
  }
});

// ✅ Multer config for listing images (separate from profile images)
const listingStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const listingUploadDir = '/secure_uploads/listings';
    // const listingUploadDir = '/app/secure_uploads/listings';
    if (!fs.existsSync(listingUploadDir)) {
      fs.mkdirSync(listingUploadDir, { recursive: true });
    }
    cb(null, listingUploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const listingUpload = multer({
  storage: listingStorage,
  fileFilter,           // reuse the same image-only filter you already have
  limits: { fileSize: 100 * 1024 * 1024 }  // 100MB per photo
});

// 🏠 POST /list-property  →  save listing to DB
router.post(
  "/new-list-property",
  jwtAuthMiddleware,
  attachHostel,
  listingUpload.array("images", 15),   // up to 15 photos
  async (req, res) => {
    try {
      // console.log("\n🏠 ===== CREATE LISTING START =====");

      const userId = req.user.id;

      // ── 1. PULL FIELDS FROM BODY ──────────────────────────────────────
      const {
        title,
        description,
        propertyType,
        gender,
        startingPrice,
        deposit,
        capacity,
        amenities,   // array of strings  e.g. ["WiFi","Meals"]
        rules,       // array of strings
      } = req.body;

      // location is a nested object from the form:  location[city] etc.
      const location = {
        address:     req.body["location[address]"]     || req.body.location?.address,
        city:        req.body["location[city]"]        || req.body.location?.city,
        state:       req.body["location[state]"]       || req.body.location?.state,
        country:     req.body["location[country]"]     || req.body.location?.country     || "India",
        pincode:     req.body["location[pincode]"]     || req.body.location?.pincode,
        nearCollege: req.body["location[nearCollege]"] || req.body.location?.nearCollege,
        coordinates: {
          lat: parseFloat(req.body["location[coordinates][lat]"] || req.body.location?.coordinates?.lat) || null,
          lng: parseFloat(req.body["location[coordinates][lng]"] || req.body.location?.coordinates?.lng) || null,
        }
      };

      // contact nested fields
      const contact = {
        phone:    req.body["contact[phone]"]    || req.body.contact?.phone,
        whatsapp: req.body["contact[whatsapp]"] || req.body.contact?.whatsapp,
      };

      // rooms[]  — express-compatible nested array parsing
      // req.body.rooms is an object like { '0': {type,price,...}, '1': {...} }
      const rawRooms = req.body.rooms || {};
      const rooms = Object.values(rawRooms).map(r => ({
        type:      r.type,
        price:     Number(r.price)   || 0,
        deposit:   Number(r.deposit) || 0,
        features:  Array.isArray(r.features) ? r.features : (r.features ? [r.features] : []),
        available: r.available === "true" || r.available === true
      })).filter(r => r.type);   // drop empty entries

      // ── 2. BASIC VALIDATION ───────────────────────────────────────────
      if (!title || !gender || !startingPrice || !location.address || !location.nearCollege || !contact.phone) {
        // console.log("❌ Missing required fields");
        return res.status(400).send("All required fields must be filled.");
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).send("Please upload at least one photo.");
      }

      // ── 3. BUILD IMAGE FILENAME ARRAY ─────────────────────────────────
      const images = req.files.map(f => f.filename);

      // ── 4. BUILD & SAVE LISTING ───────────────────────────────────────
      const newListing = new Listing({
        owner:        userId,
        title:        title.trim(),
        description:  description?.trim(),
        propertyType: propertyType || "Hostel",
        gender,
        startingPrice: Number(startingPrice),
        deposit:       Number(deposit) || 0,
        capacity:      Number(capacity) || undefined,
        location,
        rooms, 
        images,
        amenities: Array.isArray(amenities) ? amenities : (amenities ? [amenities] : []),
        rules:     Array.isArray(rules)     ? rules     : (rules     ? [rules]     : []),
        contact,
        status: "Approved"   // always starts as Approved for admin review
      });

      await newListing.save();
      // console.log("✅ Listing saved:", newListing._id);
      const user = await Owner.findById(userId);
      // console.log("🎉 ===== LISTING CREATED SUCCESS =====\n");
      await sendMail(
  user.email,
  "🏠 Your Listing is Created - HostelNode",
  `
  <div style="font-family:'DM Sans',Arial,sans-serif;background:#f4f5f7;padding:30px">

    <div style="max-width:620px;margin:auto;background:#ffffff;
                border-radius:14px;overflow:hidden;
                box-shadow:0 10px 30px rgba(0,0,0,0.08)">

      <!-- HEADER -->
      <div style="background:#09B850;padding:20px 25px;color:white">
        <h2 style="margin:0;font-size:20px;font-weight:800">
          🏠 Listing Created Successfully
        </h2>
        <p style="margin:5px 0 0;font-size:13px;opacity:.9">
          Your property is now submitted for review
        </p>
      </div>

      <!-- BODY -->
      <div style="padding:25px">

        <p style="font-size:14px;color:#0f1117">
          Hi <b>${user.name}</b>,
        </p>

        <p style="font-size:14px;color:#3a3d47">
          🎉 Your listing has been successfully created on <b>HostelNode</b>.
        </p>

        <!-- LISTING CARD -->
        <div style="border:1px solid #e2e4ea;
                    border-radius:12px;
                    padding:15px;
                    margin:20px 0;
                    background:#fafafa">

          <h3 style="margin:0 0 6px;font-size:16px;color:#0f1117">
            ${newListing.title}
          </h3>

          <p style="margin:0;font-size:13px;color:#7c8090">
            📍 ${newListing.location.city}, ${newListing.location.state}
          </p>

          <p style="margin:8px 0 0;font-size:14px;font-weight:700;color:#09B850">
            ₹${newListing.startingPrice}/month
          </p>

          <span style="display:inline-block;
                       margin-top:10px;
                       padding:4px 10px;
                       font-size:11px;
                       font-weight:700;
                       border-radius:20px;
                       background:#FFF3CD;
                       color:#856404">
            ⏳ Pending Approval
          </span>
        </div>

        <!-- INFO -->
        <p style="font-size:13px;color:#555;line-height:1.6">
          Your listing is currently under review by our team.  
          Once approved, it will be visible to users and start receiving enquiries.
        </p>

        <!-- BUTTON -->
        <div style="margin:25px 0;text-align:center">
          <a href="http://localhost:6060/user/my-listings"
            style="display:inline-block;
                   padding:12px 20px;
                   background:#09B850;
                   color:white;
                   text-decoration:none;
                   border-radius:10px;
                   font-size:14px;
                   font-weight:600">
            📊 View My Listings
          </a>
        </div>

        <hr style="margin:20px 0;border:none;border-top:1px solid #e2e4ea">

        <p style="font-size:12px;color:#888;text-align:center">
          HostelNode • Smart Hostel Management Platform
        </p>

      </div>
    </div>
  </div>
  `
);
      // ── 5. RESPOND ────────────────────────────────────────────────────
      // You can redirect to a success page or render one
      res.status(201).render("listings/listingSuccess.ejs", {
        user:    await Owner.findById(userId),
        listing: newListing
      });

    } catch (err) {
      // console.error("❌ Error creating listing:", err);

      if (err.name === "ValidationError") {
        return res.status(400).send("Validation Error: " + err.message);
      }

      res.status(500).send("Server Error. Please try again.");
    }
  }
);
  
  

router.get("/my-listings", jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    // const userId = req.user.id;
    const user   = await Owner.findById(req.user.id);

    // 1. Get all listings
    const listings = await Listing.find({ owner: req.user.id })
      .sort({ createdAt: -1 });

    const listingIds = listings.map(l => l._id);

    // 2. Get all enquiries related to these listings
    const enquiries = await Enquiry.find({
      listing: { $in: listingIds }
    })
    .populate("student", "firstName lastName phone profileImage") // only pull necessary student fields
    .sort({ createdAt: -1 });

    // 3. Attach enquiries to each listing (MATCH YOUR EJS)
    const listingsWithData = listings.map(l => {
      const relatedEnquiries = enquiries
        .filter(e => e.listing.toString() === l._id.toString())
        .map(e => ({
          _id: e._id,

          // 👇 match your EJS fields
          name: e.student
            ? `${e.student.firstName} ${e.student.lastName}`
            : "Anonymous",

          phone: e.student?.phone || "",
          roomType: e.roomType,
          moveIn: e.moveIn,
          preferredDate: e.preferredDate,
          contactMethod: e.contactMethod,
          
          message: e.message,
          avatar: e.student?.profileImage || "hello-default-avatar.png",
          createdAt: e.createdAt,

          // 🔥 Important for your badge UI
          seen: e.status !== "New"
        }));

      return {
        ...l.toObject(),

        // 🔥 IMPORTANT → your EJS uses "enquiries"
        enquiries: relatedEnquiries
      };
    });

    // 4. Render
    res.render("listings/myListings.ejs", {
      user,
      listings: listingsWithData,
      selectedHostel: res.locals.selectedHostel
    });

  } catch (err) {
    // console.error("❌ my-listings error:", err);
    res.status(500).send("Server Error");
  }
});

// router.get("/my-listings", jwtAuthMiddleware, attachHostel, async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const user   = await Owner.findById(userId);

//     const listings = await Listing.find({ owner: userId }).sort({ createdAt: -1 });

//     res.render("listings/myListings.ejs", {
//       user,
//       listings,
//       selectedHostel: res.locals.selectedHostel
//     });

//   } catch (err) {
//     // console.error("❌ my-listings error:", err);
//     res.status(500).send("Server Error");
//   }
// });

// DELETE  /user/listing/:id/delete
router.post("/listing/:id/delete", jwtAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId  = req.user.id;

    // Only allow owner to delete their own listing
    const listing = await Listing.findOneAndDelete({ _id: id, owner: userId });

    if (!listing) return res.status(404).send("Listing not found or unauthorized");

    // Delete image files from disk here
    listing.images.forEach(img => {
      const p = path.join('/secure_uploads/listings', img);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });

    res.redirect("/user/my-listings");

  } catch (err) {
    // console.error("❌ Delete listing error:", err);
    res.status(500).send("Server Error");
  }
});
 





// GET edit form
// Only owner can access this route and edit their listing
router.get('/listing/:id/edit', jwtAuthMiddleware, attachHostel, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // find listing (must belong to owner)
    const listing = await Listing.findOne({
      _id: id,
      owner: userId
    });

    if (!listing) {
      return res.status(404).send("Listing not found or unauthorized");
    }

    // user data
    const user = await Owner.findById(userId);

    // IMPORTANT: required for navbar (Option 2 fix)
    const hostels = await Hostel.find({ owner: userId });

    res.render("listings/editListing.ejs", {
      listing,
      user,
      hostels, // ✅ FIXED (was missing)
      selectedHostel: res.locals.selectedHostel // ✅ FIXED typo: electedHostel → selectedHostel
    });

  } catch (err) {
    // console.error("❌ Edit listing error:", err);
    res.status(500).send("Server Error");
  }
});

// POST edit form
router.post(
  '/listing/:id/edit',
  jwtAuthMiddleware,
  listingUpload.array('newImages', 15),
  async (req, res) => {
    try {
      const userId = req.user.id;

      const listing = await Listing.findOne({
        _id: req.params.id,
        owner: userId
      });

      if (!listing) {
        return res.status(404).send('Not found or unauthorized');
      }

      // console.log("✏️ EDIT LISTING START");

      // =========================
      // 1. BASIC FIELDS
      // =========================
      listing.title = req.body.title?.trim() || listing.title;
      listing.description = req.body.description?.trim() || listing.description;
      listing.propertyType = req.body.propertyType || listing.propertyType;
      listing.gender = req.body.gender || listing.gender;
      listing.startingPrice = Number(req.body.startingPrice) || listing.startingPrice;
      listing.deposit = Number(req.body.deposit) || listing.deposit;
      listing.capacity = Number(req.body.capacity) || listing.capacity;

      // =========================
      // 2. LOCATION (100% SAFE FIX)

      // ---------------------------------------------------------------------------------------------------
      // =========================
      if (!listing.location) listing.location = {};
 
      listing.location.address = req.body.location.address ?? listing.location.address;
      listing.location.city = req.body.location.city ?? listing.location.city;
      listing.location.state = req.body.location.state ?? listing.location.state;
      listing.location.country = req.body.location.country ?? listing.location.country ?? "India";
      listing.location.pincode = req.body.location.pincode ?? listing.location.pincode;
      listing.location.nearCollege = req.body.location.nearCollege ?? listing.location.nearCollege;


        // coordinates safe update (IMPORTANT FIX)
        const latRaw = req.body.location.coordinates.lat;
        const lngRaw = req.body.location.coordinates.lng;

        const lat = parseFloat(latRaw);
        const lng = parseFloat(lngRaw);

        // Only update if REAL valid number is provided
        if (latRaw !== undefined && latRaw !== "" && !isNaN(lat)) {
          listing.location.coordinates.lat = lat;
        }

        if (lngRaw !== undefined && lngRaw !== "" && !isNaN(lng)) {
          listing.location.coordinates.lng = lng;
        }
   
      // =========================
      // 3. CONTACT
      // =========================
      if (!listing.contact) listing.contact = {};

      listing.contact.phone =
        req.body.contact.phone ?? listing.contact.phone;

      listing.contact.whatsapp =
        req.body.contact.whatsapp ?? listing.contact.whatsapp;

      // =========================
      // 4. ROOMS
      // =========================
      const rawRooms = req.body.rooms || {};
      listing.rooms = Object.values(rawRooms)
        .map(r => ({
          type: r.type,
          price: Number(r.price) || 0,
          deposit: Number(r.deposit) || 0,
          features: Array.isArray(r.features)
            ? r.features
            : (r.features ? [r.features] : []),
          available: r.available === "true" || r.available === true
        }))
        .filter(r => r.type);

      // =========================
      // 5. AMENITIES + RULES
      // =========================
      listing.amenities = Array.isArray(req.body.amenities)
        ? req.body.amenities
        : req.body.amenities
          ? [req.body.amenities]
          : listing.amenities;

      listing.rules = Array.isArray(req.body.rules)
        ? req.body.rules
        : req.body.rules
          ? [req.body.rules]
          : listing.rules;

      // =========================
      // 6. IMAGES
      // =========================
      if (req.files?.length > 0) {
        const newImages = req.files.map(f => f.filename);
        listing.images = [...(listing.images || []), ...newImages];
      }

      // delete images
      if (req.body.deleteImages) {
        const toDelete = Array.isArray(req.body.deleteImages)
          ? req.body.deleteImages
          : [req.body.deleteImages];

        listing.images = listing.images.filter(img => !toDelete.includes(img));

        toDelete.forEach(img => {
          const p = path.join('/secure_uploads/listings', img);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        });
      }

      // =========================
      // 7. RESET STATUS
      // =========================
      listing.status = "Approved"; // reset to Approved for re-review

      await listing.save();

      // console.log("🧠 FINAL LOCATION SAVED:", listing.location);
      // console.log("✅ EDIT SUCCESS:", listing._id);

      res.redirect("/user/my-listings");

    } catch (err) {
      // console.error("❌ Edit error:", err);
      res.status(500).send("Server Error");
    }
  }
);

/* ============================================================
   DELETE  /user/listing/:listingId/review/:reviewId
   Owner deletes a review from their listing
============================================================ */
router.delete("/listing/:listingId/review/:reviewId", jwtAuthMiddleware, async (req, res) => {
  try {
    const { listingId, reviewId } = req.params;
    const userId = req.user.id;

    const listing = await Listing.findOne({ _id: listingId, owner: userId });
    if (!listing) return res.status(404).json({ success: false, error: "Not found" });

    const before = listing.reviews.length;
    listing.reviews = listing.reviews.filter(r => r._id.toString() !== reviewId);

    if (listing.reviews.length === before) {
      return res.status(404).json({ success: false, error: "Review not found" });
    }

    // Recalculate rating
    if (listing.reviews.length > 0) {
      const total = listing.reviews.reduce((sum, r) => sum + r.rating, 0);
      listing.rating = Math.round((total / listing.reviews.length) * 10) / 10;
    } else {
      listing.rating = 0;
    }
    listing.reviewCount = listing.reviews.length;

    await listing.save();

    res.json({
      success: true,
      newRating: listing.rating,
      newReviewCount: listing.reviewCount
    });

  } catch (err) {
    // console.error("Delete review error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


 











// 🔐 SECURE PROFILE IMAGE ROUTE (FINAL)
router.get('/secure/profile/:filename', jwtAuthMiddleware, (req, res) => {
  try {
    const filename = req.params.filename;

    // ✅ Correct path (matches your Docker setup)
    const filePath = path.join('/secure_uploads/profiles', filename);

    // ❌ If file not found
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("Image not found");
    }

    // ✅ Send image
    res.sendFile(filePath);

  } catch (err) {
    // console.error("Image fetch error:", err);
    res.status(500).send("Server error");
  }
});



      
module.exports = router;