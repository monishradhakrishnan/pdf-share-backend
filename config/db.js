const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");

let bucket;

async function connectDB() {
  const MONGO_URI = process.env.MONGO_URI;
  console.log("MONGO_URI:", MONGO_URI ? "found ✅" : "MISSING ❌");

  if (!MONGO_URI) {
    console.error("ERROR: MONGO_URI environment variable is not set!");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected to:", mongoose.connection.db.databaseName);
  bucket = new GridFSBucket(mongoose.connection.db, { bucketName: "pdfs" });
}

const getBucket = () => bucket;

module.exports = connectDB;
module.exports.getBucket = getBucket;