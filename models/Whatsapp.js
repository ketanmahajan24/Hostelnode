const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const os     = require('os');
const path   = require('path');

// ================= GLOBAL STATE =================
let client        = null;
let isInitialized = false;
let isInitializing = false;
let restartTimer  = null;

// ================= SESSION PATH =================
const sessionPath = os.platform() === 'linux'
  ? '/var/lib/jenkins/whatsapp_session'
  : path.join(__dirname, 'whatsapp_session');

// ================= LOGGER =================
const log   = (...a) => console.log("🟢",  ...a);
const error = (...a) => console.error("🔴", ...a);

// ================= MESSAGE QUEUE =================
// Prevents parallel sends from crashing the browser
const queue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { number, text, resolve } = queue.shift();
    try {
      if (!isInitialized || !client) {
        resolve({ success: false, error: "not_ready" });
        continue;
      }
      await client.sendMessage(number, text);
      resolve({ success: true });
    } catch (err) {
      error("Send error:", err.message);
      resolve({ success: false, error: err.message });

      // If browser crashed, restart
      if (
        err.message.includes("timed out") ||
        err.message.includes("context was destroyed") ||
        err.message.includes("Session closed")
      ) {
        restartWhatsApp("Browser crash during send");
        break; // stop processing, restart will reinit
      }
    }

    // Small delay between messages — prevents browser overload
    await new Promise(r => setTimeout(r, 500));
  }

  isProcessing = false;
}

function enqueue(number, text) {
  return new Promise((resolve) => {
    queue.push({ number, text, resolve });
    processQueue();
  });
}

// ================= FORMAT NUMBER =================
function formatNumber(phone) {
  const clean = phone.toString().replace(/\D/g, "");
  const withCode = clean.startsWith("91") ? clean : `91${clean}`;
  return `${withCode}@c.us`;
}

// ================= CREATE CLIENT =================
function createClient() {
  log("⚙️ Creating WhatsApp client...");
  return new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
      headless: true,

      // ✅ THE KEY FIX — increase protocol timeout
      protocolTimeout: 120000,

      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',   // Critical on Linux
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ]
    }
  });
}

// ================= INIT =================
async function startWhatsApp() {
  if (isInitializing) {
    log("⏳ Already initializing, skipping...");
    return;
  }

  isInitializing = true;
  isInitialized  = false;

  try {
    // Destroy old client cleanly
    if (client) {
      try { await client.destroy(); } catch {}
      client = null;
    }

    client = createClient();

    client.on('qr', (qr) => {
      log("📲 Scan QR to connect WhatsApp:");
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      isInitialized  = true;
      isInitializing = false;
      log("✅ WhatsApp Connected and Ready!");
      // Flush any queued messages
      processQueue();
    });

    client.on('auth_failure', (msg) => {
      isInitialized  = false;
      isInitializing = false;
      error("❌ Auth failure:", msg);
      scheduleRestart("Auth failure");
    });

    client.on('disconnected', (reason) => {
      isInitialized  = false;
      isInitializing = false;
      error("⚠️ Disconnected:", reason);
      scheduleRestart(reason);
    });

    client.on('loading_screen', (percent, msg) => {
      log(`⏳ Loading ${percent}% — ${msg}`);
    });

    log("🚀 Initializing WhatsApp...");
    await client.initialize();

  } catch (err) {
    isInitialized  = false;
    isInitializing = false;
    error("💥 Init crash:", err.message);
    scheduleRestart(err.message);
  }
}

// ================= RESTART — with debounce =================
function scheduleRestart(reason) {
  // Prevent multiple restart timers stacking up
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  error("🔄 Scheduling restart due to:", reason);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startWhatsApp();
  }, 8000); // wait 8s before restarting
}

// ✅ REMOVED: global uncaughtException/unhandledRejection handlers
// They were restarting WhatsApp for unrelated app errors

// ================= START =================
setTimeout(() => startWhatsApp(), 3000);

// ================= SEND OTP =================
const sendWhatsAppOTP = async (phone, otp) => {
  try {
    if (!isInitialized || !client) {
      error("⏳ WhatsApp not ready for OTP");
      return { success: false, error: "not_ready" };
    }

    const number = formatNumber(phone);

    // Check registration with timeout protection
    let isRegistered = false;
    try {
      isRegistered = await Promise.race([
        client.isRegisteredUser(number),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("isRegisteredUser timeout")), 15000)
        )
      ]);
    } catch (e) {
      error("isRegisteredUser failed:", e.message);
      // Assume registered if check fails — let sendMessage handle it
      isRegistered = true;
    }

    if (!isRegistered) {
      error("❌ Not on WhatsApp:", phone);
      return { success: false, error: "not_whatsapp" };
    }

    const text =
`🔐 *HostelNode OTP*

Your OTP is: *${otp}*

Valid for 5 minutes.

https://hostelnode.com`;

    // Use queue to prevent parallel sends
    const result = await enqueue(number, text);

    if (result.success) {
      log("✅ OTP sent:", phone);
    }

    return result;

  } catch (err) {
    error("❌ OTP send error:", err.message);
    return { success: false, error: err.message };
  }
};

// ================= SEND GENERIC MESSAGE =================
const sendWhatsAppMessage = async (phone, text) => {
  try {
    if (!isInitialized || !client) {
      error("⏳ WhatsApp not ready");
      return false;
    }

    const number = formatNumber(phone);

    // Check registration with timeout protection
    let isRegistered = false;
    try {
      isRegistered = await Promise.race([
        client.isRegisteredUser(number),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 15000)
        )
      ]);
    } catch {
      isRegistered = true; // assume registered on timeout
    }

    if (!isRegistered) {
      error("❌ Number not on WhatsApp:", phone);
      return false;
    }

    const result = await enqueue(number, text);
    if (result.success) log("✅ Generic WA sent:", phone);
    return result.success;

  } catch (err) {
    error("❌ Generic WA send error:", err.message);
    return false;
  }
};

// ================= SEND OWNER ENQUIRY =================
const sendOwnerEnquiryMessage = async (phone, data) => {
  try {
    if (!isInitialized || !client) {
      error("⏳ WhatsApp not ready");
      return;
    }

    const number = formatNumber(phone);

    const text =
`🏠 *New Enquiry — HostelNode*

👤 ${data.studentName}
📞 ${data.studentPhone}

🏢 ${data.hostelName}
🛏 ${data.roomType  || "N/A"}
📅 ${data.moveIn    || "N/A"}

💬 ${data.message   || "No message"}

👉 Chat: https://wa.me/${data.studentPhone}`;

    const result = await enqueue(number, text);
    if (result.success) log("✅ Enquiry sent to owner:", phone);

  } catch (err) {
    error("❌ Enquiry send error:", err.message);
  }
};

// ================= EXPORT =================
module.exports = {
  sendWhatsAppOTP,
  sendOwnerEnquiryMessage,
  sendWhatsAppMessage
};