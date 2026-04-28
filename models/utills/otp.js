// utils/otp.js

const otpStore = new Map();

// Dummy send OTP (replace later with WhatsApp/SMS)
const sendOtp = async (phone, otp) => {
  console.log(`📱 OTP sent to ${phone}: ${otp}`);
};

module.exports = {
  otpStore,
  sendOtp
};