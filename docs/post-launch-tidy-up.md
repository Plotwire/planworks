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
