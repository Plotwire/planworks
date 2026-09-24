// Plan facts shared by the server (Stripe checkout) and the browser (paywall
// wording). Kept out of lib/billing.js, which is server-only.

// Length of the free trial on a new subscription, in days. Must match the
// website and launch pricing.
export const TRIAL_DAYS = 7;
