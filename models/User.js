const mongoose = require("mongoose");
// Save this block as: models/User.js

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  password: String,
  role: { type: String, enum: ["user", "admin"], default: "user" },
}, { timestamps: true });

module.exports = mongoose.model("User", UserSchema);