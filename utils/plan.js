// A vendor is Premium only while the paid period has not expired.
export function isPremium(user) {
  return Boolean(
    user?.subscriptionPlan === "premium" &&
      user?.subscriptionExpiresAt &&
      new Date(user.subscriptionExpiresAt) > new Date()
  );
}