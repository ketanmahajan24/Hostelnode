// ============================================================
//  utils/googleMaps.js — HostelNode
//  Server-side wrappers for Google Maps Platform's newer APIs:
//  Places API (New) for nearby search, and the Routes API for
//  driving/walking/transit directions.
//
//  Uses a SERVER key (GOOGLE_MAPS_SERVER_KEY) if one is configured
//  separately from the browser-facing key (GOOGLE_MAPS_API_KEY),
//  falling back to the browser key if only one is set — matches the
//  spec's own guidance on separate server-side vs browser-side key
//  restrictions, without forcing two keys to be configured before
//  anything works at all.
//
//  Every function fails soft: on any error (missing key, network,
//  Google error response) it returns { success: false, error } and
//  NEVER throws — callers render "unavailable" UI instead of crashing
//  the page. Nothing here is tested against a live key in this sandbox
//  (no network path to maps.googleapis.com here, and no key exists yet)
//  — this is a from-scratch, carefully-structured implementation, not
//  a modification of something already proven to work.
// ============================================================

const axios = require("axios");

const SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY;

const PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

// Nearby-category → Places API (New) type mapping. One type per category
// keeps each request small and cheap; Google's includedTypes accepts an
// array if you ever want to broaden a category later.
const NEARBY_CATEGORY_TYPES = {
  metro: ["subway_station", "train_station"],
  hospital: ["hospital"],
  college: ["university"],
  grocery: ["supermarket", "grocery_store"],
  food: ["restaurant"],
  pharmacy: ["pharmacy"],
  gym: ["gym"],
  atm: ["atm"],
  movies: ["movie_theater"],
  clubs: ["night_club"],
};

const NEARBY_RADIUS_METERS = 2000; // 2km — reasonable walk/short-ride radius, keeps result sets small
const NEARBY_MAX_RESULTS = 8;

/* searchNearby(lat, lng, category)
   Places API (New) — Nearby Search. Uses a field mask to request only
   what's actually rendered (name, location, address, rating), which is
   both cheaper (New Places API bills by field group) and faster. */
async function searchNearby(lat, lng, category) {
  if (!SERVER_KEY) return { success: false, error: "Google Maps API key not configured." };
  const includedTypes = NEARBY_CATEGORY_TYPES[category];
  if (!includedTypes) return { success: false, error: "Unknown category." };

  try {
    const res = await axios.post(
      PLACES_NEARBY_URL,
      {
        includedTypes,
        maxResultCount: NEARBY_MAX_RESULTS,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: NEARBY_RADIUS_METERS },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": SERVER_KEY,
          // Field mask — only pull what the nearby-places panel actually shows.
          "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.rating,places.id",
        },
        timeout: 10000,
      }
    );

    const places = (res.data.places || []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text || "Unnamed place",
      address: p.formattedAddress || null,
      rating: p.rating || null,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      distanceMeters: haversineMeters(lat, lng, p.location?.latitude, p.location?.longitude),
    }));

    places.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));

    return { success: true, places };
  } catch (err) {
    console.error("Places nearby search error:", err.response?.data || err.message);
    return { success: false, error: "Could not fetch nearby places right now." };
  }
}

/* computeRoute(originLat, originLng, destLat, destLng, mode)
   Routes API — one travel mode per call (matches the UI showing one
   mode at a time, and keeps each call minimal/cheap). mode is one of
   DRIVE | WALK | TRANSIT. Gracefully reports when Google has no route
   for a mode (e.g., no transit coverage) instead of fabricating one. */
async function computeRoute(originLat, originLng, destLat, destLng, mode) {
  if (!SERVER_KEY) return { success: false, error: "Google Maps API key not configured." };
  const validModes = { driving: "DRIVE", walking: "WALK", transit: "TRANSIT" };
  const travelMode = validModes[mode];
  if (!travelMode) return { success: false, error: "Invalid travel mode." };

  try {
    const res = await axios.post(
      ROUTES_URL,
      {
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode,
        ...(travelMode === "DRIVE" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": SERVER_KEY,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        timeout: 10000,
      }
    );

    const route = res.data.routes?.[0];
    if (!route) return { success: false, error: `No ${mode} route available for this destination.` };

    return {
      success: true,
      distanceMeters: route.distanceMeters,
      durationSeconds: parseInt(route.duration) || null, // Google returns e.g. "823s"
      polyline: route.polyline?.encodedPolyline || null,
    };
  } catch (err) {
    console.error(`Route (${mode}) error:`, err.response?.data || err.message);
    return { success: false, error: `Could not compute a ${mode} route right now.` };
  }
}

/* reverseGeocode(lat, lng) — used when a student drags the map pin in
   the create wizard, to fill in a readable area/city automatically. */
async function reverseGeocode(lat, lng) {
  if (!SERVER_KEY) return { success: false, error: "Google Maps API key not configured." };
  try {
    const res = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: { latlng: `${lat},${lng}`, key: SERVER_KEY },
      timeout: 10000,
    });
    const result = res.data.results?.[0];
    if (!result) return { success: false, error: "No address found for this location." };

    const getComponent = (type) => result.address_components.find((c) => c.types.includes(type))?.long_name || "";
    return {
      success: true,
      formattedAddress: result.formatted_address,
      area: getComponent("sublocality") || getComponent("sublocality_level_1") || getComponent("neighborhood"),
      city: getComponent("locality") || getComponent("administrative_area_level_2"),
      placeId: result.place_id,
    };
  } catch (err) {
    console.error("Reverse geocode error:", err.response?.data || err.message);
    return { success: false, error: "Could not resolve this location right now." };
  }
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== "number")) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

module.exports = { searchNearby, computeRoute, reverseGeocode, NEARBY_CATEGORY_TYPES, haversineMeters };
