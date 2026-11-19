import "dotenv/config";
import { MongoClient } from "mongodb";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error("Usage: npm run make-admin -- user@example.com");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const users = client.db(process.env.DB_NAME || "wedplan").collection("users");
  const result = await users.updateOne(
    { email },
    { $set: { role: "admin", isBlocked: false } }
  );

  if (result.matchedCount === 0) {
    console.error(`No user found with email ${email}. Sign up first.`);
  } else {
    console.log(`${email} is now an admin.`);
  }
} finally {
  await client.close();
}