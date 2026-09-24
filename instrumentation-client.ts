// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend, beforeSendTransaction } from "./lib/sentryScrub";
import { tracesSampleRateFor } from "./lib/sentrySampling";

Sentry.init({
  dsn: "https://65a6a4c88cf156a1717ad0578c2f325a@o4511682456649728.ingest.de.sentry.io/4511682467725392",

  // Tag events by environment so production and preview deploys don't get muddled.
  environment: process.env.NODE_ENV,

  // 10% of traces in production to protect the free quota; every trace on
  // preview deploys and in dev. See lib/sentrySampling.js.
  tracesSampleRate: tracesSampleRateFor(process.env.NEXT_PUBLIC_VERCEL_ENV, process.env.NODE_ENV),

  // Send logs to Sentry.
  enableLogs: true,

  // Privacy: never send user-identifiable data or request bodies. Customer names,
  // addresses and quote contents must not leave the app.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },

  // Privacy: signed file links, planner share links and sign-in returns carry
  // access tokens in their URLs; strip them from everything sent.
  beforeBreadcrumb,
  beforeSend,
  beforeSendTransaction,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
