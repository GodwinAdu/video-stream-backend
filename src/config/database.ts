import mongoose from 'mongoose'

import dotenv from 'dotenv'
dotenv.config()

// Check if MONGODB_URI is loaded
if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined in .env file!");
  process.exit(1);
}

const MONGODB_URL = process.env.MONGODB_URI!;
const MAX_RETRIES = 5; // Maximum number of retries
const RETRY_DELAY = 2000; // Initial retry delay in milliseconds
export const connectDatabase = async (retries = 0): Promise<void> => {
  try {
    console.log("Attempting to connect to MongoDB...");
    console.log("MongoDB URL:", MONGODB_URL.substring(0, 20) + "...");
    await mongoose.connect(MONGODB_URL, { dbName: "VideoStream" });
    console.log("✅ MongoDB connected successfully!");
    console.log("Mongoose connection status:", mongoose.connection.readyState);
    console.log("Database name:", mongoose.connection.db?.databaseName);

  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error);
    if (retries < MAX_RETRIES) {
      const delay = RETRY_DELAY * Math.pow(2, retries); // Exponential backoff
      console.log(`🔄 Retrying in ${delay / 1000} seconds... (${retries + 1}/${MAX_RETRIES})`);
      setTimeout(() => connectDatabase(retries + 1), delay);
    } else {
      console.error("🚨 Maximum retry attempts reached. Exiting...");
      process.exit(1);
    }
  }
}

mongoose.connection.on("disconnected", () => {
  console.log("📡 MongoDB disconnected")
})

mongoose.connection.on("error", (error) => {
  console.error("❌ MongoDB error:", error)
})

