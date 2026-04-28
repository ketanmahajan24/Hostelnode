const express  = require("express");
const router   = express.Router();
const Visitor  = require("../models/visitor");
const { jwtAdminAuth } = require("../Middlewares/jwtAuth");

/* ============================================================
   GET /admin/visitors
============================================================ */
router.get("/", jwtAdminAuth, async (req, res) => {
  try {
    const Admin = require("../models/admin");
    const admin = await Admin.findById(req.admin.id).select("-password");

    const { range = "7d", route = "all", page = 1 } = req.query;
    const limit = 50;
    const skip  = (page - 1) * limit;

    /* ── Date range ── */
    const now  = new Date();
    const from = new Date();
    if      (range === "1d")  from.setDate(now.getDate() - 1);
    else if (range === "7d")  from.setDate(now.getDate() - 7);
    else if (range === "30d") from.setDate(now.getDate() - 30);
    else if (range === "90d") from.setDate(now.getDate() - 90);
    else                       from.setFullYear(now.getFullYear() - 1);

    const baseFilter = { visitedAt: { $gte: from } };
    if (route !== "all") baseFilter.route = { $regex: route, $options: "i" };

    /* ── Summary stats ── */
    const [totalVisits, uniqueIPs, returningCount, mobileCount, botCount] = await Promise.all([
      Visitor.countDocuments(baseFilter),
      Visitor.distinct("ip", baseFilter).then(a => a.length),
      Visitor.countDocuments({ ...baseFilter, isReturning: true }),
      Visitor.countDocuments({ ...baseFilter, device: "Mobile" }),
      Visitor.countDocuments({ ...baseFilter, device: "Bot" })
    ]);

    /* ── Top routes ── */
    const topRoutes = await Visitor.aggregate([
      { $match: baseFilter },
      { $group: { _id: { route: "$route", label: "$routeLabel" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    /* ── Top cities ── */
    const topCities = await Visitor.aggregate([
      { $match: { ...baseFilter, city: { $ne: null } } },
      { $group: { _id: { city: "$city", country: "$country", lat: "$lat", lng: "$lng" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    /* ── Top countries ── */
    const topCountries = await Visitor.aggregate([
      { $match: { ...baseFilter, country: { $ne: null } } },
      { $group: { _id: "$country", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]);

    /* ── Device breakdown ── */
    const deviceBreakdown = await Visitor.aggregate([
      { $match: baseFilter },
      { $group: { _id: "$device", count: { $sum: 1 } } }
    ]);

    /* ── Hourly visits today ── */
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const hourlyData = await Visitor.aggregate([
      { $match: { visitedAt: { $gte: todayStart } } },
      { $group: { _id: { $hour: "$visitedAt" }, count: { $sum: 1 } } },
      { $sort: { "_id": 1 } }
    ]);

    /* ── Daily trend ── */
    const dailyTrend = await Visitor.aggregate([
      { $match: baseFilter },
      { $group: {
        _id: { y: { $year: "$visitedAt" }, m: { $month: "$visitedAt" }, d: { $dayOfMonth: "$visitedAt" } },
        count:  { $sum: 1 },
        unique: { $addToSet: "$ip" }
      }},
      { $project: { count: 1, uniqueCount: { $size: "$unique" } } },
      { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } }
    ]);

    /* ── Recent visitors ── */
    const [recentVisitors, total] = await Promise.all([
      Visitor.find(baseFilter)
        .sort({ visitedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Visitor.countDocuments(baseFilter)
    ]);

    /* ── ✅ Map pins — prefer GPS over IP location ── */
    const mapPins = await Visitor.aggregate([
      { $match: { ...baseFilter, lat: { $ne: null }, lng: { $ne: null } } },
      { $group: {
        _id:      "$ip",
        // ✅ prefer GPS if available, fallback to IP
        lat:      { $first: { $ifNull: ["$gpsLat", "$lat"] } },
        lng:      { $first: { $ifNull: ["$gpsLng", "$lng"] } },
        city:     { $first: "$city" },
        country:  { $first: "$country" },
        visits:   { $sum: 1 },
        lastSeen: { $max: "$visitedAt" },
        routes:   { $addToSet: "$routeLabel" },
        // ✅ track if GPS or IP
        hasGPS:   { $max: { $cond: [{ $eq: ["$locationSource", "GPS"] }, 1, 0] } }
      }},
      { $sort: { visits: -1 } },
      { $limit: 200 }
    ]);

    /* ── Browser breakdown ── */
    const browserData = await Visitor.aggregate([
      { $match: baseFilter },
      { $group: { _id: { $arrayElemAt: [{ $split: ["$browser", " "] }, 0] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ]);

    /* ── ✅ GPS stats for admin info ── */
    const gpsCount = await Visitor.countDocuments({ ...baseFilter, locationSource: "GPS" });

    res.render("admin/visitors.ejs", {
      admin,
      stats: { totalVisits, uniqueIPs, returningCount, mobileCount, botCount, gpsCount },
      topRoutes,
      topCities,
      topCountries,
      deviceBreakdown,
      hourlyData,
      dailyTrend,
      recentVisitors,
      mapPins,
      browserData,
      total,
      currentPage: +page,
      totalPages:  Math.ceil(total / limit),
      filters: { range, route }
    });

  } catch (err) {
    console.error("Visitors route error:", err);
    res.status(500).send("Server Error");
  }
});

/* ============================================================
   GET /admin/visitors/api/live
============================================================ */
router.get("/api/live", jwtAdminAuth, async (req, res) => {
  try {
    const visitors = await Visitor.find()
      .sort({ visitedAt: -1 })
      .limit(20)
      // ✅ added gpsLat, gpsLng, locationSource
      .select("ip city country lat lng gpsLat gpsLng locationSource route routeLabel device browser visitedAt isReturning userType")
      .lean();
    res.json({ success: true, visitors });
  } catch (err) {
    res.json({ success: false });
  }
});

/* ============================================================
   DELETE /admin/visitors/clear
============================================================ */
router.delete("/clear", jwtAdminAuth, async (req, res) => {
  try {
    const { days = 30 } = req.body;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const result = await Visitor.deleteMany({ visitedAt: { $lt: cutoff } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.json({ success: false, error: "Server error" });
  }
});

module.exports = router;
