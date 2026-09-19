// ============================================================
//  utils/flatmateSavedSearchMatch.js — HostelNode Flatmate (Phase 10)
// ============================================================
/* ============================================================
   listingMatchesSavedSearch(listing, filters) — a pure boolean
   predicate: does this ONE listing match this ONE saved search's
   filters? Deliberately mirrors the match-building logic in
   GET /flatmate/results (routes/flatmateRoutes.js) field-for-field,
   but as an in-memory predicate rather than a Mongo query — because
   the call site here is "check one just-activated listing against
   every active saved search", the inverse shape of the results page
   ("check every listing against one filter set"), so a second Mongo
   query per saved search would be needless overhead. If the results
   route's filter semantics ever change, this function's comments
   point back at it so both can be updated together.

   filters: { location, gender, type, budget, bhk, roomType } — same
   shape as FlatmateSavedSearch.filters and the results route's query
   params. Every field empty/absent = "no filter" = matches anything.
============================================================ */

function roomTypeFilterValue(rt) {
  // Copied verbatim from routes/flatmateRoutes.js's roomTypeFilterValue()
  // (not required from there — that function isn't exported). Keep
  // these two in sync if the results route's mapping ever changes.
  if (rt === "private") return "Private Room";
  if (rt === "shared")  return "Shared Room";
  return null;
}

function listingMatchesSavedSearch(listing, filters = {}) {
  if (!listing) return false;
  const { location = "", gender = "", type = "", budget = "", bhk = "", roomType = "" } = filters;

  if (location) {
    const re = new RegExp(location.trim(), "i");
    if (!re.test(listing.city || "") && !re.test(listing.area || "")) return false;
  }

  if (gender && gender !== "any") {
    if (listing.gender !== gender && listing.gender !== "any") return false;
  }

  if (type === "need" || type === "have") {
    const wantType = type === "have" ? "HAVE_FLAT" : "NEED_FLAT";
    if (listing.type !== wantType) return false;
  }

  if (bhk) {
    if (listing.bhk !== parseInt(bhk, 10)) return false;
  }

  const roomTypeValue = roomTypeFilterValue(roomType);
  if (roomTypeValue && listing.roomType !== roomTypeValue) return false;

  if (budget) {
    const max = parseInt(budget, 10);
    const price = listing.type === "HAVE_FLAT" ? listing.have?.rentMonthly : listing.need?.budgetMax;
    if (price == null || price > max) return false;
  }

  return true;
}

module.exports = { listingMatchesSavedSearch };
