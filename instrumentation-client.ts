// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend, beforeSendTransaction } from "./lib/sentryScrub";
import { SENTRY_PRIVACY } from "./lib/sentryPrivacy";
import { tracesSampleRateFor } from "./lib/sentrySampling";
import { inAppBrowserTag, IN_APP_BRIDGE_ERRORS } from "./lib/inAppBrowser";

// Instagram, Facebook, Messenger or TikTok's built-in browser, if that's where
// the page is open: every event gets an in_app_browser tag to filter on.
const inAppTag = inAppBrowserTag(typeof navigator !== "undefined" ? navigator.userAgent : "");

Sentry.init({
  dsn: "https://65a6a4c88cf156a1717ad0578c2f325a@o4511682456649728.ingest.de.sentry.io/4511682467725392",

  // Tag events by environment so production and preview deploys don't get muddled.
  environment: process.env.NODE_ENV,

  // 10% of traces in production to protect the free quota; every trace on
  // preview deploys and in dev. See lib/sentrySampling.js.
  tracesSampleRate: tracesSampleRateFor(process.env.NEXT_PUBLIC_VERCEL_ENV, process.env.NODE_ENV),

  // Send logs to Sentry.
  enableLogs: true,

  // Errors thrown by those apps' own scripts, never by Plotwire ("Java object
  // is gone" and friends). See lib/inAppBrowser.js.
  ignoreErrors: IN_APP_BRIDGE_ERRORS,
  initialScope: { tags: { in_app_browser: inAppTag } },

  // Privacy: no user data, cookies, headers, query strings or bodies, and
  // sendDefaultPii off. Spelled out in full in lib/sentryPrivacy.js.
  ...SENTRY_PRIVACY,

  // Privacy: signed file links, planner share links and sign-in returns carry
  // access tokens in their URLs; strip them from everything sent.
  beforeBreadcrumb,
  beforeSend,
  beforeSendTransaction,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
