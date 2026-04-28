 const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const adminSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
  password: { type: String, required: true },
  address:  { type: String, trim: true },
  profileImage: { type: String, default: null },
  role: { type: String, default: "SuperAdmin" },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date, default: null },
  loginHistory: [{
    ip:        String,
    userAgent: String,
    time:      { type: Date, default: Date.now }
  }]
}, { timestamps: true });

adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

adminSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model("Admin", adminSchema);