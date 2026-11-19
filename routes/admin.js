import { Router } from "express";
import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { verifyJWT, requireRole, toIdFilter } from "../middleware/auth.js";
import { CATEGORIES } from "../constants.js";
import { vendorStages } from "./services.js";

const router = Router();

// Every route in this file is admin-only.
router.use(verifyJWT, requireRole("admin"));

const users = () => db.collection("users");
const services = () => db.collection("services");
const bookings = () => db.collection("bookings");
const transactions = () => db.collection("transactions");

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function paging(query, defaultLimit = 10) {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || defaultLimit, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

const userProjection = {
  name: 1,
  email: 1,
  image: 1,
  role: 1,
  isBlocked: 1,
  businessName: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
  createdAt: 1,
};

// ---------- Users ----------

router.get("/users", async (req, res, next) => {
  try {
    const { search, role } = req.query;
    const { page, limit, skip } = paging(req.query);

    const filter = {};
    if (["admin", "vendor", "customer"].includes(String(role))) {
      filter.role = String(role);
    }
    if (search) {
      const regex = { $regex: escapeRegex(String(search)), $options: "i" };
      filter.$or = [{ name: regex }, { email: regex }];
    }

    const [list, total] = await Promise.all([
      users()
        .find(filter, { projection: userProjection })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      users().countDocuments(filter),
    ]);

    res.json({ users: list, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
});

router.get("/users/:id", async (req, res, next) => {
  try {
    const user = await users().findOne(toIdFilter(req.params.id), {
      projection: userProjection,
    });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const id = user._id.toString();
    const [serviceCount, bookingsMade, bookingsReceived] = await Promise.all([
      services().countDocuments({ vendorId: id }),
      bookings().countDocuments({ customerId: id }),
      bookings().countDocuments({ vendorId: id }),
    ]);

    res.json({ user, stats: { serviceCount, bookingsMade, bookingsReceived } });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id/block", async (req, res, next) => {
  try {
    if (typeof req.body.isBlocked !== "boolean") {
      return res.status(400).json({ message: "isBlocked must be true or false" });
    }

    const user = await users().findOne(toIdFilter(req.params.id));
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ message: "You cannot block your own account" });
    }
    if (user.role === "admin") {
      return res.status(403).json({ message: "Admin accounts cannot be blocked" });
    }

    await users().updateOne(
      { _id: user._id },
      { $set: { isBlocked: req.body.isBlocked, updatedAt: new Date() } }
    );

    // Log the user out everywhere when blocking.
    if (req.body.isBlocked) {
      await db
        .collection("session")
        .deleteMany({ userId: { $in: [user._id, user._id.toString()] } });
    }

    res.json({
      message: req.body.isBlocked ? "User blocked" : "User unblocked",
    });
  } catch (error) {
    next(error);
  }
});

// ---------- Services ----------

router.get("/services", async (req, res, next) => {
  try {
    const { search, status, category } = req.query;
    const { page, limit, skip } = paging(req.query);

    const match = {};
    if (search) {
      match.serviceName = {
        $regex: escapeRegex(String(search)),
        $options: "i",
      };
    }
    if (["pending", "approved", "rejected"].includes(String(status))) {
      match.status = String(status);
    }
    if (CATEGORIES.includes(String(category))) {
      match.category = String(category);
    }

    const [result] = await services()
      .aggregate([
        { $match: match },
        ...vendorStages(),
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            items: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const total = result.total[0]?.count ?? 0;
    res.json({
      services: result.items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/services/:id/status", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid service ID" });
    }
    const { status } = req.body;
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be pending, approved or rejected" });
    }

    const result = await services().updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Service not found" });
    }

    res.json({ message: `Service ${status}` });
  } catch (error) {
    next(error);
  }
});

router.delete("/services/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid service ID" });
    }
    const result = await services().deleteOne({
      _id: new ObjectId(req.params.id),
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Service not found" });
    }
    res.json({ message: "Service deleted" });
  } catch (error) {
    next(error);
  }
});

// ---------- Transactions (read-only on purpose) ----------

router.get("/transactions", async (req, res, next) => {
  try {
    const { page, limit, skip } = paging(req.query);

    const [result] = await transactions()
      .aggregate([
        { $sort: { createdAt: -1 } },
        {
          $lookup: {
            from: "users",
            let: { vid: "$vendorId" },
            pipeline: [
              { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$vid"] } } },
              { $project: { name: 1, email: 1, image: 1, businessName: 1 } },
            ],
            as: "vendor",
          },
        },
        { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
        {
          $facet: {
            items: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const total = result.total[0]?.count ?? 0;
    res.json({
      transactions: result.items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
});

// ---------- Overview ----------

router.get("/stats", async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalServices,
      pendingServices,
      totalTransactions,
      servicesByCategory,
      bookingsByStatus,
    ] = await Promise.all([
      users().countDocuments(),
      users().countDocuments({ role: "vendor" }),
      users().countDocuments({ role: "customer" }),
      services().countDocuments(),
      services().countDocuments({ status: "pending" }),
      transactions().countDocuments(),
      services()
        .aggregate([
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $project: { _id: 0, category: "$_id", count: 1 } },
        ])
        .toArray(),
      bookings()
        .aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
          { $project: { _id: 0, status: "$_id", count: 1 } },
        ])
        .toArray(),
    ]);

    res.json({
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalServices,
        pendingServices,
        totalTransactions,
      },
      servicesByCategory,
      bookingsByStatus,
    });
  } catch (error) {
    next(error);
  }
});

export default router;