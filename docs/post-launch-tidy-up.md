# Post-launch tidy-up

Deliberately deferred work: nothing here blocks launch. Each item says what it
is, why it was left, and where to start. Remove an item once it is done.

## Project Manager window is unreachable

*Added 24 Sep 2026.*

`ProjectManager` (in `components/SheetParts.jsx`) offers Save As, Open,
Delete and New blank, but nothing in the app opens it. `ElectricalPlanTool`
passes `onShowProjects` to `TopBar`, and `TopBar` never renders a button for
it. The toolbar button labelled "Save As" actually opens Export / Print / Email
(`onPrint`).

So today these code paths are unreachable from the UI:

- `saveProjectAs` and the explicit Save As use of `insertAsNewProject`
  (the first Save of a new drawing still uses `insertAsNewProject`, and that is
  live);
- `deleteProjectById` (the editor-side delete, with its safe plan-file cleanup);
- the Project Manager's Open and New blank.

Left as it is on purpose. Decide either to remove the window and its unused
handlers, or to give it a button. If it comes back, the safeguards are already
in place: saves are queued, and a Save As copy sharing its source's plan files
is protected when either drawing is deleted. Retest Save As, delete of a copy,
and delete of an original before shipping it.

## PDF export: sharper fallback for PDFs pdf-lib refuses

*Deferred 24 Sep 2026 (blur-fix proposal, commit 4).*

When the original PDF can't be embedded as vector (for example a
permission-locked architect PDF), the export uses the stored plan image. Plans
imported on an iPad are stored at a lower resolution (about 225–281 ppi across
the plan), so those sheets stay softer than desktop imports.

Proposed: render the plan with pdf.js (already loaded via `ensurePdfjs`) at the
export cap (about 384 dpi desktop, 334 dpi iPad) and embed that, before falling
back to the stored image. Order: vector → pdf.js render → stored image →
screenshot.

## CAD sketch plans: store them at higher resolution

*Deferred 24 Sep 2026 (blur-fix proposal, commit 5).*

CAD sketch plans are stored as a 2200 px PNG
(`components/cad/CadSketch.jsx`), about 206 dpi across the plan on A3, below
the 400 dpi export cap. Proposed: a named constant of about 3600 px (a square
frame stays at about 13 MP, under the iOS canvas limit). Only new or
re-applied plans benefit.

## Title block Scale is project-wide

*Added 1 Oct 2026 (true-scale floor plans, branch cad-v2).*

Plans sent from the sketch are now drawn at a true scale, and each send sets
the title block Scale (`meta.scale`), which is project-wide. In a project
whose floors were sent at different scales, every sheet shows the scale of the
last plan sent, so the other sheets print with the wrong Scale.

Proposed: give the title block the sheet's own scale (`bgImage.planScale`,
already saved with every sent plan) for that sheet, on screen, in print and in
the PDF, falling back to `meta.scale`.

## Items a re-sent plan leaves outside the drawing area

*Added 1 Oct 2026 (true-scale floor plans, branch cad-v2).*

When a plan is sent again at a larger scale (picked, or Auto after the plan
shrank), symbols and notes can land outside the drawing area. They keep their
place on the plan and are hidden (the drawing area clips them in the editor
and print page, and the PDF leaves out any wholly outside it), and the editor
says so. They still count in the legend, the quote and
the Try symbol count, and they can't be selected or deleted until the plan is
sent at a scale that shows them.

Proposed: list them in the editor ("3 items outside the drawing area") with
Delete and "Bring inside" actions.

## Older drawings: the first true-scale send can show less round the plan

*Added 1 Oct 2026 (true-scale floor plans, branch cad-v2).*

Plans sent before true scales were framed with 700 mm of plan all round the
drawing. On their first send after the update (any edit, then Back to drawing
or Update existing drawing), Auto picks the largest scale with 10 mm of paper
clear, which at 1:20 is only 200 mm of plan (500 mm at 1:50) on the tight
side. Notes or outside lights placed in that band end up outside the drawing
area and hidden. The editor says so, and picking the next smaller scale in
the sketch brings them back, so nothing is lost.

Proposed: on that first send of an older drawing, have Auto prefer the next
smaller scale when the largest one would hide something placed on the sheet
(the sketch would need the sheet's placed positions before it renders).

## Sketch scale bar is decorative

*Added 1 Oct 2026 (true-scale floor plans, branch cad-v2).*

The "0 1 2 m" bar at the sketch canvas's bottom left is fixed at 60 px, so it
only reads true at one zoom. Since the sketch now zooms out to about 6% (to
show a big plan's A3 drawing-area outline), it is further off at the far end.

Proposed: size the bar and its label from `view.s` (1, 2 or 5 x 10^n m to
about 60-120 px).

## Lapsed accounts: read-only UI in the Work Planner and the floor-plan sketch

*Deferred 2 Oct 2026 (billing fix 3, access rules; branch prelaunch).*

A lapsed account (subscription ended, or a payment overdue past the 7-day
grace) is read-only. The drawing editor and the quote show this, but
`components/WorkPlanner.jsx` and `components/cad/CadSketch.jsx` still look
editable: a save there fails because the database refuses it once
`app_flags.enforce_billing` is on (`supabase/try-mode.sql`
`can_save_work()`). WorkPlanner's existing `readOnly` flag is the
contractor share-view layout (it hides the Dashboard button) and its comments
deliberately allow lapsed users the image export, so it can't simply be
reused. Proposed: a lapsed banner in both, with editing switched off and
exports kept.

## Billing: only the Plotwire price should unlock

*Deferred 2 Oct 2026 (billing fixes 1 and 3; branch prelaunch).*

Any running subscription on the Stripe account counts, whatever its price
(`lib/billing.js` `planForPrice` only names the plan). That is fine while the
Stripe account sells nothing but Plotwire and the customer portal doesn't
allow plan switching. If another product or price is ever added, check
`price_id` against `STRIPE_PRICE` in the access rule (`supabase/try-mode.sql`
and its copy in `lib/access.js`). Until then the daily reconciliation report
(`lib/reconcile.js`) lists every running subscription for another price, or
with a quantity other than 1, under "Setup and data checks".

## Planner share links keep working after the owner lapses

*Deferred 2 Oct 2026 (billing fix 4, database enforcement; branch prelaunch).*

Once billing is enforced, a Try or lapsed account can't create or change a
planner share link (`supabase/try-mode.sql`, `guard_planner_share_token`). A
link that already exists keeps serving, though, because `planner_shared()`
checks only the token. That covers links made before launch and links made
while subscribed by someone whose subscription later ended. The go-live run
order (`supabase/RUN-ORDER.md` step 6e) revokes the existing ones once, but a
customer who lapses after launch keeps a working link. `planner_shared()`'s
body isn't recorded in the repo, so it was left untouched. To fix: record its
current body in `supabase/`, then make it return nothing when
`public.billing_enforced_for(owner)` is true and `public.access_level(owner)`
isn't `full`. Keep it SECURITY DEFINER with an empty search_path, and never
add "force row level security" to the planner tables.

## Reconciliation: card disputes aren't checked

*Deferred 2 Oct 2026 (billing fix 5, reconciliation; branch prelaunch).*

The daily reconciliation (`lib/reconcile.js`, `GET /api/admin/reconcile`)
flags a running subscription whose latest invoice was fully refunded, but not
one whose payment is being disputed (a chargeback): Stripe keeps the
subscription active, so the account stays full while the money is clawed
back. The webhook doesn't handle `charge.dispute.created` either. Until then,
treat a dispute email from Stripe like a refund: cancel the subscription in
the Dashboard. To add it: list `stripe.disputes` created in the last 35 days,
map each disputed charge's payment intent to its invoice (the same
`invoicePayments.list({ payment: { type: "payment_intent", ... } })` lookup
the refund check uses), and report it in the "Refunded but still running"
section.

## Sentry: the environment says "production" on previews

*Deferred 2 Oct 2026 (billing fix 6, Sentry alerts; branch prelaunch).*

`sentry.server.config.ts` and `instrumentation-client.ts` set
`environment: process.env.NODE_ENV`, and Vercel builds previews with
NODE_ENV=production, so preview events are filed under "production" (the edge
config sets no environment at all). The billing alerts work round it: every
event from `lib/alert.js` carries a `vercel_env` tag (and `stripe_mode`), and
the Sentry alert rule can filter on that. Left because changing it moves every
existing event and saved search. To fix: `environment: process.env.VERCEL_ENV
|| process.env.NODE_ENV` on the server and edge, and
`process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV` in the browser,
then give the billing alert rule the "production" environment, plus a separate
preview rule if wanted.

## Daily reconciliation: no alert if the cron stops running

*Deferred 2 Oct 2026 (billing fix 6, Sentry alerts; branch prelaunch).*

Sentry is told when the reconciliation finds problems, can't run or can't
email, but not when Vercel never calls it (cron removed, project paused,
deployments failing). Today the only sign is that the daily "Plotwire billing"
email stops arriving. `automaticVercelMonitors` in `next.config.js` doesn't
cover App Router routes. To add it: in `app/api/admin/reconcile/route.js`,
wrap the cron call (not `?email=0` runs) in
`Sentry.withMonitor("billing-reconcile", ..., { schedule: { type: "crontab",
value: "0 6 * * *" }, checkinMargin: 60, maxRuntime: 2, timezone: "Etc/UTC" })`,
check the Sentry plan includes a cron monitor, and add a "missed or failed
check-in" alert to admin@plotwire.uk.

## Sentry: email redaction for breadcrumbs only covers the billing alerts

*Deferred 2 Oct 2026 (billing fix 6 review; branch prelaunch).*

Sentry attaches recent breadcrumbs to every event. That includes console lines,
which can hold a raw error object with top-level fields such as `detail` or
`param`, and outgoing request URLs. `lib/alert.js` redacts email addresses in
the breadcrumbs of billing alert events only. It does this with an event
processor on the alert's own scope. Other server and browser events still send
breadcrumbs with only the token scrubber (`lib/sentryScrub.js`) applied. That
was true before fix 6 too. Nothing found logs an email on those paths today,
so it was left. To fix, make `beforeBreadcrumb` in `lib/sentryScrub.js` also
replace email-shaped strings with `[email]` (the same regex as `lib/alert.js`),
for the browser, server and edge alike.

## Sentry build plugin: local builds upload and send usage data

*Deferred 2 Oct 2026 (billing fix 7 review; branch prelaunch).*

A plain local `npm run build` runs the Sentry webpack plugin set up by
`withSentryConfig` in `next.config.js`. The plugin reads the gitignored
`.env.sentry-build-plugin` at the repo root, so with a valid token a local
build uploads source maps and creates a release in `plotwire-uk-ltd`, just as
a Vercel build does. It also sends the plugin's own usage data to
`o1.ingest.sentry.io` on every build. Local builds during the billing fixes
probably did both. That is harmless, because the same code is deployed later,
but it isn't intended. It was left because the fix changes the production
build config. To fix: in `withSentryConfig` add `telemetry: false` and
`sourcemaps: { disable: !process.env.VERCEL }` (or pass `authToken` only when
`VERCEL` is set), then check that a Vercel build still uploads source maps.

## Global CSS: `body > div { height: 100% }` stretches anything mounted under body

*Deferred 3 Oct 2026 (toast fix; branch prelaunch).*

`app/globals.css` gives `#__next, body > div` a height of 100%. Any element
that ends up as a direct child of `<body>` gets it, including fixed overlays
that are meant to size to their content. That is what stretched the "Payment
confirmed" toast to the full viewport height, and an earlier Try-mode chip the
same way. Both are now protected with inline sizes (`components/Toast.jsx`,
`components/TryMode.jsx`), which beat the rule. It was left because other
layout may rely on it. To fix: find what needs the full-height wrapper (most
likely the app root), give that element its own class or `h-full`, narrow the
rule to it, then check the dashboard, the editor, the sketch tool and every
modal and toast still lay out correctly.
