// Share of Sentry traces kept, by deployment.
//
//   production  10%, to stay inside Sentry's free quota
//   preview     100%, so every test session on a preview deploy shows up
//   local dev   100%
//
// `vercelEnv` is Vercel's deployment type ("production" | "preview" |
// "development"): NEXT_PUBLIC_VERCEL_ENV in the browser, VERCEL_ENV on the
// server. A deployment that can't be identified counts as production, so a
// missing variable can never send every production trace.
export function tracesSampleRateFor(vercelEnv, nodeEnv) {
  if (vercelEnv === "preview" || vercelEnv === "development") return 1;
  if (!vercelEnv && nodeEnv !== "production") return 1; // `next dev` on a laptop
  return 0.1;
}
