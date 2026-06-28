// test-wa.js — run: node test-wa.js
require("dotenv").config();
const axios = require("axios");

const WA_TOKEN    = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const BASE_URL    = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;

async function test() {
  const payload = {
    messaging_product: "whatsapp",
    to: "917879884375",
    type: "template",
    template: {
      name: "hostelnode_welcome_login1",
      language: { code: "en" },
      components: [
        {
          type: "header",
          parameters: [{ type: "image", image: { link: "https://picsum.photos/800/400" } }]
        },
        {
          type: "body",
          parameters: [{ type: "text", text: "ketan" }]
        }
      ]
    }
  };

  console.log("Sending payload:\n", JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(BASE_URL, payload, {
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log("✅ Success:", res.data);
  } catch (err) {
    console.error("❌ Error:", JSON.stringify(err.response?.data, null, 2));
  }
}

test();