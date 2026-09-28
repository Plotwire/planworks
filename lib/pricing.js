// Plan facts shared by the server (Stripe checkout) and the browser (paywall
// wording). Kept out of lib/billing.js, which is server-only.

// Monthly price, for wording. Stripe's price (STRIPE_PRICE) is what's charged;
// keep the two in step. Charged at checkout -- there is no free trial.
export const PRICE_GBP_MONTHLY = 15;

// "Try Plotwire": an account that has never paid can place this many symbols
// in total across all its saved drawings. Must match try_symbol_limit() in
// supabase/try-mode.sql.
export const TRY_SYMBOL_LIMIT = 25;
