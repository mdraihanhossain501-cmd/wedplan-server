import "dotenv/config";
import { MongoClient, ServerApiVersion } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

export const db = client.db(process.env.DB_NAME || "wedplan");

// The connection promise is cached, so calling this many times is safe.
let connecting = null;

export function connectDB() {
  if (!connecting) {
    connecting = client
      .connect()
      .then(() => db.command({ ping: 1 }))
      .then(() => console.log("Connected to MongoDB"))
      .catch((error) => {
        connecting = null;
        throw error;
      });
  }
  return connecting;
}