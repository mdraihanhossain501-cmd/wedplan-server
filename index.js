import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import { verifyJWT } from "./middleware/auth.js";
import servicesRouter from "./routes/services.js";
import bookingsRouter from "./routes/bookings.js";
import adminRouter from "./routes/admin.js";
import statsRouter from "./routes/stats.js";
import paymentsRouter from "./routes/payments.js";
import { stripeWebhook } from "./routes/stripeWebhook.js";

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Make sure the database is connected before any request is handled.
// This matters on serverless hosting, where instances start on demand.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    res.status(500).json({ message: "Database connection failed" });
  }
});

// Stripe needs the raw body to verify the signature, so this route must be
// registered BEFORE express.json().
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "WedPlan server is running" });
});

// Returns the logged-in user (role and status come from the database).
app.get("/api/me", verifyJWT, (req, res) => {
  res.json({ user: req.user });
});

app.use("/api/services", servicesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/stats", statsRouter);
app.use("/api/payments", paymentsRouter);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

// Locally we listen on a port. On Vercel the exported app runs as a function.
if (!process.env.VERCEL) {
  connectDB()
    .then(() => {
      app.listen(port, () => {
        console.log(`WedPlan server listening on port ${port}`);
      });
    })
    .catch((error) => {
      console.error("MongoDB connection failed:", error.message);
      process.exit(1);
    });
}

export default app;