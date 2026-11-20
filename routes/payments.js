import { Router } from "express";
import Stripe from "stripe";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { PREMIUM_PRICE_USD } from "../constants.js";
import { isPremium } from "../utils/plan.js";

const router = Router();

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

router.use(verifyJWT, requireRole("vendor"));

// Start a Stripe Checkout session for the signed-in vendor.
// This only creates the payment page. Premium is activated by the webhook.
router.post("/checkout-session", async (req, res, next) => {
  try {
    if (isPremium(req.user)) {
      return res
        .status(400)
        .json({ message: "You already have an active Premium plan" });
    }

    const vendorId = String(req.user.id);
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: req.user.email,
      client_reference_id: vendorId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PREMIUM_PRICE_USD * 100,
            recurring: { interval: "month" },
            product_data: {
              name: "WedPlan Premium",
              description:
                "Unlimited active services and the Premium Vendor badge",
            },
          },
        },
      ],
      metadata: { vendorId },
      subscription_data: { metadata: { vendorId } },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

// Lets the success page check whether the webhook has activated Premium yet.
router.get("/status", (req, res) => {
  res.json({
    isPremium: isPremium(req.user),
    plan: req.user.subscriptionPlan || "free",
    expiresAt: req.user.subscriptionExpiresAt || null,
  });
});

export default router;