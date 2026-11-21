import { db, connectDB } from "../db.js";

const unsplash = (id) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1000&q=80`;

const checked = new Map();

async function works(url) {
  if (checked.has(url)) return checked.get(url);
  let ok = false;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    ok = res.ok;
  } catch {
    ok = false;
  }
  checked.set(url, ok);
  return ok;
}

// Keeps up to 3 working photo links; falls back to placeholders if needed.
async function pickImages(ids, seed) {
  const good = [];
  for (const id of ids) {
    const url = unsplash(id);
    if (await works(url)) good.push(url);
    if (good.length === 3) break;
  }
  let n = 1;
  while (good.length < 2) {
    good.push(`https://picsum.photos/seed/${seed}-${n++}/1000/750`);
  }
  return good;
}

const vendors = [
  {
    key: "lumiere",
    email: "seed.lumiere@wedplan.example",
    name: "Lumière Studio",
    premium: true,
  },
  {
    key: "green",
    email: "seed.greenhaven@wedplan.example",
    name: "Green Haven Events",
    premium: false,
  },
  {
    key: "petal",
    email: "seed.petalglow@wedplan.example",
    name: "Petal & Glow",
    premium: false,
  },
];

const services = [
  {
    vendor: "lumiere",
    serviceName: "Lumière Wedding Films",
    category: "Photography & Videography",
    price: 85000,
    location: "Dhaka",
    description:
      "A cinematic wedding film and full photo coverage by a team of three. Includes a 5-minute highlight reel, a full ceremony edit and 400 edited photographs delivered in an online gallery within three weeks.",
    photos: [
      "1519741497674-611481863552",
      "1537633552985-df8429e8048b",
      "1583939003579-730e3918a45a",
    ],
  },
  {
    vendor: "green",
    serviceName: "Riverside Garden Venue",
    category: "Wedding Venues",
    price: 180000,
    location: "Sylhet",
    description:
      "An open-air garden venue beside the river with space for 300 guests, a covered stage, a bridal suite and parking. Evening fairy lights and basic seating are included in the booking.",
    photos: [
      "1519225421980-715cb0215aed",
      "1464366400600-7168b8af9bc3",
      "1478146059778-26028b07395a",
    ],
  },
  {
    vendor: "lumiere",
    serviceName: "Royal Grand Ballroom",
    category: "Wedding Venues",
    price: 350000,
    location: "Dhaka",
    description:
      "An air-conditioned ballroom for up to 600 guests with a grand entrance, built-in stage, sound system and a dedicated bridal and groom lounge. Catering can be arranged separately.",
    photos: [
      "1519167758481-83f550bb49b3",
      "1478146059778-26028b07395a",
      "1464366400600-7168b8af9bc3",
    ],
  },
  {
    vendor: "petal",
    serviceName: "Blush & Ivory Stage Decor",
    category: "Decoration & Florist",
    price: 60000,
    location: "Chattogram",
    description:
      "Complete stage and entrance decoration in a soft blush and ivory theme using fresh flowers, drapes and warm lighting. Setup and take-down are handled by our team.",
    photos: [
      "1478146059778-26028b07395a",
      "1519167758481-83f550bb49b3",
      "1507504031003-b417219a0fde",
    ],
  },
  {
    vendor: "green",
    serviceName: "Shahi Wedding Feast",
    category: "Catering Services",
    price: 1200,
    location: "Dhaka",
    description:
      "Traditional Bengali wedding menu priced per guest, including biryani, kebabs, rezala, desserts and drinks. Service staff and a live counter are included for events above 200 guests.",
    photos: [
      "1555244162-803834f70033",
      "1414235077428-338989a2e8c0",
      "1504674900247-0877df9cc836",
    ],
  },
  {
    vendor: "petal",
    serviceName: "Glow Bridal Makeup & Styling",
    category: "Makeup & Styling",
    price: 25000,
    location: "Cox's Bazar",
    description:
      "Bridal makeup, hair styling and saree draping by a certified artist. Includes a trial session before the wedding and touch-up support on the day.",
    photos: [
      "1487412947147-5cebf100ffc2",
      "1522335789203-aabd1fc54bc9",
      "1596462502278-27bfdc403348",
    ],
  },
  {
    vendor: "lumiere",
    serviceName: "Sherwani & Saree Studio",
    category: "Wedding Fashion",
    price: 35000,
    location: "Rajshahi",
    description:
      "Custom-tailored sherwanis and bridal sarees with hand embroidery. Includes two fittings and accessories such as turbans and dupattas.",
    photos: [
      "1594552072238-b8a33785b261",
      "1566174053879-31528523f8ae",
      "1519741497674-611481863552",
    ],
  },
];

async function main() {
  await connectDB();
  const users = db.collection("users");
  const servicesCol = db.collection("services");
  const now = new Date();
  const yearAhead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const vendorIds = {};
  for (const vendor of vendors) {
    await users.updateOne(
      { email: vendor.email },
      {
        $set: {
          name: vendor.name,
          businessName: vendor.name,
          role: "vendor",
          isBlocked: false,
          subscriptionPlan: vendor.premium ? "premium" : "free",
          subscriptionExpiresAt: vendor.premium ? yearAhead : null,
          updatedAt: now,
        },
        $setOnInsert: {
          email: vendor.email,
          emailVerified: true,
          image: null,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    const doc = await users.findOne({ email: vendor.email });
    vendorIds[vendor.key] = String(doc._id);
  }

  for (const item of services) {
    const images = await pickImages(item.photos, item.serviceName.replace(/\W+/g, "-"));
    const vendorId = vendorIds[item.vendor];

    await servicesCol.updateOne(
      { serviceName: item.serviceName, vendorId },
      {
        $set: {
          category: item.category,
          description: item.description,
          price: item.price,
          location: item.location,
          images,
          status: "approved",
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: {
          serviceName: item.serviceName,
          vendorId,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    console.log("Seeded:", item.serviceName);
  }

  // Fix the old test service that had a placeholder image link.
  const fixed = await servicesCol.updateMany(
    { images: "https://i.ibb.co/example/photo.jpg" },
    {
      $set: {
        images: await pickImages(
          ["1519741497674-611481863552", "1537633552985-df8429e8048b"],
          "golden-hour"
        ),
        updatedAt: now,
      },
    }
  );
  console.log("Fixed broken images on", fixed.modifiedCount, "service(s)");

  const approved = await servicesCol.countDocuments({
    status: "approved",
    isActive: true,
  });
  console.log("Approved and active services in the database:", approved);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });