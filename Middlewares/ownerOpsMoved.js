/* ============================================================
   Middlewares/ownerOpsMoved.js  —  Property Operations Phase 2 (hostelnode.com)

   Owners manage tenants, rent, rooms and floors in the owner dashboard
   (manage.hostelnode.com). This site still had old copies of those
   pages under /user, without the safety checks added there (any
   logged-in owner could open another owner's tenant by its id).
   They now send the owner to the same page in the owner dashboard,
   so there is only one, safe, place to manage a property.

   Set HN_OWNER_DASHBOARD_URL (e.g. https://manage.hostelnode.com).
   Without it the old pages answer "moved" instead of opening.
   Listings, enquiries and the owner's profile on this site are not affected.
============================================================ */

const OPS = /^\/(members?|member-edit|activemember|newmember|newadded|addpayment|payment-receipt|payment-history|allfeesrecords|searchfeesrecords|upcomingpayments|deureports|revenue|floors?|managefloor|newfloor|allrooms|managerooms?|newroom|rooms|tenants)(\/|$)/i;

module.exports = function ownerOpsMoved(req, res, next) {
  let p = String(req.path || "").replace(/\/{2,}/g, "/");
  try { p = decodeURIComponent(p); } catch { /* keep as is */ }
  if (!OPS.test(p)) return next();
  const base = String(process.env.HN_OWNER_DASHBOARD_URL || "").trim().replace(/\/$/, "");
  const ok = /^https:\/\/[^\s"'<>]+$/.test(base);
  if (ok && (req.method === "GET" || req.method === "HEAD")) return res.redirect(302, base + "/user" + req.url);
  res.status(410).type("text/plain").send(ok
    ? `This has moved to your owner dashboard: ${base}/user`
    : "Managing tenants, rent, rooms and floors has moved to your HostelNode owner dashboard.");
};
