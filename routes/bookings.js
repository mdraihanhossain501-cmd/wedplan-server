import { Router } from "express";
import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";

const router = Router();
const bookings = () => db.collection("bookings");
const services = () => db.collection("services");

const STATUSES = ["pending", "accepted", "rejected", "cancelled"];

// Accepts "YYYY-MM-DD" and returns a Date at UTC midnight, or null.
function parseEventDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(value)) {
    return null;
  }
  return date;
}

function userLookup(localField, as) {
  return [
    {
      $lookup: {
        from: "users",
        let: { uid: `$${localField}` },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$uid"] } } },
          { $project: { name: 1, email: 1, image: 1, businessName: 1 } },
        ],
        as,
      },
    },
    { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } },
  ];
}

// Adds service, vendor and customer info to each booking.
const detailStages = [
  {
    $lookup: {
      from: "services",
      localField: "serviceId",
      foreignField: "_id",
      as: "service",
    },
  },
  { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      service: {
        _id: "$service._id",
        serviceName: "$service.serviceName",
        category: "$service.category",
        price: "$service.price",
        location: "$service.location",
        image: { $arrayElemAt: ["$service.images", 0] },
      },
    },
  },
  ...userLookup("vendorId", "vendor"),
  ...userLookup("customerId", "customer"),
];

function listFilter(base, status) {
  const filter = { ...base };
  if (status && STATUSES.includes(String(status))) {
    filter.status = String(status);
  }
  return filter;
}

// ---------- Create ----------

router.post("/", verifyJWT, async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      return res
        .status(403)
        .json({ message: "Admins cannot submit booking requests" });
    }

    const { serviceId } = req.body;
    if (!ObjectId.isValid(serviceId)) {
      return res.status(400).json({ message: "Invalid service ID" });
    }

    const eventDate = parseEventDate(req.body.eventDate);
    if (!eventDate) {
      return res.status(400).json({ message: "Please choose a valid event date" });
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (eventDate < today) {
      return res.status(400).json({ message: "Event date cannot be in the past" });
    }

    const eventLocation = String(req.body.eventLocation ?? "").trim();
    if (eventLocation.length < 3 || eventLocation.length > 150) {
      return res
        .status(400)
        .json({ message: "Event location must be 3 to 150 characters" });
    }

    const message = String(req.body.message ?? "").trim();
    if (message.length > 500) {
      return res
        .status(400)
        .json({ message: "Message must be 500 characters or fewer" });
    }

    const service = await services().findOne({ _id: new ObjectId(serviceId) });
    if (!service || service.status !== "approved" || !service.isActive) {
      return res
        .status(404)
        .json({ message: "This service is not available for booking" });
    }
    if (service.vendorId === req.user.id) {
      return res.status(403).json({ message: "You cannot book your own service" });
    }

    const duplicate = await bookings().findOne({
      serviceId: service._id,
      customerId: req.user.id,
      eventDate,
      status: { $in: ["pending", "accepted"] },
    });
    if (duplicate) {
      return res.status(409).json({
        message: "You already have an active booking request for this service on that date",
      });
    }

    const now = new Date();
    const doc = {
      serviceId: service._id,
      vendorId: service.vendorId, // always taken from the service, never from the client
      customerId: req.user.id,
      eventDate,
      eventLocation,
      message,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    const result = await bookings().insertOne(doc);

    res.status(201).json({
      message: "Booking request sent to the vendor",
      booking: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    next(error);
  }
});

// ---------- Lists (keep these above "/:id") ----------

router.get("/mine", verifyJWT, requireRole("customer", "vendor"), async (req, res, next) => {
  try {
    const list = await bookings()
      .aggregate([
        { $match: listFilter({ customerId: req.user.id }, req.query.status) },
        { $sort: { createdAt: -1 } },
        ...detailStages,
      ])
      .toArray();
    res.json({ bookings: list });
  } catch (error) {
    next(error);
  }
});

router.get("/vendor", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const list = await bookings()
      .aggregate([
        { $match: listFilter({ vendorId: req.user.id }, req.query.status) },
        { $sort: { createdAt: -1 } },
        ...detailStages,
      ])
      .toArray();
    res.json({ bookings: list });
  } catch (error) {
    next(error);
  }
});

// ---------- Details ----------

router.get("/:id", verifyJWT, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }

    const [booking] = await bookings()
      .aggregate([{ $match: { _id: new ObjectId(req.params.id) } }, ...detailStages])
      .toArray();

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const isParticipant =
      booking.customerId === req.user.id || booking.vendorId === req.user.id;
    if (!isParticipant && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "You do not have access to this booking" });
    }

    res.json({ booking });
  } catch (error) {
    next(error);
  }
});

// ---------- Vendor: accept or reject ----------

router.patch("/:id/respond", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }
    const { status } = req.body;
    if (!["accepted", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be accepted or rejected" });
    }
    const _id = new ObjectId(req.params.id);

    const booking = await bookings().findOne({ _id });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if (booking.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only manage requests for your own services" });
    }
    if (booking.status !== "pending") {
      return res
        .status(409)
        .json({ message: `This request is already ${booking.status}` });
    }

    // The status filter makes this safe even if two clicks arrive together.
    const result = await bookings().updateOne(
      { _id, status: "pending" },
      { $set: { status, updatedAt: new Date() } }
    );
    if (result.modifiedCount === 0) {
      return res
        .status(409)
        .json({ message: "This request has already been processed" });
    }

    res.json({ message: `Booking ${status}` });
  } catch (error) {
    next(error);
  }
});

// ---------- Customer: cancel ----------

router.patch("/:id/cancel", verifyJWT, requireRole("customer", "vendor"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }
    const _id = new ObjectId(req.params.id);

    const booking = await bookings().findOne({ _id });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if (booking.customerId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only cancel your own bookings" });
    }
    if (booking.status !== "pending") {
      return res
        .status(409)
        .json({ message: `A ${booking.status} booking cannot be cancelled` });
    }

    const result = await bookings().updateOne(
      { _id, status: "pending" },
      { $set: { status: "cancelled", updatedAt: new Date() } }
    );
    if (result.modifiedCount === 0) {
      return res
        .status(409)
        .json({ message: "This booking can no longer be cancelled" });
    }

    res.json({ message: "Booking cancelled" });
  } catch (error) {
    next(error);
  }
});

export default router;