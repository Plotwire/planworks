/* ============================================================================
 * Keep access tokens out of Sentry
 * ----------------------------------------------------------------------------
 * Several links in this app carry a secret in the URL:
 *   - signed plan-file links (Supabase Storage)   ...?token=<JWT>   (8 hours)
 *   - planner share links                          /planner/view?t=<token>
 *   - Supabase sign-in / password-reset returns    #access_token=...&refresh_token=...
 * and the billing API is called with an `Authorization: Bearer <access token>`
 * header, alongside the Supabase session cookies.
 *
 * Sentry records URLs and requests in many places: breadcrumbs (page
 * navigations, fetch and XHR requests, console messages), the page URL,
 * Referer and headers on every event, error messages, and tracing spans.
 * Anyone with access to the Sentry project could use such a token until it
 * expires. So before anything is sent:
 *   - the VALUES of those URL parameters become [Filtered] in every string
 *     (host, path and other parameters are kept for debugging);
 *   - fields named like credentials (authorization, cookie, ...) become
 *     [Filtered], and request cookies are dropped.
 *
 * The hooks never modify what Sentry hands them -- that can include live SDK
 * objects and the real console arguments -- they return scrubbed COPIES of
 * the plain data. And if scrubbing ever fails, the item is dropped rather
 * than sent unscrubbed.
 *
 * Used by instrumentation-client.ts, sentry.server.config.ts and
 * sentry.edge.config.ts.
 * ========================================================================== */

const SECRET_PARAMS = [
  "token", "t",
  "access_token", "refresh_token", "provider_token", "provider_refresh_token",
  "code", "apikey",
];

// A secret parameter's value in a query string or URL fragment:
// "?token=abc", "&t=abc", "#access_token=abc".
const SECRET_PARAM_RE = new RegExp(`([?&#;](?:${SECRET_PARAMS.join("|")})=)[^&#\\s"'<>]+`, "gi");

// Object keys whose values are credentials, e.g. request headers, or span
// attributes such as "http.request.header.authorization".
const SECRET_KEY_RE = /(^|[._-])(authorization|proxy-authorization|cookie|set-cookie|apikey|x-api-key)$/i;

// Keys holding a bare query string ("t=abc&x=1", no leading "?"), such as the
// server span attribute "http.query" or event.request.query_string.
const QUERY_KEY_RE = /(^|[._])query(_string)?$/i;

// SDK-internal data on the event: never sent (Sentry deletes it before
// sending) and holds live SDK objects, so it is passed through untouched.
const PASS_THROUGH_KEYS = new Set(["sdkProcessingMetadata"]);

const FILTERED = "[Filtered]";

/** @param {unknown} text */
export function scrubText(text) {
  return typeof text === "string" ? text.replace(SECRET_PARAM_RE, `$1${FILTERED}`) : text;
}

function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// A scrubbed copy of plain data: strings scrubbed, arrays and plain objects
// copied, Errors summarised, anything else (class instances) left as is.
function scrubCopy(value, depth = 0) {
  if (typeof value === "string") return scrubText(value);
  if (!value || typeof value !== "object" || depth > 12) return value;
  if (Array.isArray(value)) return value.map((item) => scrubCopy(item, depth + 1));
  if (value instanceof Error) {
    // Console breadcrumbs can carry raw Errors, whose message isn't enumerable.
    const copy = new Error(scrubText(value.message));
    copy.name = value.name;
    copy.stack = scrubText(value.stack);
    return copy;
  }
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (depth === 0 && PASS_THROUGH_KEYS.has(key)) out[key] = value[key];
    else if (SECRET_KEY_RE.test(key)) out[key] = FILTERED;
    else if (QUERY_KEY_RE.test(key)) out[key] = scrubQueryString(value[key]);
    else out[key] = scrubCopy(value[key], depth + 1);
  }
  return out;
}

function isSecretParam(name) {
  return typeof name === "string" && SECRET_PARAMS.includes(name.toLowerCase());
}

// A query string on its own (with or without its leading "?"), or the
// key/value shapes Sentry sometimes uses for it.
function scrubQueryString(qs) {
  if (typeof qs === "string") return qs.startsWith("?") ? scrubText(qs) : scrubText("?" + qs).slice(1);
  if (Array.isArray(qs)) {
    return qs.map((pair) => (Array.isArray(pair) && isSecretParam(pair[0]) ? [pair[0], FILTERED] : pair));
  }
  if (qs && typeof qs === "object") {
    const out = {};
    for (const key of Object.keys(qs)) out[key] = isSecretParam(key) ? FILTERED : qs[key];
    return out;
  }
  return qs;
}

function scrubEvent(event) {
  const out = scrubCopy(event);
  if (out && out.request) delete out.request.cookies;
  return out;
}

/** Sentry `beforeBreadcrumb` hook. */
export function beforeBreadcrumb(breadcrumb) {
  try {
    return scrubCopy(breadcrumb);
  } catch {
    return null; // never send an unscrubbed breadcrumb
  }
}

/** Sentry `beforeSend` / `beforeSendTransaction` hook. */
export function beforeSend(event) {
  try {
    return scrubEvent(event);
  } catch {
    return null; // never send an unscrubbed event
  }
}

export const beforeSendTransaction = beforeSend;
