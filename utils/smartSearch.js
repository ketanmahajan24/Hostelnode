// ─────────────────────────────────────────────────────────────
// smartSearch.js  —  Natural language query parser for hostels
// Place in:  utils/smartSearch.js
// ─────────────────────────────────────────────────────────────

// ── Known cities / areas ─────────────────────────────────────
const CITIES = [
  'mumbai','navi mumbai','thane','pune','delhi','new delhi','bangalore','bengaluru',
  'hyderabad','chennai','kolkata','ahmedabad','jaipur','lucknow','bhopal','indore',
  'nagpur','nashik','aurangabad','surat','vadodara','coimbatore','madurai','kochi',
  'chandigarh','noida','gurgaon','faridabad','ghaziabad','patna','ranchi','bhubaneswar',
  'visakhapatnam','vijayawada','tirupati','mysore','hubli','mangalore','vellore',
  'powai','andheri','bandra','dadar','kurla','borivali','malad','goregaon',
  'kharghar','vashi','belapur','airoli','nerul','panvel','ulwe','dombivli','kalyan',
  'koregaon park','kothrud','hadapsar','wakad','hinjewadi','baner','aundh',
  'koramangala','electronic city','hsr layout','whitefield','marathahalli',
  'ameerpet','kukatpally','hitech city','gachibowli','dilsukhnagar','secunderabad',
  'lajpat nagar','dwarka','rohini','janakpuri','saket','pitampura',
  'salt lake','howrah','dumdum','jadavpur',
  'anna nagar','adyar','velachery','tambaram','porur',
  'pilani','vellore','manipal','surathkal','warangal','trichy',
];

// ── Known colleges ───────────────────────────────────────────
const COLLEGES = [
  'iit bombay','iit delhi','iit madras','iit kharagpur','iit roorkee','iit kanpur',
  'iit hyderabad','iit gandhinagar','iit bhubaneswar',
  'bits pilani','bits goa','bits hyderabad',
  'nit trichy','nit warangal','nit surathkal','nit nagpur','nit raipur',
  'vit vellore','vit chennai','srm chennai','amity noida','manipal university',
  'delhi university','du','jnu','jamia millia','ip university',
  'pune university','sppu','savitribai phule',
  'christ university','pes university','rvce','msrit','bmsce',
  'osmania university','jntu','cbit hyderabad',
  'anna university','psg coimbatore','nit calicut',
  'iim ahmedabad','iim bangalore','iim calcutta','iim lucknow',
];

// ── Amenity keywords ─────────────────────────────────────────
const AMENITY_MAP = {
  'wifi'          : 'WiFi',
  'wi-fi'         : 'WiFi',
  'internet'      : 'WiFi',
  'ac'            : 'AC',
  'air condition' : 'AC',
  'air-condition' : 'AC',
  'aircondition'  : 'AC',
  'cooled'        : 'AC',
  'meals'         : 'Meals',
  'food'          : 'Meals',
  'mess'          : 'Meals',
  'tiffin'        : 'Meals',
  'breakfast'     : 'Meals',
  'laundry'       : 'Laundry',
  'washing'       : 'Laundry',
  'security'      : 'Security',
  'guard'         : 'Security',
  'cctv'          : 'CCTV',
  'geyser'        : 'Geyser',
  'hot water'     : 'Geyser',
  'parking'       : 'Parking',
  'gym'           : 'Gym',
  'fitness'       : 'Gym',
  'fridge'        : 'Fridge',
  'refrigerator'  : 'Fridge',
  'study room'    : 'Study Room',
  'reading room'  : 'Study Room',
  'attached bath' : 'Attached Bathroom',
  'attached bathroom':'Attached Bathroom',
  'common room'   : 'Common Room',
};

// ── Room type keywords ───────────────────────────────────────
const ROOM_TYPE_MAP = {
  'single'    : 'single',
  '1 sharing' : 'single',
  'double'    : 'double',
  '2 sharing' : 'double',
  'two sharing':'double',
  'triple'    : 'triple',
  '3 sharing' : 'triple',
  'three sharing':'triple',
  'dorm'      : 'dormitory',
  'dormitory' : 'dormitory',
  'bunk'      : 'dormitory',
};

// ── Gender keywords ──────────────────────────────────────────
const GENDER_MAP = {
  'boys'   : 'Boys',
  'gents'  : 'Boys',
  'male'   : 'Boys',
  'men'    : 'Boys',
  'girls'  : 'Girls',
  'ladies' : 'Girls',
  'female' : 'Girls',
  'women'  : 'Girls',
  'coed'   : 'Co-ed',
  'co-ed'  : 'Co-ed',
  'mixed'  : 'Co-ed',
  'unisex' : 'Co-ed',
};

// ── Property type keywords ───────────────────────────────────
const PROP_TYPE_MAP = {
  'hostel' : 'Hostel',
  'pg'     : 'PG',
  'paying guest':'PG',
  'flat'   : 'Flat',
  'flat share':'Flat',
  'apartment':'Flat',
};

// ── Budget extraction ─────────────────────────────────────────
function extractBudget(q) {
  // e.g. "under 5000", "below 8k", "less than 6000", "within 10k", "upto 7000"
  const patterns = [
    /(?:under|below|less than|within|upto|up to|max|maximum)\s*₹?\s*(\d+)\s*k?/i,
    /₹\s*(\d+)\s*k?\s*(?:per month|\/month|pm|month)?/i,
    /(\d+)\s*k\s*(?:per month|\/month|pm|budget)?/i,
    /budget\s*(?:of|is|=|:)?\s*₹?\s*(\d+)\s*k?/i,
  ];
  for (const p of patterns) {
    const m = q.match(p);
    if (m) {
      let val = parseInt(m[1]);
      // if "5k" → 5000
      if (/\d+k/i.test(m[0]) && val < 1000) val *= 1000;
      return val;
    }
  }
  return null;
}

// ── Main parser ───────────────────────────────────────────────
function parseSearchQuery(rawQuery) {
  const q    = (rawQuery || '').toLowerCase().trim();
  const result = {
    cityOrArea   : null,   // extracted location string → goes into $or regex
    college      : null,   // extracted college name
    gender       : null,   // 'Boys' | 'Girls' | 'Co-ed'
    propertyType : null,   // 'Hostel' | 'PG' | 'Flat'
    roomType     : null,   // 'single' | 'double' | 'triple' | 'dormitory'
    amenities    : [],     // ['WiFi','AC', ...]
    budget       : null,   // number
    rawQuery     : rawQuery,
  };

  // 1. Budget
  result.budget = extractBudget(q);

  // 2. Gender
  for (const [kw, val] of Object.entries(GENDER_MAP)) {
    if (q.includes(kw)) { result.gender = val; break; }
  }

  // 3. Property type
  for (const [kw, val] of Object.entries(PROP_TYPE_MAP)) {
    if (q.includes(kw)) { result.propertyType = val; break; }
  }

  // 4. Room type
  for (const [kw, val] of Object.entries(ROOM_TYPE_MAP)) {
    if (q.includes(kw)) { result.roomType = val; break; }
  }

  // 5. Amenities (collect ALL matches)
  for (const [kw, val] of Object.entries(AMENITY_MAP)) {
    if (q.includes(kw) && !result.amenities.includes(val)) {
      result.amenities.push(val);
    }
  }

  // 6. College (longest match wins)
  let bestCollege = null, bestCollegeLen = 0;
  for (const c of COLLEGES) {
    if (q.includes(c) && c.length > bestCollegeLen) {
      bestCollege = c; bestCollegeLen = c.length;
    }
  }
  result.college = bestCollege;

  // 7. City / area (longest match wins, skip if college already found it)
  let bestCity = null, bestCityLen = 0;
  for (const c of CITIES) {
    if (q.includes(c) && c.length > bestCityLen) {
      bestCity = c; bestCityLen = c.length;
    }
  }
  result.cityOrArea = bestCity;

  return result;
}

module.exports = { parseSearchQuery };
