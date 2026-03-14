const mongoose = require("mongoose");
// Save this block as: models/AccessRequest.js
const AccessRequestSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  about:    { type: String, required: true, trim: true },
  status:   { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
}, { timestamps: true });

module.exports = mongoose.model("AccessRequest", AccessRequestSchema);
