// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend, beforeSendTransaction } from "./lib/sentryScrub";

Sentry.init({
  dsn: "https://65a6a4c88cf156a1717ad0578c2f325a@o4511682456649728.ingest.de.sentry.io/4511682467725392",

  // Tag events by environment so production and preview deploys don't get muddled.
  environment: process.env.NODE_ENV,

  // Sample 10% of traces in production to protect the free quota; full sampling in dev.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  // Send logs to Sentry.
  enableLogs: true,

  // Privacy: never send user-identifiable data or request bodies. Customer names,
  // addresses and quote contents must not leave the app.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },

  // Privacy: planner share links and sign-in returns carry access tokens in
  // their URLs; strip them from everything sent.
  beforeBreadcrumb,
  beforeSend,
  beforeSendTransaction,
});
