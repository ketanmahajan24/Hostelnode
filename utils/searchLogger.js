/* ============================================================
   utils/searchLogger.js  —  HostelNode Search Analytics Logger
============================================================ */

const SearchLog = require("../models/searchLog");
const Student   = require("../models/studentSchema");

async function logSearch(options = {}) {
  try {
    const {
      req,
      student,
      searchType,
      searchQuery  = "",
      resolvedCity = "",
      resolvedArea = "",
      resultsCount = 0,
      lat = null,
      lng = null
    } = options;

    let studentId    = null;
    let studentName  = null;
    let studentPhone = null;

    // Priority 1: full student object passed in (from route after DB fetch)
    if (student?._id) {
      studentId    = student._id;
      studentName  = `${student.firstName || ""} ${student.lastName || ""}`.trim() || null;
      studentPhone = student.phone || null;
    }
    // Priority 2: JWT payload only — fetch real data from DB
    else if (req.student?.id || req.student?._id) {
      try {
        const id = req.student.id || req.student._id;
        const s  = await Student.findById(id).select("firstName lastName phone");
        if (s) {
          studentId    = s._id;
          studentName  = `${s.firstName || ""} ${s.lastName || ""}`.trim() || null;
          studentPhone = s.phone || null;
        }
      } catch (e) {
        console.error("searchLogger: student DB fetch failed:", e.message);
      }
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
      || req.headers["x-real-ip"]
      || req.socket?.remoteAddress
      || req.ip
      || "";

    const entry = new SearchLog({
      studentId,
      studentName:  studentName  || null,
      studentPhone: studentPhone || null,
      searchQuery:  searchQuery.trim().slice(0, 200),
      searchType,
      resolvedCity: resolvedCity.trim(),
      resolvedArea: resolvedArea.trim(),
      resultsCount,
      ip,
      userAgent: req.headers["user-agent"] || "",
      lat,
      lng,
    });

    // Fire-and-forget — never block the main request
    entry.save().catch(err => console.error("SearchLog save error:", err));

  } catch (err) {
    console.error("searchLogger error:", err);
  }
}

module.exports = { logSearch };