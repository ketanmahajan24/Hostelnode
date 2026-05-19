/* ============================================================
   utils/searchLogger.js  —  HostelNode Search Analytics Logger
   Call this from any route to log a search event
============================================================ */

const SearchLog = require("../models/searchLog");

/**
 * Log a search event
 * @param {object} options
 * @param {object} options.req          - Express request object
 * @param {string} options.searchType   - "text_search"|"nearby_click"|"city_page"|"area_page"|"listing_view"
 * @param {string} options.searchQuery  - Raw search string (e.g. "Indore")
 * @param {string} options.resolvedCity - Normalised city name (e.g. "Mumbai")
 * @param {string} options.resolvedArea - Sub-area if known (e.g. "Nerul")
 * @param {number} options.resultsCount - How many results were returned
 * @param {number} options.lat          - Latitude (for nearby searches)
 * @param {number} options.lng          - Longitude (for nearby searches)
 */
async function logSearch(options = {}) {
  try {
    const { req, searchType, searchQuery = "", resolvedCity = "", resolvedArea = "", resultsCount = 0, lat = null, lng = null } = options;

    // Extract student info if logged in
    let studentId    = null;
    let studentName  = null;
    let studentPhone = null;

    if (req.student) {
      studentId    = req.student._id || null;
      studentName  = `${req.student.firstName || ""} ${req.student.lastName || ""}`.trim();
      studentPhone = req.student.phone || null;
    }

    // Get real IP (works behind proxies like nginx)
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
             || req.headers["x-real-ip"]
             || req.socket?.remoteAddress
             || req.ip
             || "";

    const entry = new SearchLog({
      studentId,
      studentName,
      studentPhone,
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

    // Fire-and-forget: don't block the response
    entry.save().catch(err => console.error("SearchLog save error:", err));

  } catch (err) {
    // Never crash the main request because of logging
    console.error("searchLogger error:", err);
  }
}

module.exports = { logSearch }; 