import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { db } from "../db.js";

const AUTH_URL = process.env.AUTH_URL;

let jwks;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));
  }
  return jwks;
}

// Better Auth may store ids as ObjectId or as strings, so match both.
export function toIdFilter(id) {
  return ObjectId.isValid(id)
    ? { _id: { $in: [new ObjectId(id), id] } }
    : { _id: id };
}

export async function verifyJWT(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required" });
  }

  let payload;
  try {
    const result = await jwtVerify(header.slice(7), getJwks(), {
      issuer: AUTH_URL,
      audience: AUTH_URL,
    });
    payload = result.payload;
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const userId = payload.id ?? payload.sub;
    const user = await db.collection("users").findOne(toIdFilter(userId));

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked" });
    }

    // Role and status always come from the database, never from the client.
    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      image: user.image || null,
      role: user.role || "customer",
      subscriptionPlan: user.subscriptionPlan || "free",
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "You do not have permission to access this resource" });
    }
    next();
  };
}