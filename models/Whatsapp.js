const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ================= GLOBAL STATE =================
let client;
let isInitialized = false;
let isInitializing = false;

const isLinux = os.platform() === 'linux';

// ================= SESSION PATH =================
const sessionPath = isLinux
  ? '/var/lib/jenkins/whatsapp_session'
  : path.join(__dirname, 'whatsapp_session');

// ================= CHROME PATH AUTO DETECT =================
let chromePath;

if (isLinux) {
  if (fs.existsSync('/snap/bin/chromium')) {
    chromePath = '/snap/bin/chromium';
  } else if (fs.existsSync('/snap/bin/chromium')) {
    chromePath = '/snap/bin/chromium';
  } else {
    chromePath = undefined; // fallback to puppeteer bundled
  }
}

// ================= SAFE LOGGER =================
const log = (...args) => console.log("🟢", ...args);
const error = (...args) => console.error("🔴", ...args);

// ================= CREATE CLIENT =================
function createClient() {
  log("⚙️ Creating WhatsApp client...");

  return new Client({
    authStrategy: new LocalAuth({
      dataPath: sessionPath
    }),

    puppeteer: {
      headless: true,
      executablePath: undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ]
    }
  });
}

// ================= INIT FUNCTION =================
async function startWhatsApp() {
  if (isInitializing) {
    log("⏳ Already initializing...");
    return;
  }

  isInitializing = true;

  try {
    client = createClient();

    // QR
    client.on('qr', (qr) => {
      log("📲 Scan QR:");
      qrcode.generate(qr, { small: true });
    });

    // READY
    client.on('ready', () => {
      isInitialized = true;
      isInitializing = false;
      log("✅ WhatsApp Connected!");
    });

    // AUTH FAIL
    client.on('auth_failure', (msg) => {
      isInitialized = false;
      isInitializing = false;
      error("❌ Auth failure:", msg);
      restartWhatsApp("Auth failure");
    });

    // DISCONNECT
    client.on('disconnected', (reason) => {
      isInitialized = false;
      isInitializing = false;
      error("⚠️ Disconnected:", reason);
      restartWhatsApp(reason);
    });

    // LOADING
    client.on('loading_screen', (percent, msg) => {
      log(`⏳ Loading ${percent}% - ${msg}`);
    });

    // INIT
    log("🚀 Starting WhatsApp...");
    await client.initialize();

  } catch (err) {
    isInitialized = false;
    isInitializing = false;
    error("💥 Init crash:", err.message);
    restartWhatsApp(err.message);
  }
}

// ================= RESTART LOGIC =================
function restartWhatsApp(reason) {
  error("🔄 Restarting WhatsApp due to:", reason);

  setTimeout(() => {
    try {
      if (client) {
        client.destroy();
      }
    } catch (e) {
      error("Error destroying client:", e.message);
    }

    startWhatsApp();
  }, 5000);
}

// ================= GLOBAL CRASH HANDLER =================
process.on('uncaughtException', (err) => {
  error("💥 Uncaught Exception:", err.stack || err.message);
  restartWhatsApp("uncaughtException");
});

process.on('unhandledRejection', (err) => {
  error("💥 Unhandled Rejection:", err);
  restartWhatsApp("unhandledRejection");
});

// ================= START WITH DELAY =================
setTimeout(() => {
  startWhatsApp();
}, 3000);


// ================= OTP FUNCTION =================
const sendWhatsAppOTP = async (phone, otp) => {
  try {
    if (!isInitialized || !client || !client.info || !client.info.wid) {
      error("⏳ WhatsApp not ready");
      return { success: false, error: "not_ready" };
    }

    const clean = phone.toString().replace(/\D/g, "");
const finalNumber = clean.startsWith("91") ? clean : `91${clean}`;
const number = `${finalNumber}@c.us`;

    // Check if registered
    const isRegistered = await client.isRegisteredUser(number);

    if (!isRegistered) {
      error("❌ Not on WhatsApp:", phone);
      return { success: false, error: "not_whatsapp" };
    }

    // Send message
    await client.sendMessage(
      number,
`🔐 HostelNode OTP

Your OTP is: ${otp}

Valid for 5 minutes.

https://hostelnode.com`
    );

    log("✅ OTP sent:", phone);
    return { success: true };

  } catch (err) {
    error("❌ OTP send error:", err.message);

    // auto recover if browser crashed
    if (err.message.includes("Execution context destroyed")) {
      restartWhatsApp("Execution context destroyed");
    }

    return { success: false, error: err.message };
  }
};
// 
const sendOwnerEnquiryMessage = async (phone, data) => {
  try {
    if (!isInitialized || !client) {
      error("⏳ WhatsApp not ready");
      return;
    }

    // const finalNumber = formatNumber(phone);
    // const number = `${finalNumber}@c.us`;
      const clean = phone.toString().replace(/\D/g, "");
const finalNumber = clean.startsWith("91") ? clean : `91${clean}`;
const number = `${finalNumber}@c.us`;

    const isRegistered = await client.isRegisteredUser(number);

    if (!isRegistered) {
      error("❌ Owner not on WhatsApp:", phone);
      return;
    }

    const text = `🏠 *New Enquiry*

👤 ${data.studentName}
📞 ${data.studentPhone}

🏢 ${data.hostelName}
🛏 ${data.roomType || "N/A"}
📅 ${data.moveIn || "N/A"}

💬 ${data.message || "No message"}

👉 Chat:
https://wa.me/${data.studentPhone}`;

    await client.sendMessage(number, text);

    log("✅ Sent to owner:", phone);

  } catch (err) {
    error("❌ Send error:", err.message);

    if (err.message.includes("Execution context destroyed")) {
      restartWhatsApp("Execution context destroyed");
    }
  }
};

// ================= EXPORT =================
module.exports = {
  sendWhatsAppOTP,
  sendOwnerEnquiryMessage   // ✅ ADD THIS
};