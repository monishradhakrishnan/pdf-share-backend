const mongoose = require("mongoose");

const PrintRequestSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  senderName: { type: String, required: true },
  pdfId: { type: mongoose.Schema.Types.ObjectId, ref: "PDF", required: true },
  pdfName: { type: String, required: true },
  copies: { type: Number, required: true, min: 1 },
  colorMode: { type: String, enum: ["bw", "color"], default: "bw" },
  pageCount: { type: Number, default: 0 },
  billAmount: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "printed", "rejected"], default: "pending" },
  rejectionReason: { type: String, default: null },
  printAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  printAdminName: { type: String },
  orderId: { type: String, unique: true },
  disappearAfterPrint: { type: Boolean, default: false },
  queuePosition: { type: Number },
}, { timestamps: true });

module.exports = mongoose.model("PrintRequest", PrintRequestSchema);