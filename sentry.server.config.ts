// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend, beforeSendTransaction } from "./lib/sentryScrub";
import { SENTRY_PRIVACY } from "./lib/sentryPrivacy";
import { tracesSampleRateFor } from "./lib/sentrySampling";

Sentry.init({
  dsn: "https://65a6a4c88cf156a1717ad0578c2f325a@o4511682456649728.ingest.de.sentry.io/4511682467725392",

  // Tag events by environment so production and preview deploys don't get muddled.
  environment: process.env.NODE_ENV,

  // 10% of traces in production to protect the free quota; every trace on
  // preview deploys and in dev. See lib/sentrySampling.js.
  tracesSampleRate: tracesSampleRateFor(process.env.VERCEL_ENV, process.env.NODE_ENV),

  // Send logs to Sentry.
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
