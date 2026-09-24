// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend, beforeSendTransaction } from "./lib/sentryScrub";
import { SENTRY_PRIVACY } from "./lib/sentryPrivacy";

Sentry.init({
  dsn: "https://65a6a4c88cf156a1717ad0578c2f325a@o4511682456649728.ingest.de.sentry.io/4511682467725392",

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Privacy: no user data, cookies, headers, query strings or bodies, and
  // sendDefaultPii off. Spelled out in full in lib/sentryPrivacy.js.
  ...SENTRY_PRIVACY,

  // Privacy: planner share links and sign-in returns carry access tokens in
  // their URLs; strip them from everything sent.
  beforeBreadcrumb,
  beforeSend,
  beforeSendTransaction,
});
