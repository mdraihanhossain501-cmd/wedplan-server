import { db } from "../db.js";
import { toIdFilter } from "../middleware/auth.js";
import { getStripe } from "./payments.js";

const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60 * 1000;

// Stripe moved current_period_end between API versions, so check both places.
function periodEndDate(subscription) {
  const end =
    subscription.current_period_end ??
    subscription.items?.data?.[0]?.current_period_end;
  return end ? new Date(end * 1000) : new Date(Date.now() + THIRTY_ONE_DAYS);
}

function idOf(value) {
  return typeof value === "object" && value !== null ? value.id : value;
}

async function activatePremium(vendorId, subscription) {
  await db.collection("users").updateOne(toIdFilter(vendorId), {
    $set: {
      subscriptionPlan: "premium",
      subscriptionExpiresAt: periodEndDate(subscription),
      stripeCustomerId: idOf(subscription.customer),
      stripeSubscriptionId: subscription.id,
    },
  });
}

async function handleCheckoutCompleted(session) {
  if (session.mode !== "subscription" || session.payment_status !== "paid") {
    console.log("Ignored checkout session:", session.id);
    return;
  }

  const vendorId = session.client_reference_id || session.metadata?.vendorId;
  if (!vendorId) {
    console.log("Checkout session has no vendor id:", session.id);
    return;
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(
    idOf(session.subscription)
  );

  await activatePremium(vendorId, subscription);

  // Upsert on the session id so a retried webhook never creates a duplicate.
  await db.collection("transactions").updateOne(
    { stripeSessionId: session.id },
    {
      $setOnInsert: {
        vendorId: String(vendorId),
        plan: "premium",
        amount: (session.amount_total ?? 0) / 100,
        currency: session.currency,
        stripeSessionId: session.id,
        stripeSubscriptionId: subscription.id,
        status: "paid",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function handleInvoicePaid(invoice) {
  // The first invoice is handled by checkout.session.completed.
  if (invoice.billing_reason !== "subscription_cycle") return;

  const subscriptionId = idOf(
    invoice.subscription ?? invoice.parent?.subscription_details?.subscription
  );
  if (!subscriptionId) return;

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const vendorId = subscription.metadata?.vendorId;
  if (!vendorId) return;

  await activatePremium(vendorId, subscription);

  await db.collection("transactions").updateOne(
    { stripeInvoiceId: invoice.id },
    {
      $setOnInsert: {
        vendorId: String(vendorId),
        plan: "premium",
        amount: (invoice.amount_paid ?? 0) / 100,
        currency: invoice.currency,
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: subscription.id,
        status: "paid",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function handleSubscriptionDeleted(subscription) {
  await db.collection("users").updateOne(
    { stripeSubscriptionId: subscription.id },
    { $set: { subscriptionPlan: "free", subscriptionExpiresAt: null } }
  );
}

// Mounted with express.raw(), so req.body is the untouched raw Buffer.
export async function stripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return res.status(500).json({ message: "Webhook is not configured" });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      secret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ message: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler failed:", err);
    // A 500 makes Stripe retry the event later.
    res.status(500).json({ message: "Webhook handler failed" });
  }
}