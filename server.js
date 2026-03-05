require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const morgan = require("morgan");
const multer = require("multer");
const { GridFSBucket, ObjectId } = require("mongodb");

const app = express();
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(morgan("dev"));

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/chatappdb";
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const PORT = process.env.PORT || 5000;

// ─── DB Connection ────────────────────────────────────────────
let bucket;
mongoose.connect(MONGO_URI).then(() => {
  console.log("MongoDB connected to:", mongoose.connection.db.databaseName);
  bucket = new GridFSBucket(mongoose.connection.db, { bucketName: "pdfs" });
});

// ─── Models ───────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  password: String,
}, { timestamps: true });
const User = mongoose.model("User", UserSchema);

const PDFSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  fileId: mongoose.Schema.Types.ObjectId,
  size: Number,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  uploaderName: String,
  sharedWith: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      expiresAt: { type: Date, default: null },
    }
  ],
}, { timestamps: true });
const PDF = mongoose.model("PDF", PDFSchema);

// ─── Multer (memory storage) ──────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  },
});

// ─── Auth Middleware ──────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ─── Auth Routes ──────────────────────────────────────────────

// POST /api/auth/signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields required" });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already in use" });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hash });
    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid password" });
    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PDF Routes ───────────────────────────────────────────────

// POST /api/pdfs/upload
app.post("/api/pdfs/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF file received" });
    const cleanName = decodeURIComponent(req.file.originalname);
    const filename = `${Date.now()}-${cleanName}`;
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: "application/pdf",
    });
    uploadStream.end(req.file.buffer);
    uploadStream.on("error", (err) => {
      console.error("GridFS upload error:", err);
      res.status(500).json({ error: "Failed to save file to GridFS" });
    });
    uploadStream.on("finish", async () => {
      try {
        const pdf = await PDF.create({
          filename,
          originalName: cleanName,
          fileId: uploadStream.id,
          size: req.file.size,
          uploadedBy: req.user.id,
          uploaderName: req.user.name,
        });
        console.log("PDF saved:", pdf._id);
        res.json({ message: "Uploaded successfully", pdf });
      } catch (err) {
        console.error("DB save error:", err);
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs — list only my uploads
app.get("/api/pdfs", auth, async (req, res) => {
  try {
    const pdfs = await PDF.find({ uploadedBy: req.user.id }).sort({ createdAt: -1 });
    res.json(pdfs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs/shared/with-me — must be BEFORE /:id
app.get("/api/pdfs/shared/with-me", auth, async (req, res) => {
  try {
    const now = new Date();
    const userId = new ObjectId(req.user.id);
    const pdfs = await PDF.find({
      sharedWith: {
        $elemMatch: {
          userId: userId,
          $or: [
            { expiresAt: null },
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } },
          ],
        },
      },
    }).sort({ createdAt: -1 });

    const result = pdfs.map((pdf) => {
      const share = pdf.sharedWith.find(
        (s) => s && s.userId && s.userId.toString() === req.user.id
      );
      const obj = pdf.toObject();
      obj.expiresAt = share && share.expiresAt ? share.expiresAt : null;
      return obj;
    });
    res.json(result);
  } catch (err) {
    console.error("shared/with-me error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs/:id — metadata
app.get("/api/pdfs/:id", auth, async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "Not found" });
    res.json(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs/:id/download — stream PDF
app.get("/api/pdfs/:id/download", (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, auth, async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "Not found" });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="${pdf.originalName}"`);
    const stream = bucket.openDownloadStream(new ObjectId(pdf.fileId));
    stream.on("error", () => res.status(404).json({ error: "File not found in GridFS" }));
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pdfs/:id/shared — remove myself from sharedWith
app.delete("/api/pdfs/:id/shared", auth, async (req, res) => {
  try {
    const result = await PDF.findByIdAndUpdate(
      req.params.id,
      { $pull: { sharedWith: { userId: new ObjectId(req.user.id) } } },
      { new: true }
    );
    if (!result) return res.status(404).json({ error: "PDF not found" });
    console.log("Removed user from sharedWith, remaining:", result.sharedWith.length);
    res.json({ message: "Removed from your shared list" });
  } catch (err) {
    console.error("Remove shared error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pdfs/:id — delete PDF (owner only)
app.delete("/api/pdfs/:id", auth, async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "Not found" });
    if (pdf.uploadedBy.toString() !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });
    await bucket.delete(new ObjectId(pdf.fileId));
    await pdf.deleteOne();
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User Routes ──────────────────────────────────────────────

// GET /api/users/search?email=xyz
app.get("/api/users/search", auth, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email query required" });
    const users = await User.find({
      email: { $regex: email, $options: "i" },
      _id: { $ne: new ObjectId(req.user.id) },
    }).select("name email");
    console.log("Search results for", email, ":", users.length, "users found");
    res.json(users);
  } catch (err) {
    console.log("Search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Share Routes ─────────────────────────────────────────────

// POST /api/pdfs/:id/share
app.post("/api/pdfs/:id/share", auth, async (req, res) => {
  try {
    console.log("Share request body:", req.body);
    const { userId, expiryMinutes } = req.body;
    console.log("userId:", userId, "| expiryMinutes:", expiryMinutes, "| type:", typeof expiryMinutes);

    if (!userId) return res.status(400).json({ error: "userId required" });

    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "PDF not found" });
    if (pdf.uploadedBy.toString() !== req.user.id)
      return res.status(403).json({ error: "Only the owner can share this PDF" });

    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ error: "User not found" });

    const freshPdf = await PDF.findById(req.params.id);
    const alreadyShared = freshPdf.sharedWith.find(
      (s) => s && s.userId && s.userId.toString() === userId.toString()
    );
    if (alreadyShared)
      return res.status(409).json({ error: "Already shared with this user" });

    const mins = (expiryMinutes !== null && expiryMinutes !== undefined)
      ? Number(expiryMinutes)
      : null;

    const expiresAt = (mins && !isNaN(mins) && mins > 0)
      ? new Date(Date.now() + mins * 60 * 1000)
      : null;

    console.log("Parsed mins:", mins, "| Calculated expiresAt:", expiresAt);

    freshPdf.sharedWith.push({ userId: new ObjectId(userId), expiresAt });
    await freshPdf.save();
    console.log("Saved sharedWith:", JSON.stringify(freshPdf.sharedWith));

    const expiryMsg = expiresAt
      ? `Expires at ${expiresAt.toLocaleString()}`
      : "No expiry";
    res.json({ message: `Shared with ${target.name}. ${expiryMsg}` });
  } catch (err) {
    console.error("Share error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Health Check ─────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ─── Keep Alive (for Render free tier) ───────────────────────
const http = require("http");
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
setInterval(() => {
  http.get(`${BACKEND_URL}/api/health`, () => {}).on("error", () => {});
}, 14 * 60 * 1000);

// ─── Start Server ─────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));