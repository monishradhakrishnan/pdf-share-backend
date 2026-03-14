const mongoose = require("mongoose");
// Save this block as: models/PDF.js
const PDFSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  fileId: mongoose.Schema.Types.ObjectId,
  size: Number,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  uploaderName: String,
  sharedWith: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date, default: null },
  }],
}, { timestamps: true });

module.exports = mongoose.model("PDF", PDFSchema);
