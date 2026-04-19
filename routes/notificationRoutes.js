const router = require("express").Router();
const { auth } = require("../middleware/auth");
const Notification = require("../models/Notification");

// GET /api/notifications
// Fetch all notifications for the logged-in user
router.get("/", auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/:id/read
// Mark a single notification as read
router.patch("/:id/read", auth, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { read: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ error: "Notification not found." });
    res.json({ message: "Marked as read.", notif });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/notifications/read-all
// Mark all notifications as read
router.patch("/read-all", auth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
    res.json({ message: "All notifications marked as read." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;