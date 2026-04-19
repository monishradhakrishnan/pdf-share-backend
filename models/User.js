const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  password: String,
  role: { type: String, enum: ["user", "admin", "print_admin"], default: "user" },
}, { timestamps: true });

// Auto-assign print_admin role if email ends with @print.com
UserSchema.pre("save", function (next) {
  if (this.isNew && this.email && this.email.endsWith("@print.com")) {
    this.role = "print_admin";
  }
  next();
});

module.exports = mongoose.model("User", UserSchema);