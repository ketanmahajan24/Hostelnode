const jwt = require("jsonwebtoken");

// ================= OWNER AUTH =================
const jwtAuthMiddleware = (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res.redirect("/login");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Owner Token Error:", err);
    return res.redirect("/login");
  }
};

// ================= STUDENT AUTH =================
const jwtStudentAuth = (req, res, next) => {
  const token = req.cookies.studentToken;   // 🔥 DIFFERENT COOKIE

  if (!token) {
    return res.redirect("/student/login");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.student = decoded;   // 🔥 IMPORTANT (req.user nahi)
    next();
  } catch (err) {
    console.error("Student Token Error:", err);
    res.clearCookie("studentToken"); // invalid token remove
    return res.redirect("/student/login");
  }
};

// ================= TOKEN GENERATOR =================
const generateToken = (data) => {
  return jwt.sign(data, process.env.JWT_SECRET, {
    expiresIn: "7d"
  });
};

// // Add to your existing jwtAuth.js
// const jwt = require("jsonwebtoken");

function jwtAdminAuth(req, res, next) {
  const token = req.cookies.adminToken;
  if (!token) return res.redirect("/admin/login");
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "SuperAdmin") return res.redirect("/admin/login");
    req.admin = decoded;
    next();
  } catch {
    res.clearCookie("adminToken");
    return res.redirect("/admin/login");
  }
}

function generateAdminToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });
}
module.exports = {
  jwtAuthMiddleware,
  jwtStudentAuth,
  generateToken,
  jwtAdminAuth,
  generateAdminToken
};