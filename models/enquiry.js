const mongoose = require("mongoose");

const enquirySchema = new mongoose.Schema({

  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true
  },

  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Listing",
    required: true
  },

  hostelName: String,

  roomType: String,

  contactMethod: {
    type: String,
    enum: ["call", "whatsapp", "visit"]
  },

  preferredDate: Date,

  moveIn: String,

  message: String,

  status: {
    type: String,
    enum: ["New", "Contacted", "Closed"],
    default: "New"
  }

}, { timestamps: true });

module.exports = mongoose.model("Enquiry", enquirySchema);