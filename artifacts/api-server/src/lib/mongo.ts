import mongoose from "mongoose";
import { logger } from "./logger.js";

let _connecting: Promise<typeof mongoose> | null = null;

/**
 * Lazy singleton MongoDB connection.
 * Throws if MONGO_URI is not set — callers must handle the error gracefully.
 */
export async function connectMongo(): Promise<typeof mongoose> {
  const uri = process.env["MONGO_URI"];
  if (!uri) throw new Error("MONGO_URI_MISSING");

  if (mongoose.connection.readyState === 1) return mongoose;

  if (!_connecting) {
    _connecting = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS:        10_000,
        socketTimeoutMS:         45_000,
      })
      .then((m) => {
        logger.info("[MongoDB] Connected");
        return m;
      })
      .catch((err: unknown) => {
        _connecting = null;
        logger.error({ err }, "[MongoDB] Connection failed");
        throw err;
      });
  }
  return _connecting;
}

/** Mongoose instance — import models after calling connectMongo() */
export { mongoose };
