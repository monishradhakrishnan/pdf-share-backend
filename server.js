require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const pdfRoutes = require("./routes/pdfRoutes");
const userRoutes = require("./routes/userRoutes");
const printRoutes = require("./routes/printRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));
app.options("*", cors());
app.use(morgan("dev"));

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/pdfs", pdfRoutes);
app.use("/api/users", userRoutes);
app.use("/api/print", printRoutes);
app.use("/api/notifications", notificationRoutes);
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ─── Keep Alive ───────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
setInterval(() => {
  http.get(`${BACKEND_URL}/api/health`, () => {}).on("error", () => {});
}, 14 * 60 * 1000);

// ─── Start ────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});