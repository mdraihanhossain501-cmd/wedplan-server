import { Router } from "express";
import { db } from "../db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { isPremium } from "../utils/plan.js";

const router = Router();
const services = () => db.collection("services");
const bookings = () => db.collection("bookings");

router.get("/vendor", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const vendorId = req.user.id;

    const [
      totalServices,
      activeServices,
      pendingServices,
      pendingRequests,
      acceptedBookings,
    ] = await Promise.all([
      services().countDocuments({ vendorId }),
      services().countDocuments({
        vendorId,
        isActive: true,
        status: { $ne: "rejected" },
      }),
      services().countDocuments({ vendorId, status: "pending" }),
      bookings().countDocuments({ vendorId, status: "pending" }),
      bookings().countDocuments({ vendorId, status: "accepted" }),
    ]);

    res.json({
      stats: {
        totalServices,
        activeServices,
        pendingServices,
        pendingRequests,
        acceptedBookings,
        subscriptionPlan: isPremium(req.user) ? "premium" : "free",
        subscriptionExpiresAt: req.user.subscriptionExpiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/customer", verifyJWT, requireRole("customer"), async (req, res, next) => {
  try {
    const customerId = req.user.id;

    const [total, pending, accepted, rejected] = await Promise.all([
      bookings().countDocuments({ customerId }),
      bookings().countDocuments({ customerId, status: "pending" }),
      bookings().countDocuments({ customerId, status: "accepted" }),
      bookings().countDocuments({ customerId, status: "rejected" }),
    ]);

    res.json({ stats: { total, pending, accepted, rejected } });
  } catch (error) {
    next(error);
  }
});

export default router;