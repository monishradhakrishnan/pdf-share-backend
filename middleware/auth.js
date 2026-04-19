const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

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

const adminAuth = (req, res, next) => {
  if (!req.user || req.user.role !== "admin")
    return res.status(403).json({ error: "Admins only." });
  next();
};

// Always verify role from DB so stale JWT tokens don't block access
const User = require("../models/User");
const printAdminAuth = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("role");
    if (!user || user.role !== "print_admin")
      return res.status(403).json({ error: "Print admins only." });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { auth, adminAuth, printAdminAuth };