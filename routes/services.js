import { Router } from "express";
import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { CATEGORIES, FREE_ACTIVE_LIMIT } from "../constants.js";
import { isPremium } from "../utils/plan.js";

const router = Router();
const services = () => db.collection("services");

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateService(body) {
  const serviceName = String(body.serviceName ?? "").trim();
  const category = String(body.category ?? "").trim();
  const description = String(body.description ?? "").trim();
  const location = String(body.location ?? "").trim();
  const price = Number(body.price);
  const images = Array.isArray(body.images)
    ? body.images.map((item) => String(item).trim()).filter(Boolean)
    : [];

  if (serviceName.length < 3 || serviceName.length > 100) {
    return { error: "Service name must be 3 to 100 characters" };
  }
  if (!CATEGORIES.includes(category)) {
    return { error: "Please choose a valid category" };
  }
  if (description.length < 20) {
    return { error: "Description must be at least 20 characters" };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Price must be a number greater than 0" };
  }
  if (!location) {
    return { error: "Location is required" };
  }
  if (images.length < 1 || images.length > 5) {
    return { error: "Add between 1 and 5 images" };
  }
  if (!images.every(isHttpUrl)) {
    return { error: "Images must be valid URLs" };
  }

  return {
    data: { serviceName, category, description, price, location, images },
  };
}

// Adds vendor info and an isPremium flag to each service.
function vendorStages() {
  const now = new Date();
  return [
    {
      $lookup: {
        from: "users",
        let: { vid: "$vendorId" },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$vid"] } } },
          {
            $project: {
              name: 1,
              businessName: 1,
              image: 1,
              subscriptionPlan: 1,
              subscriptionExpiresAt: 1,
            },
          },
        ],
        as: "vendor",
      },
    },
    { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        isPremium: {
          $and: [
            { $eq: ["$vendor.subscriptionPlan", "premium"] },
            { $gt: ["$vendor.subscriptionExpiresAt", now] },
          ],
        },
      },
    },
    {
      $project: {
        "vendor.subscriptionPlan": 0,
        "vendor.subscriptionExpiresAt": 0,
      },
    },
  ];
}

// Active = switched on and not rejected.
function countActive(vendorId, excludeId) {
  const filter = { vendorId, isActive: true, status: { $ne: "rejected" } };
  if (excludeId) filter._id = { $ne: excludeId };
  return services().countDocuments(filter);
}

function limitMessage() {
  return `Free plan allows up to ${FREE_ACTIVE_LIMIT} active services. Upgrade to Premium to add more.`;
}

// ---------- Public ----------

router.get("/", async (req, res, next) => {
  try {
    const { search, category, location, sort, minPrice, maxPrice } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 50);

    const match = { status: "approved", isActive: true };
    if (search) {
      match.serviceName = {
        $regex: escapeRegex(String(search)),
        $options: "i",
      };
    }
    if (category) match.category = String(category);
    if (location) {
      match.location = {
        $regex: escapeRegex(String(location)),
        $options: "i",
      };
    }

    const price = {};
    if (minPrice && Number(minPrice) >= 0) price.$gte = Number(minPrice);
    if (maxPrice && Number(maxPrice) > 0) price.$lte = Number(maxPrice);
    if (Object.keys(price).length) match.price = price;

    const sortStage =
      sort === "price_asc"
        ? { price: 1, isPremium: -1, createdAt: -1 }
        : sort === "price_desc"
          ? { price: -1, isPremium: -1, createdAt: -1 }
          : { isPremium: -1, createdAt: -1 };

    const [result] = await services()
      .aggregate([
        { $match: match },
        ...vendorStages(),
        { $sort: sortStage },
        {
          $facet: {
            items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
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

// ---------- Vendor ----------
// Keep "/mine" above "/:id" so it is not treated as an id.

router.get("/mine", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const list = await services()
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ services: list });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid service ID" });
    }

    const [service] = await services()
      .aggregate([
        {
          $match: {
            _id: new ObjectId(req.params.id),
            status: "approved",
            isActive: true,
          },
        },
        ...vendorStages(),
      ])
      .toArray();

    if (!service) {
      return res
        .status(404)
        .json({ message: "Service not found or no longer available" });
    }
    res.json({ service });
  } catch (error) {
    next(error);
  }
});

router.post("/", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const { data, error } = validateService(req.body);
    if (error) return res.status(400).json({ message: error });

    if (!isPremium(req.user)) {
      const active = await countActive(req.user.id);
      if (active >= FREE_ACTIVE_LIMIT) {
        return res
          .status(403)
          .json({ message: limitMessage(), code: "FREE_LIMIT_REACHED" });
      }
    }

    const now = new Date();
    const doc = {
      ...data,
      vendorId: req.user.id,
      status: "pending",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const result = await services().insertOne(doc);

    res.status(201).json({
      message: "Service submitted for admin review",
      service: { _id: result.insertedId, ...doc },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid service ID" });
    }
    const _id = new ObjectId(req.params.id);

    const existing = await services().findOne({ _id });
    if (!existing) {
      return res.status(404).json({ message: "Service not found" });
    }
    if (existing.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only edit your own services" });
    }

    const { data, error } = validateService(req.body);
    if (error) return res.status(400).json({ message: error });

    // A rejected service goes back to review after the vendor fixes it.
    const status = existing.status === "rejected" ? "pending" : existing.status;

    await services().updateOne(
      { _id },
      { $set: { ...data, status, updatedAt: new Date() } }
    );
    const service = await services().findOne({ _id });
    res.json({ message: "Service updated", service });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id/availability",
  verifyJWT,
  requireRole("vendor"),
  async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: "Invalid service ID" });
      }
      if (typeof req.body.isActive !== "boolean") {
        return res.status(400).json({ message: "isActive must be true or false" });
      }
      const _id = new ObjectId(req.params.id);

      const existing = await services().findOne({ _id });
      if (!existing) {
        return res.status(404).json({ message: "Service not found" });
      }
      if (existing.vendorId !== req.user.id) {
        return res
          .status(403)
          .json({ message: "You can only manage your own services" });
      }

      if (req.body.isActive) {
        if (existing.status === "rejected") {
          return res
            .status(400)
            .json({ message: "Rejected services cannot be activated" });
        }
        if (!isPremium(req.user)) {
          const active = await countActive(req.user.id, _id);
          if (active >= FREE_ACTIVE_LIMIT) {
            return res
              .status(403)
              .json({ message: limitMessage(), code: "FREE_LIMIT_REACHED" });
          }
        }
      }

      await services().updateOne(
        { _id },
        { $set: { isActive: req.body.isActive, updatedAt: new Date() } }
      );
      res.json({
        message: req.body.isActive ? "Service activated" : "Service deactivated",
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/:id", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid service ID" });
    }
    const _id = new ObjectId(req.params.id);

    const existing = await services().findOne({ _id });
    if (!existing) {
      return res.status(404).json({ message: "Service not found" });
    }
    if (existing.vendorId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "You can only delete your own services" });
    }

    await services().deleteOne({ _id });
    res.json({ message: "Service deleted" });
  } catch (error) {
    next(error);
  }
});

export default router;