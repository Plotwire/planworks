import "server-only";
import * as Sentry from "@sentry/nextjs";

// ============================================================================
// Alerts to Sentry for server problems nobody would otherwise see: billing
// webhook failures (app/api/billing/webhook/route.js) and reconciliation
// mismatches (lib/billingReconcile.js, app/api/admin/reconcile/route.js).
//
//   alertError(error, { area, problem, level, title, extra, tags, fingerprint, throttleMs })
//   alertMessage(message, { area, problem, level, extra, tags, fingerprint, throttleMs })
//   await flushAlerts()   before the route answers
//
// Every event is tagged:
//   area        what it is about ("billing-webhook", "billing-reconcile"); the
//               Sentry alert rule that emails admin@plotwire.uk matches on it
//   problem     which check raised it ("handler-error", "mismatch", ...)
//   vercel_env  production / preview / development. The Sentry environment
//               is NODE_ENV, which is "production" on Vercel previews too.
// Grouping: one Sentry issue per area + problem (errors also by their stack),
// unless the caller gives its own fingerprint.
//
// Flushing: Vercel may freeze a Node function as soon as it has answered, and
// Sentry's own route wrapper only waits for the send on the Edge runtime. So a
// route that may have alerted awaits flushAlerts() before answering. It
// returns at once when nothing was captured and no send is in flight, and
// never waits much longer than its timeout (2 s). Requests on one server
// instance share the SDK's send queue, so a request whose events are already
// being sent by another request's flush waits for that send.
//
// throttleMs: at most one event per area + problem per server instance in
// that time (for things anyone on the internet can trigger, such as a bad
// webhook signature). The next one sent says how many were held back.
//
// Privacy: callers pass ids, types and counts only -- never emails, names,
// addresses or card details. As a backstop, anything shaped like an email
// address becomes [email] in the message, the error's message and stack, and
// every extra and tag value. The error itself is not sent, only a copy with
// its name, message and stack, so fields such as a Stripe error's raw
// response don't go with the alert. The breadcrumbs Sentry attaches to an
// alert (the console lines logged just before it, which can hold the raw
// error, and outgoing requests) get the same email redaction. The Sentry
// configs' privacy settings and beforeSend scrubber (lib/sentryPrivacy.js,
// lib/sentryScrub.js) still apply.
//
// Never throws: a broken or missing Sentry must never break a webhook or the
// reconciliation. The routes log every problem to the console as well.
// ============================================================================

export const FLUSH_TIMEOUT_MS = 2000;
export const REDACTED_EMAIL = "[email]";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const MAX_TEXT = 1000;
const MAX_TAG = 200;
const MAX_THROTTLE_KEYS = 200;

/** Email addresses in a string become [email]; anything else is returned as it is. */
export function redactEmails(text) {
  return typeof text === "string" ? text.replace(EMAIL_RE, REDACTED_EMAIL) : text;
}

// A plain, redacted copy of extra data: strings redacted and shortened,
// nested objects and arrays copied (4 levels deep at most).
function cleanValue(value, depth = 0) {
  if (typeof value === "string") return redactEmails(value).slice(0, MAX_TEXT);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (depth >= 4) return "[...]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => cleanValue(v, depth + 1));
  const out = {};
  for (const key of Object.keys(value).slice(0, 100)) out[key] = cleanValue(value[key], depth + 1);
  return out;
}

function cleanTag(value) {
  return redactEmails(String(value ?? "")).replace(/\s+/g, " ").trim().slice(0, MAX_TAG);
}

function cleanTags(tags) {
  const out = {};
  for (const [key, value] of Object.entries(tags || {})) {
    if (value === undefined || value === null) continue;
    out[String(key).slice(0, 32)] = cleanTag(value);
  }
  return out;
}

// Non-personal facts from a Stripe, Postgres or Supabase error.
function errorFacts(error) {
  const out = {};
  if (!error || typeof error !== "object") return out;
  const fields = [
    ["code", "errorCode"], // Postgres SQLSTATE, Stripe error code
    ["type", "errorType"], // Stripe error class, e.g. StripeConnectionError
    ["statusCode", "statusCode"], // Stripe HTTP status
    ["requestId", "stripeRequestId"], // req_... (look it up in the Stripe Dashboard)
  ];
  for (const [from, to] of fields) {
    const v = error[from];
    if (typeof v === "string" && v) out[to] = redactEmails(v).slice(0, MAX_TAG);
    else if (typeof v === "number" && Number.isFinite(v)) out[to] = v;
  }
  return out;
}

// What Sentry gets instead of the error itself: a new Error with the same
// name, a redacted message (with an optional title in front) and the
// redacted stack. Supabase/PostgREST errors can be plain objects; they become
// Errors too, so Sentry shows their message.
function safeError(error, title) {
  const isError = error instanceof Error;
  const raw =
    typeof error?.message === "string" && error.message
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";
  const message = redactEmails(title ? `${title}: ${raw}` : raw).slice(0, MAX_TEXT);
  const copy = new Error(message);
  if (typeof error?.name === "string" && error.name) copy.name = error.name;
  if (isError && typeof error.stack === "string") {
    // The stack's first line repeats the original message; keep the frames.
    const frames = error.stack.split("\n").filter((line) => /^\s+at\s/.test(line));
    copy.stack = [`${copy.name}: ${message}`, ...frames.map(redactEmails)].join("\n");
  }
  return copy;
}

// A copy of breadcrumb data with email addresses redacted at any depth.
// Errors become plain objects (name, message, stack and their own fields),
// which is how Sentry would send them anyway.
function redactDeep(value, depth = 0, ancestors = new Set()) {
  if (typeof value === "string") return redactEmails(value);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (depth >= 8 || ancestors.has(value)) return "[...]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1, ancestors));
    if (!(value instanceof Error) && typeof value.toJSON === "function") return redactDeep(value.toJSON(), depth + 1, ancestors);
    const out = {};
    if (value instanceof Error) {
      out.name = value.name;
      out.message = redactEmails(String(value.message ?? ""));
      if (typeof value.stack === "string") out.stack = redactEmails(value.stack);
    }
    for (const key of Object.keys(value)) out[key] = redactDeep(value[key], depth + 1, ancestors);
    return out;
  } finally {
    ancestors.delete(value);
  }
}

// Event processor added to alert events only (a scope of their own): their
// breadcrumbs, as copies, with email addresses redacted. If that fails the
// breadcrumbs are dropped, never sent unredacted.
function redactBreadcrumbs(event) {
  if (!event || !Array.isArray(event.breadcrumbs)) return event;
  try {
    event.breadcrumbs = event.breadcrumbs.map((b) => {
      if (!b || typeof b !== "object") return b;
      const copy = { ...b };
      if (typeof b.message === "string") copy.message = redactEmails(b.message);
      if (b.data !== undefined) copy.data = redactDeep(b.data);
      return copy;
    });
  } catch {
    delete event.breadcrumbs;
  }
  return event;
}

/**
 * Alerts bound to one Sentry SDK (the real one by default; tests pass a stub).
 * @param {object} sentry  needs captureException, captureMessage, flush; getClient optional
 */
export function createAlerts(sentry, { env = () => process.env, now = () => Date.now() } = {}) {
  let pending = 0; // events captured since the last flush
  let inFlight = null; // the flush in progress (a promise that never rejects)
  let warnedNoClient = false;
  const throttle = new Map(); // "area:problem" -> { at, held }

  function logFailure(what, e) {
    try {
      console.error(`[alert] couldn't ${what}:`, e?.message || e);
    } catch {
      // nothing more we can do
    }
  }

  // Once per server instance: say so in the logs when Sentry was never set up
  // here (instrumentation.ts not run), since alerts then go nowhere.
  function warnIfNoClient() {
    if (warnedNoClient) return;
    try {
      if (typeof sentry.getClient === "function" && !sentry.getClient()) {
        warnedNoClient = true;
        console.warn("[alert] Sentry isn't initialised in this server (instrumentation.ts); alerts reach the logs only");
      }
    } catch {
      warnedNoClient = true;
    }
  }

  // true: hold this one back. Otherwise returns how many were held back
  // since the last one sent (0 when none).
  function throttled(key, ms) {
    if (!(ms > 0)) return 0;
    const t = now();
    const entry = throttle.get(key);
    if (entry && t - entry.at < ms) {
      entry.held += 1;
      return true;
    }
    if (throttle.size >= MAX_THROTTLE_KEYS) throttle.clear();
    throttle.set(key, { at: t, held: 0 });
    return entry ? entry.held : 0;
  }

  // Sentry.flush, raced against a timer. Resolves true or false; never rejects.
  async function sendNow(timeoutMs) {
    let timer;
    try {
      const guard = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs + 500);
      });
      const flushed = Promise.resolve()
        .then(() => sentry.flush(timeoutMs))
        .then(
          (ok) => ok !== false,
          (e) => {
            logFailure("send to Sentry", e);
            return false;
          }
        );
      return await Promise.race([flushed, guard]);
    } catch (e) {
      logFailure("send to Sentry", e);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function capture(kind, payload, opts) {
    try {
      const { area, problem, level, title, extra, tags, fingerprint, throttleMs = 0 } = opts || {};
      if (!area || !problem) throw new Error("an alert needs an area and a problem");
      const held = throttled(`${area}:${problem}`, throttleMs);
      if (held === true) return null;

      const context = {
        level: level || (kind === "error" ? "error" : "warning"),
        tags: cleanTags({ ...tags, area, problem, vercel_env: env().VERCEL_ENV || "unknown" }),
        extra: cleanValue({
          ...(kind === "error" ? errorFacts(payload) : {}),
          ...(extra || {}),
          ...(held ? { heldBackSinceLastAlert: held } : {}),
        }),
        fingerprint:
          Array.isArray(fingerprint) && fingerprint.length
            ? fingerprint.map((f) => cleanTag(f))
            : kind === "error"
              ? [area, problem, "{{ default }}"]
              : [area, problem],
      };
      // Only level, tags, extra and fingerprint: Sentry treats an object made
      // of these keys as scope data for this one event (a "capture context").
      const send = () =>
        kind === "error"
          ? sentry.captureException(safeError(payload, title), context)
          : sentry.captureMessage(redactEmails(String(payload ?? "")).slice(0, MAX_TEXT), context);
      // A scope of its own, so the breadcrumb redaction applies to this
      // event only.
      const id =
        typeof sentry.withScope === "function"
          ? sentry.withScope((scope) => {
              if (typeof scope?.addEventProcessor === "function") scope.addEventProcessor(redactBreadcrumbs);
              return send();
            })
          : send();
      pending += 1;
      warnIfNoClient();
      return id || null;
    } catch (e) {
      logFailure("report to Sentry", e);
      return null;
    }
  }

  return {
    /** Report an exception. Returns the Sentry event id, or null (held back or failed). Never throws. */
    alertError(error, opts) {
      return capture("error", error, opts);
    },
    /** Report a message (default level "warning"). Returns the event id or null. Never throws. */
    alertMessage(message, opts) {
      return capture("message", message, opts);
    },
    /**
     * Send what has been captured before the route answers. Resolves true when
     * sent (or nothing was waiting), false on a timeout or failure. Never throws.
     */
    async flushAlerts(timeoutMs = FLUSH_TIMEOUT_MS) {
      if (pending === 0) {
        // Nothing new since the last flush. If that flush is still running
        // (another request on this instance started it), it may be sending
        // this request's events: wait for it rather than answer early.
        return inFlight ? inFlight : true;
      }
      pending = 0;
      const run = sendNow(timeoutMs);
      inFlight = run;
      try {
        return await run;
      } finally {
        if (inFlight === run) inFlight = null;
      }
    },
  };
}

const alerts = createAlerts(Sentry);

export const alertError = alerts.alertError;
export const alertMessage = alerts.alertMessage;
export const flushAlerts = alerts.flushAlerts;
