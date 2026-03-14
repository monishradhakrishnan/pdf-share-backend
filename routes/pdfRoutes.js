const router = require("express").Router();
const multer = require("multer");
const { ObjectId } = require("mongodb");
const { auth } = require("../middleware/auth");
const { getBucket } = require("../config/db");
const PDF = require("../models/PDF");
const User = require("../models/User");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  },
});

// POST /api/pdfs/upload
router.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF file received" });
    const bucket = getBucket();
    const cleanName = decodeURIComponent(req.file.originalname);
    const filename = `${Date.now()}-${cleanName}`;
    const uploadStream = bucket.openUploadStream(filename, { contentType: "application/pdf" });
    uploadStream.end(req.file.buffer);
    uploadStream.on("error", (err) => {
      console.error("GridFS upload error:", err);
      res.status(500).json({ error: "Failed to save file to GridFS" });
    });
    uploadStream.on("finish", async () => {
      try {
        const pdf = await PDF.create({
          filename, originalName: cleanName,
          fileId: uploadStream.id, size: req.file.size,
          uploadedBy: req.user.id, uploaderName: req.user.name,
        });
        res.json({ message: "Uploaded successfully", pdf });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs
router.get("/", auth, async (req, res) => {
  try {
    const pdfs = await PDF.find({ uploadedBy: req.user.id }).sort({ createdAt: -1 });
    res.json(pdfs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs/shared/with-me
router.get("/shared/with-me", auth, async (req, res) => {
  try {
    const now = new Date();
    const userId = new ObjectId(req.user.id);
    const pdfs = await PDF.find({
      sharedWith: {
        $elemMatch: {
          userId,
          $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
        },
      },
    }).sort({ createdAt: -1 });
    const result = pdfs.map((pdf) => {
      const share = pdf.sharedWith.find((s) => s?.userId?.toString() === req.user.id);
      const obj = pdf.toObject();
      obj.expiresAt = share?.expiresAt || null;
      return obj;
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs/:id
router.get("/:id", auth, async (req, res) => {
  try {
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "Not found" });
    res.json(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdfs/:id/download
router.get("/:id/download", (req, res, next) => {
  if (!req.headers.authorization && req.query.token)
    req.headers.authorization = `Bearer ${req.query.token}`;
  next();
}, auth, async (req, res) => {
  try {
    const bucket = getBucket();
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

// POST /api/pdfs/:id/share
router.post("/:id/share", auth, async (req, res) => {
  try {
    const { userId, expiryMinutes } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const pdf = await PDF.findById(req.params.id);
    if (!pdf) return res.status(404).json({ error: "PDF not found" });
    if (pdf.uploadedBy.toString() !== req.user.id)
      return res.status(403).json({ error: "Only the owner can share this PDF" });
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ error: "User not found" });
    const freshPdf = await PDF.findById(req.params.id);
    const alreadyShared = freshPdf.sharedWith.find(
      (s) => s?.userId?.toString() === userId.toString()
    );
    if (alreadyShared) return res.status(409).json({ error: "Already shared with this user" });
    const mins = expiryMinutes != null ? Number(expiryMinutes) : null;
    const expiresAt = mins && !isNaN(mins) && mins > 0
      ? new Date(Date.now() + mins * 60 * 1000) : null;
    freshPdf.sharedWith.push({ userId: new ObjectId(userId), expiresAt });
    await freshPdf.save();
    const expiryMsg = expiresAt ? `Expires at ${expiresAt.toLocaleString()}` : "No expiry";
    res.json({ message: `Shared with ${target.name}. ${expiryMsg}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pdfs/:id/shared
router.delete("/:id/shared", auth, async (req, res) => {
  try {
    const result = await PDF.findByIdAndUpdate(
      req.params.id,
      { $pull: { sharedWith: { userId: new ObjectId(req.user.id) } } },
      { new: true }
    );
    if (!result) return res.status(404).json({ error: "PDF not found" });
    res.json({ message: "Removed from your shared list" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pdfs/:id
router.delete("/:id", auth, async (req, res) => {
  try {
    const bucket = getBucket();
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

module.exports = router;