const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { auth, adminAuth } = require("../middleware/auth");
const User = require("../models/User");
const AccessRequest = require("../models/AccessRequest");
const OTP = require("../models/OTP");
const mailer = require("../utils/mailer");
const { sendApprovalEmail, sendRejectionEmail } = require("../utils/emailTemplates");

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields required" });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already in use" });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash });
    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: "7d" }
    );
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid password" });
    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: "7d" }
    );
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/request-access
router.post("/request-access", async (req, res) => {
  try {
    const { name, email, password, about } = req.body;
    if (!name || !email || !password || !about)
      return res.status(400).json({ error: "All fields required." });
    const existing = await AccessRequest.findOne({ email, status: "pending" });
    if (existing)
      return res.status(409).json({ error: "A pending request already exists for this email." });
    const hashed = await bcrypt.hash(password, 10);
    const request = await AccessRequest.create({ name, email, password: hashed, about });
    res.status(201).json({ message: "Request submitted successfully.", request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify-password
router.post("/verify-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required." });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: "User not found." });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Incorrect password." });
    res.json({ message: "Password verified." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/send-otp
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: "No account found with this email." });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await OTP.deleteMany({ email });
    await OTP.create({ email, otp, expiresAt });
    await mailer.sendMail({
      from: `"PDF Share" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "🔐 Your PDF Share OTP",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#4F46E5">Password Reset OTP</h2>
          <p>Your one-time password is:</p>
          <div style="background:#f3f4f6;padding:16px 24px;border-radius:8px;font-size:32px;font-weight:bold;letter-spacing:6px;text-align:center">
            ${otp}
          </div>
          <p style="color:#6b7280;font-size:13px;margin-top:16px">
            This OTP expires in <strong>10 minutes</strong>. Do not share it with anyone.
          </p>
          <p>— The PDF Share Team</p>
        </div>
      `,
    });
    res.json({ message: "OTP sent to your email." });
  } catch (err) {
    console.error("Send OTP error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/change-password
router.post("/change-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
      return res.status(400).json({ error: "All fields are required." });
    if (newPassword.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    const record = await OTP.findOne({ email });
    if (!record) return res.status(400).json({ error: "No OTP found. Please request a new one." });
    if (record.otp !== otp) return res.status(400).json({ error: "Invalid OTP." });
    if (new Date() > record.expiresAt)
      return res.status(400).json({ error: "OTP has expired. Please request a new one." });
    const hashed = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ email }, { password: hashed });
    await OTP.deleteMany({ email });
    res.json({ message: "Password changed successfully." });
  } catch (err) {
    console.error("Change password error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/access-requests
router.get("/access-requests", auth, adminAuth, async (req, res) => {
  try {
    const requests = await AccessRequest.find().sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/access-requests/:id/approve
router.post("/access-requests/:id/approve", auth, adminAuth, async (req, res) => {
  try {
    const request = await AccessRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (request.status !== "pending")
      return res.status(400).json({ error: `Request is already ${request.status}.` });
    await User.create({ name: request.name, email: request.email, password: request.password, role: "user" });
    request.status = "approved";
    await request.save();
    await sendApprovalEmail(request.email, request.name);
    res.json({ message: "User approved and notified via email." });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: "A user with this email already exists." });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/access-requests/:id/reject
router.post("/access-requests/:id/reject", auth, adminAuth, async (req, res) => {
  try {
    const request = await AccessRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (request.status !== "pending")
      return res.status(400).json({ error: `Request is already ${request.status}.` });
    request.status = "rejected";
    await request.save();
    await sendRejectionEmail(request.email, request.name);
    res.json({ message: "Request rejected and user notified." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;