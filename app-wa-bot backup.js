// ============================================================
//  app-wa-bot.js  —  HostelNode WhatsApp Bot
//  Mount in app.js:
//    const waBot = require("./app-wa-bot");
//    app.use("/webhook/whatsapp", waBot);
// ============================================================

const express = require("express");
const router  = express.Router();
const axios   = require("axios");

// ── Config ───────────────────────────────────────────────────
const WA_TOKEN    = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const BASE_URL    = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;

const log   = (...a) => console.log("🟢", ...a);
const error = (...a) => console.error("🔴", ...a);

// ── Session Store ────────────────────────────────────────────
const sessions    = new Map();
const SESSION_TTL = 10 * 60 * 1000; // 10 min

function getSession(phone) {
  const s = sessions.get(phone);
  if (!s) return { state: "IDLE" };
  if (Date.now() - s.timestamp > SESSION_TTL) {
    sessions.delete(phone);
    return { state: "IDLE" };
  }
  return s;
}

function setSession(phone, state, data = {}) {
  sessions.set(phone, { state, data, timestamp: Date.now() });
}

function clearSession(phone) {
  sessions.delete(phone);
}

// ── City Database ────────────────────────────────────────────
const CITY_MAP = {
  // MAHARASHTRA
  'mumbai':'mumbai','bombay':'mumbai','मुंबई':'mumbai',
  'navi mumbai':'navi-mumbai','navimumbai':'navi-mumbai','new mumbai':'navi-mumbai',
  'thane':'thane','kalyan':'kalyan','dombivli':'dombivli',
  'ulhasnagar':'ulhasnagar','mira road':'mira-road',
  'vasai':'vasai','virar':'virar','panvel':'panvel',
  'belapur':'belapur','cbd belapur':'belapur',
  'kharghar':'kharghar','nerul':'nerul','vashi':'vashi',
  'airoli':'airoli','ghansoli':'ghansoli',
  'pune':'pune','poona':'pune','पुणे':'pune',
  'pimpri':'pune','chinchwad':'pune','pimpri chinchwad':'pune',
  'hinjewadi':'pune','wakad':'pune','kothrud':'pune',
  'baner':'pune','hadapsar':'pune','viman nagar':'pune',
  'kharadi':'pune','magarpatta':'pune','aundh':'pune',
  'nagpur':'nagpur','nashik':'nashik','nasik':'nashik',
  'aurangabad':'aurangabad','sambhajinagar':'aurangabad',
  'solapur':'solapur','kolhapur':'kolhapur',
  'amravati':'amravati','akola':'akola',
  'latur':'latur','nanded':'nanded',
  'satara':'satara','sangli':'sangli','jalgaon':'jalgaon',
  'bhiwandi':'bhiwandi','wardha':'wardha',

  // KARNATAKA
  'bangalore':'bangalore','bengaluru':'bangalore','blr':'bangalore',
  'electronic city':'bangalore','whitefield':'bangalore',
  'koramangala':'bangalore','hsr layout':'bangalore',
  'indiranagar':'bangalore','btm layout':'bangalore',
  'marathahalli':'bangalore','jayanagar':'bangalore',
  'mysore':'mysore','mysuru':'mysore',
  'hubli':'hubli','dharwad':'hubli',
  'mangalore':'mangalore','mangaluru':'mangalore',
  'belgaum':'belagavi','belagavi':'belagavi',
  'manipal':'manipal','udupi':'udupi',
  'tumkur':'tumkur','davangere':'davangere',
  'shimoga':'shivamogga','shivamogga':'shivamogga',
  'surathkal':'surathkal',

  // DELHI NCR
  'delhi':'delhi','new delhi':'delhi','दिल्ली':'delhi',
  'noida':'noida','greater noida':'greater-noida',
  'gurgaon':'gurgaon','gurugram':'gurgaon',
  'faridabad':'faridabad','ghaziabad':'ghaziabad',

  // UTTAR PRADESH
  'lucknow':'lucknow','lko':'lucknow',
  'kanpur':'kanpur','agra':'agra',
  'varanasi':'varanasi','banaras':'varanasi',
  'prayagraj':'prayagraj','allahabad':'prayagraj',
  'meerut':'meerut','bareilly':'bareilly',
  'aligarh':'aligarh','gorakhpur':'gorakhpur',
  'mathura':'mathura','vrindavan':'mathura',
  'moradabad':'moradabad','jhansi':'jhansi',

  // RAJASTHAN
  'jaipur':'jaipur','pink city':'jaipur',
  'jodhpur':'jodhpur','blue city':'jodhpur',
  'udaipur':'udaipur','lake city':'udaipur',
  'kota':'kota','ajmer':'ajmer',
  'bikaner':'bikaner','alwar':'alwar',
  'pilani':'pilani','sikar':'sikar',

  // MADHYA PRADESH
  'indore':'indore','bhopal':'bhopal',
  'jabalpur':'jabalpur','gwalior':'gwalior',
  'ujjain':'ujjain','rewa':'rewa',
  'sagar':'sagar','ratlam':'ratlam',

  // GUJARAT
  'ahmedabad':'ahmedabad','amdavad':'ahmedabad',
  'surat':'surat','vadodara':'vadodara','baroda':'vadodara',
  'rajkot':'rajkot','bhavnagar':'bhavnagar',
  'jamnagar':'jamnagar','gandhinagar':'gandhinagar',
  'anand':'anand','nadiad':'nadiad','morbi':'morbi',

  // TELANGANA
  'hyderabad':'hyderabad','hyd':'hyderabad',
  'secunderabad':'hyderabad','cyberabad':'hyderabad',
  'hitech city':'hyderabad','gachibowli':'hyderabad',
  'warangal':'warangal','karimnagar':'karimnagar',
  'nizamabad':'nizamabad',

  // ANDHRA PRADESH
  'visakhapatnam':'visakhapatnam','vizag':'visakhapatnam',
  'vijayawada':'vijayawada','guntur':'guntur',
  'nellore':'nellore','kurnool':'kurnool',
  'tirupati':'tirupati','rajahmundry':'rajahmundry',

  // TAMIL NADU
  'chennai':'chennai','madras':'chennai',
  'coimbatore':'coimbatore','cbe':'coimbatore',
  'madurai':'madurai','trichy':'trichy',
  'tiruchirappalli':'trichy','salem':'salem',
  'tirunelveli':'tirunelveli','vellore':'vellore',
  'erode':'erode','tirupur':'tirupur',
  'thanjavur':'thanjavur','ooty':'ooty',

  // KERALA
  'kochi':'kochi','cochin':'kochi','ernakulam':'kochi',
  'thiruvananthapuram':'thiruvananthapuram','trivandrum':'thiruvananthapuram',
  'kozhikode':'kozhikode','calicut':'kozhikode',
  'thrissur':'thrissur','trichur':'thrissur',
  'kollam':'kollam','kannur':'kannur',
  'palakkad':'palakkad','malappuram':'malappuram',
  'kottayam':'kottayam','alappuzha':'alappuzha','alleppey':'alappuzha',

  // WEST BENGAL
  'kolkata':'kolkata','calcutta':'kolkata',
  'howrah':'kolkata','salt lake':'kolkata',
  'new town':'kolkata','durgapur':'durgapur',
  'asansol':'asansol','siliguri':'siliguri',
  'kharagpur':'kharagpur','bardhaman':'bardhaman',

  // PUNJAB & HARYANA
  'chandigarh':'chandigarh','ludhiana':'ludhiana',
  'amritsar':'amritsar','jalandhar':'jalandhar',
  'patiala':'patiala','mohali':'mohali',
  'bathinda':'bathinda','ambala':'ambala',
  'panipat':'panipat','sonipat':'sonipat',
  'rohtak':'rohtak','hisar':'hisar','karnal':'karnal',

  // BIHAR & JHARKHAND
  'patna':'patna','gaya':'gaya',
  'muzaffarpur':'muzaffarpur','bhagalpur':'bhagalpur',
  'darbhanga':'darbhanga','begusarai':'begusarai',
  'ranchi':'ranchi','jamshedpur':'jamshedpur',
  'dhanbad':'dhanbad','bokaro':'bokaro',

  // ODISHA
  'bhubaneswar':'bhubaneswar','bbsr':'bhubaneswar',
  'cuttack':'cuttack','rourkela':'rourkela',
  'berhampur':'berhampur','sambalpur':'sambalpur',
  'puri':'puri',

  // CHHATTISGARH
  'raipur':'raipur','bhilai':'bhilai',
  'bilaspur':'bilaspur','durg':'durg',

  // ASSAM & NORTHEAST
  'guwahati':'guwahati','gauhati':'guwahati',
  'silchar':'silchar','dibrugarh':'dibrugarh',
  'imphal':'imphal','shillong':'shillong',
  'aizawl':'aizawl','agartala':'agartala',
  'kohima':'kohima','gangtok':'gangtok',

  // HIMACHAL & UTTARAKHAND
  'shimla':'shimla','manali':'manali',
  'dharamsala':'dharamsala','solan':'solan',
  'dehradun':'dehradun','ddn':'dehradun',
  'haridwar':'haridwar','rishikesh':'rishikesh',
  'nainital':'nainital','roorkee':'roorkee',
  'haldwani':'haldwani','rudrapur':'rudrapur',

  // GOA
  'goa':'goa','panaji':'goa','panjim':'goa',
  'margao':'goa','vasco':'goa','mapusa':'goa',

  // J&K
  'jammu':'jammu','srinagar':'srinagar','leh':'leh',
};

// ── City Helpers ─────────────────────────────────────────────
function levenshtein(a, b) {
  const dp = Array.from({length: a.length + 1}, (_, i) =>
    Array.from({length: b.length + 1}, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

function detectCity(text) {
  const t = text.toLowerCase().trim();
  if (CITY_MAP[t]) return CITY_MAP[t];
  for (const [key, val] of Object.entries(CITY_MAP))
    if (t.includes(key)) return val;
  for (const [key, val] of Object.entries(CITY_MAP))
    if (key.length > 4 && levenshtein(t, key) <= 2) return val;
  return null;
}

function formatCity(slug) {
  return slug.split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Intent Detection ─────────────────────────────────────────
function detectIntent(text) {
  const t = text.toLowerCase();
  if (t.match(/^(hi|hello|hey|hii|start|menu|help)$/)) return 'GREET';
  if (t.match(/find|search|looking|need|want|pg|hostel|room|flat|near|accommodation/)) return 'FIND';
  if (t.match(/list|add|register|owner|property|rent out|my hostel/)) return 'LIST';
  if (t.match(/price|cost|rent|budget|how much|fees|monthly/)) return 'PRICE';
  if (t.match(/support|problem|issue|contact|agent|human|call/)) return 'SUPPORT';
  if (t.match(/thank|thanks|great|awesome|perfect|done/)) return 'THANKS';
  return 'UNKNOWN';
}

// ── All Button Labels (max 20 chars each) ────────────────────
// ── All Button Labels (max 20 chars each) ────────────────────
const BTN = {
  FIND:    '🔎 Find PG/Hostel',   // 17 chars ✅
  LIST:    '🏡 List Property',    // 16 chars ✅
  SUPPORT: '🤝 Support',          // 11 chars ✅
  PRICES:  '💰 Check Prices',     // 15 chars ✅
  MENU:    '🏠 Main Menu',        // 13 chars ✅
  AGAIN:   '🔍 Try Again',        // 13 chars ✅
  OTHER:   '🔍 Another City',     // 15 chars ✅
  CHARGES: '💸 Listing Charges',  // 18 chars ✅
  HOW:     '📋 How to List',      // 14 chars ✅
  VIDEO:   '▶️ Watch & List',     // 15 chars ✅
};

// ── API Caller ───────────────────────────────────────────────
async function callAPI(payload) {
  try {
    const res = await axios.post(BASE_URL, payload, {
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type':  'application/json'
      },
      timeout: 15000
    });
    return { success: true, data: res.data };
  } catch (err) {
    error("API Error:", JSON.stringify(err.response?.data || err.message));
    return { success: false };
  }
}

// ── Send Plain Text ──────────────────────────────────────────
async function sendText(phone, text) {
  return callAPI({
    messaging_product: "whatsapp",
    to:   phone,
    type: "text",
    text: { body: text }
  });
}

// ── Send Interactive Buttons (max 3) ─────────────────────────
async function sendButtons(phone, bodyText, buttons, headerText = null) {
  const payload = {
    messaging_product: "whatsapp",
    to:   phone,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b, i) => ({
          type:  "reply",
          reply: {
            id:    `btn_${i}_${b.replace(/[^a-zA-Z0-9]/g,'').toLowerCase().slice(0,20)}`,
            title: b.slice(0, 20) // hard limit
          }
        }))
      }
    }
  };
  if (headerText) {
    payload.interactive.header = {
      type: "text",
      text: headerText.slice(0, 60)
    };
  }
  return callAPI(payload);
}

// ── Bot Messages ─────────────────────────────────────────────
const MSG = {

  welcome: (phone) => sendButtons(
    phone,
    `👋 Welcome to *HostelNode*!\n\nIndia's #1 platform to find verified Hostels & PGs near your college.\n\nHow can I help you today?`,
    [BTN.FIND, BTN.LIST, BTN.SUPPORT],
    '🏠 HostelNode'
  ),

  askCity: (phone) => sendText(
    phone,
    `📍 *Which city are you looking in?*\n\n` +
    `Just type the city name:\n\n` +
    `🌆 Mumbai  |  🏙️ Pune  |  🌃 Bangalore\n` +
    `🏛️ Delhi   |  🌇 Hyderabad  |  🌴 Chennai\n` +
    `🏘️ Kota    |  🎓 Vellore  |  🌿 Manipal\n\n` +
    `_We cover 300+ cities across India!_ 🇮🇳`
  ),

  cityResult: (phone, citySlug) => {
    const cityName = formatCity(citySlug);
    const url      = `https://hostelnode.com/city/${citySlug}`;
    return sendButtons(
      phone,
      `🎯 *Verified listings in ${cityName}:*\n\n` +
      `👉 ${url}\n\n` +
      `✅ Verified photos & reviews\n` +
      `✅ Direct owner contact\n` +
      `✅ Zero broker fees`,
      [BTN.OTHER, BTN.LIST, BTN.SUPPORT],
      `📍 ${cityName}`
    );
  },

  cityNotFound: (phone, input) => sendButtons(
    phone,
    `😕 Sorry, couldn't find *"${input}"*.\n\n` +
    `Please check spelling or try a nearby major city.\n\n` +
    `Example: Mumbai, Pune, Delhi, Bangalore...`,
    [BTN.AGAIN, BTN.MENU, BTN.SUPPORT]
  ),

  listProperty: (phone) => sendButtons(
    phone,
    `🏡 *List on HostelNode — FREE!*\n\n` +
    `✅ Reach 50,000+ students monthly\n` +
    `✅ Zero setup cost\n` +
    `✅ Get verified badge\n` +
    `✅ Direct student enquiries\n\n` +
    `👉 https://hostelnode.com/login`,
    [BTN.FIND, BTN.PRICES, BTN.SUPPORT]
  ),
 
  prices: (phone) => sendButtons(
  phone,
  `💰 *HostelNode Listing Prices:*\n\n` +
  `✅ *Completely FREE to List!\n\n*` +
  `🏠 *Hostel*  — ₹0\n` +
  `🏘️ *PG*      — ₹0\n` +
  `🏢 *Flat*    — ₹0\n\n` +
  `_No hidden charges. No commission.\n` +
  `List your property & get direct leads!_`,
  [BTN.FIND, BTN.LIST, BTN.SUPPORT]
),

  
  // prices: (phone) => sendButtons(
  //   phone,
  //   `💰 *HostelNode Price Range:*\n\n` +
  //   `🏠 *PG / Hostel*\n` +
  //   `• Budget: ₹2,000 – ₹5,000/mo\n` +
  //   `• Standard: ₹5,000 – ₹8,000/mo\n` +
  //   `• Premium: ₹8,000 – ₹12,000/mo\n\n` +
  //   `🏘️ *Flat Share*\n` +
  //   `• Starting from ₹4,000/mo\n\n` +
  //   `_Prices vary by city & amenities_`,
  //   [BTN.FIND, BTN.LIST, BTN.SUPPORT]
  // ),

  support: (phone) => sendButtons(
    phone,
    `🤝 *HostelNode Support*\n\n` +
    `We're here to help! 😊\n\n` +
    `📧 Email: support@hostelnode.com\n` +
    `🌐 Website: https://hostelnode.com\n` +
    `⏰ Hours: 9 AM – 9 PM, Mon–Sun\n\n` +
    `Our team will get back to you shortly!`,
    [BTN.FIND, BTN.LIST, BTN.MENU]
  ),

  thanks: (phone) => sendButtons(
    phone,
    `😊 *Thank you for using HostelNode!*\n\n` +
    `We're glad we could help! 🏠✨\n\n` +
    `👉 https://hostelnode.com`,
    [BTN.FIND, BTN.LIST, BTN.SUPPORT]
  ),

  unknown: (phone) => sendButtons(
    phone,
    `🤔 Sorry, I didn't understand that.\n\nHere's what I can help you with:`,
    [BTN.FIND, BTN.LIST, BTN.SUPPORT]
  ),
};

// ── All Button Values (for matching) ─────────────────────────
const ALL_BUTTONS = Object.values(BTN);

function isButton(text) {
  return ALL_BUTTONS.includes(text);
}

async function handleButton(phone, text) {
  if (text === BTN.FIND || text === BTN.OTHER || text === BTN.AGAIN) {
    setSession(phone, 'AWAITING_CITY');
    await MSG.askCity(phone);
  } else if (text === BTN.LIST) {
    clearSession(phone);
    await MSG.listProperty(phone);
  } else if (text === BTN.PRICES) {
    clearSession(phone);
    await MSG.prices(phone);
  } else if (text === BTN.SUPPORT) {
    clearSession(phone);
    await MSG.support(phone);
  } else if (text === BTN.MENU) {
    clearSession(phone);
    await MSG.welcome(phone);
  }
}

// ── Webhook Verification (GET) ───────────────────────────────
router.get("/", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
    log("✅ Webhook verified!");
    return res.status(200).send(challenge);
  }
  error("❌ Webhook verify failed!");
  res.sendStatus(403);
});

// ── Main Message Handler (POST) ──────────────────────────────
router.post("/", async (req, res) => {
  res.sendStatus(200); // Meta ko turant 200 chahiye

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg   = value?.messages?.[0];
    if (!msg) return;

    const phone   = msg.from;
    const session = getSession(phone);

    // ── Extract text ──────────────────────────────────────
    let text = '';
    if (msg.type === 'text') {
      text = msg.text?.body?.trim() || '';
    } else if (msg.type === 'interactive') {
      const ir = msg.interactive;
      if (ir.type === 'button_reply') {
        text = ir.button_reply?.title?.trim() || '';
      } else if (ir.type === 'list_reply') {
        text = ir.list_reply?.title?.trim() || '';
      }
    } else {
      await MSG.unknown(phone);
      return;
    }

    if (!text) return;

    log(`📨 [${phone}] "${text}" | State: ${session.state}`);

    // ── AWAITING CITY state ───────────────────────────────
    if (session.state === 'AWAITING_CITY') {

      // Button tap in city state
      if (isButton(text)) {
        await handleButton(phone, text);
        return;
      }

      // City detect karo
      const citySlug = detectCity(text);

      if (citySlug) {
        clearSession(phone);
        log(`✅ City detected: ${citySlug}`);
        await MSG.cityResult(phone, citySlug);
      } else {
        log(`❌ City not found: ${text}`);
        await MSG.cityNotFound(phone, text);
        setSession(phone, 'AWAITING_CITY'); // stay in city state
      }
      return;
    }

    // ── Button tap in IDLE state ──────────────────────────
    if (isButton(text)) {
      await handleButton(phone, text);
      return;
    }

    // ── Intent based ──────────────────────────────────────
    const intent = detectIntent(text);
    log(`🎯 Intent: ${intent}`);

    switch (intent) {
      case 'GREET':
        clearSession(phone);
        await MSG.welcome(phone);
        break;
      case 'FIND':
        setSession(phone, 'AWAITING_CITY');
        await MSG.askCity(phone);
        break;
      case 'LIST':
        clearSession(phone);
        await MSG.listProperty(phone);
        break;
      case 'PRICE':
        clearSession(phone);
        await MSG.prices(phone);
        break;
      case 'SUPPORT':
        clearSession(phone);
        await MSG.support(phone);
        break;
      case 'THANKS':
        clearSession(phone);
        await MSG.thanks(phone);
        break;
      default:
        await MSG.unknown(phone);
        break;
    }

  } catch (err) {
    error("Webhook handler error:", err.message);
  }
});

module.exports = router;