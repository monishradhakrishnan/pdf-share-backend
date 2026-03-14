const router = require("express").Router();
const { ObjectId } = require("mongodb");
const { auth } = require("../middleware/auth");
const User = require("../models/User");

// GET /api/users/search
router.get("/search", auth, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email query required" });
    const users = await User.find({
      email: { $regex: email, $options: "i" },
      _id: { $ne: new ObjectId(req.user.id) },
    }).select("name email");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;