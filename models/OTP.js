const mongoose = require("mongoose");
// Save this block as: models/OTP.js
const OTPSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true },
  otp:       { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

module.exports = mongoose.model("OTP", OTPSchema);