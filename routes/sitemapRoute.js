/* ============================================================
   routes/sitemapRoute.js  —  HostelNode SEO Sitemap
   Mount: app.use("/", sitemapRouter)
   
   GET /sitemap.xml   → full sitemap for Google
   GET /robots.txt    → robots file
============================================================ */

const express = require("express");
const router  = express.Router();
const { getAllCities } = require("../config/cityData");
const Listing = require("../models/listingProperty");

/* ============================================================
   GET /sitemap.xml
============================================================ */
router.get("/sitemap.xml", async (req, res) => {
  try {
    const BASE = "https://www.hostelnode.com";
    const now  = new Date().toISOString().split("T")[0];
    const cities = getAllCities();

    // Fetch all approved listing slugs
    const listings = await Listing.find({ status: "Approved" }).select("slug updatedAt").lean();

    let urls = [];

    // Static pages
    const staticPages = [
      { loc: "/",                 priority: "1.0", changefreq: "daily"   },
      { loc: "/findHostels",      priority: "0.9", changefreq: "daily"   },
      { loc: "/signup",           priority: "0.6", changefreq: "monthly" },
      { loc: "/login",            priority: "0.5", changefreq: "monthly" },
    ];
    staticPages.forEach(p => urls.push({ ...p, lastmod: now }));

    // City pages
    cities.forEach(city => {
      urls.push({
        loc:        `/city/${city.slug}`,
        lastmod:    now,
        priority:   "0.9",
        changefreq: "weekly",
      });
      // Sub-area pages
      city.areas.forEach(area => {
        urls.push({
          loc:        `/city/${city.slug}/${area.slug}`,
          lastmod:    now,
          priority:   "0.8",
          changefreq: "weekly",
        });
      });
    });

    // Individual listing pages
    listings.forEach(l => {
      if (!l.slug) return;
      urls.push({
        loc:        `/hostel/${l.slug}`,
        lastmod:    l.updatedAt ? l.updatedAt.toISOString().split("T")[0] : now,
        priority:   "0.7",
        changefreq: "weekly",
      });
    });

    // Build XML
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${BASE}${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(xml);

  } catch (err) {
    console.error("Sitemap error:", err);
    res.status(500).send("Error generating sitemap");
  }
});

/* ============================================================
   GET /robots.txt
============================================================ */
router.get("/robots.txt", (req, res) => {
  const BASE = "https://www.hostelnode.com";
  res.header("Content-Type", "text/plain");
  res.send(`User-agent: *
Allow: /

# Allow all city and listing pages
Allow: /city/
Allow: /hostel/
Allow: /findHostels

# Disallow admin and private areas
Disallow: /admin/
Disallow: /owner/
Disallow: /student/dashboard
Disallow: /student/wishlist
Disallow: /api/

Sitemap: ${BASE}/sitemap.xml
`);
});

module.exports = router;