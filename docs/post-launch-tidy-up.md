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
