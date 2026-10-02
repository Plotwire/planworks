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

## Remove the unused `docx` package

*Deferred 26 Sep 2026 (BOQ outputs, branch boq-outputs).*

`lib/boqDocx.js`, the only code that used `docx`, was deleted as dead code.
The `docx` entry in `package.json` is now unused. Removing it with
`npm uninstall docx` also rewrites `package-lock.json`, so it waits until after
launch.

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
