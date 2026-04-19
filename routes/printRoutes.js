const router = require("express").Router();
const { auth, printAdminAuth } = require("../middleware/auth");
const PrintRequest = require("../models/PrintRequest");
const Notification = require("../models/Notification");
const PDF = require("../models/PDF");
const User = require("../models/User");
const Counter = require("../models/Counter");

// No pdf-parse needed — count pages by scanning raw buffer
const countPDFPages = (buffer) => {
  const str = buffer.toString("latin1");
  const matches = str.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
};

const RATE_BW    = 1;
const RATE_COLOR = 5;

// ── Helper: stream GridFS file to buffer ─────────────────────
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

// ── Helper: get page count from GridFS PDF ───────────────────
const getPDFPageCount = async (fileId) => {
  try {
    const { getBucket } = require("../config/db");
    const { ObjectId } = require("mongodb");
    const bucket = getBucket();
    const stream = bucket.openDownloadStream(new ObjectId(fileId));
    const buffer = await streamToBuffer(stream);
    const count = countPDFPages(buffer);
    console.log(`✅ Page count detected: ${count}`);
    return count;
  } catch (err) {
    console.error("❌ Page count error:", err.message);
    return 0;
  }
};

// ── Helper: global auto-incrementing order ID ────────────────
const getNextOrderId = async () => {
  const counter = await Counter.findByIdAndUpdate(
    "printRequest",
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `PRI-${String(counter.seq).padStart(4, "0")}`;
};

// GET /api/print/shops
router.get("/shops", auth, async (req, res) => {
  try {
    const shops = await User.find({ role: "print_admin" }).select("name email");
    const shopsWithCount = await Promise.all(
      shops.map(async (shop) => {
        const queueCount = await PrintRequest.countDocuments({
          printAdmin: shop._id,
          status: "pending",
        });
        return { _id: shop._id, name: shop.name, email: shop.email, queueCount };
      })
    );
    res.json(shopsWithCount);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/print/queue
router.get("/queue", auth, printAdminAuth, async (req, res) => {
  try {
    const queue = await PrintRequest.find({
      printAdmin: req.user.id,
      status: "pending",
    })
      .sort({ createdAt: 1 })
      .populate("sender", "name email")
      .populate("pdfId", "fileId originalName");
    res.json(queue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/print/bills
router.get("/bills", auth, printAdminAuth, async (req, res) => {
  try {
    const bills = await PrintRequest.find({
      printAdmin: req.user.id,
      status: "printed",
    })
      .sort({ updatedAt: -1 })
      .populate("sender", "name email");
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/print/my-requests
router.get("/my-requests", auth, async (req, res) => {
  try {
    const requests = await PrintRequest.find({ sender: req.user.id }).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/print/request
router.post("/request", auth, async (req, res) => {
  try {
    const { pdfId, copies, printAdminId, disappearAfterPrint, colorMode } = req.body;
    if (!pdfId || !copies || !printAdminId)
      return res.status(400).json({ error: "pdfId, copies, and printAdminId are required." });
    if (copies < 1) return res.status(400).json({ error: "Copies must be at least 1." });

    const pdf = await PDF.findById(pdfId);
    if (!pdf) return res.status(404).json({ error: "PDF not found." });

    const shop = await User.findOne({ _id: printAdminId, role: "print_admin" });
    if (!shop) return res.status(404).json({ error: "Print shop not found." });

    const pendingCount = await PrintRequest.countDocuments({
      printAdmin: printAdminId,
      status: "pending",
    });
    const queuePosition = pendingCount + 1;
    const orderId = await getNextOrderId();

    const pageCount = await getPDFPageCount(pdf.fileId);
    const mode = colorMode === "color" ? "color" : "bw";
    const rate = mode === "color" ? RATE_COLOR : RATE_BW;
    const billAmount = pageCount * copies * rate;

    const request = await PrintRequest.create({
      sender: req.user.id,
      senderName: req.user.name,
      pdfId: pdf._id,
      pdfName: pdf.originalName,
      copies,
      colorMode: mode,
      pageCount,
      billAmount,
      printAdmin: shop._id,
      printAdminName: shop.name,
      orderId,
      disappearAfterPrint: !!disappearAfterPrint,
      queuePosition,
    });

    res.status(201).json({ message: "Print request submitted.", request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/print/:id/print
router.patch("/:id/print", auth, printAdminAuth, async (req, res) => {
  try {
    const request = await PrintRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (request.status !== "pending")
      return res.status(400).json({ error: `Request is already ${request.status}.` });

    request.status = "printed";
    await request.save();

    if (request.disappearAfterPrint) {
      try {
        const { getBucket } = require("../config/db");
        const { ObjectId } = require("mongodb");
        const pdf = await PDF.findById(request.pdfId);
        if (pdf) {
          const bucket = getBucket();
          await bucket.delete(new ObjectId(pdf.fileId));
          await pdf.deleteOne();
        }
      } catch (delErr) {
        console.error("Could not delete PDF after print:", delErr.message);
      }
    }

    await Notification.create({
      userId: request.sender,
      message: `Your print request for "${request.pdfName}" (Order ${request.orderId}) has been printed. Bill: ₹${request.billAmount}.${request.disappearAfterPrint ? " The PDF has been removed from your library." : ""}`,
      type: "printed",
      printRequestId: request._id,
    });

    res.json({ message: "Marked as printed and sender notified.", billAmount: request.billAmount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/print/:id/reject
router.patch("/:id/reject", auth, printAdminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "Rejection reason is required." });

    const request = await PrintRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (request.status !== "pending")
      return res.status(400).json({ error: `Request is already ${request.status}.` });

    request.status = "rejected";
    request.rejectionReason = reason;
    await request.save();

    await Notification.create({
      userId: request.sender,
      message: `Your print request for "${request.pdfName}" (Order ${request.orderId}) was rejected. Reason: ${reason}`,
      type: "rejected",
      printRequestId: request._id,
    });

    res.json({ message: "Request rejected and sender notified." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;