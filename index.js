import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import { verifyJWT } from "./middleware/auth.js";
import servicesRouter from "./routes/services.js";
import bookingsRouter from "./routes/bookings.js";
import adminRouter from "./routes/admin.js";
import statsRouter from "./routes/stats.js";

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
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

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

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