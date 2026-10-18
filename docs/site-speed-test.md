# Weak-signal speed: test steps (branch site-speed)

Run these on the **stripe-plotwire-test** link, signed in with the test account,
using **test drawings only** (name them `TEST …`). Tests 1–9 are in **Edge on
the laptop**, using DevTools to fake a weak signal or none. Test 10 is on the
**iPad**, with Airplane Mode. Delete the TEST drawings afterwards.

Each test says what used to happen and what you should see now.

## What's new, in one paragraph

The app now keeps its own code, the drawings opened on this device (the last
30), their plan images (the last 80), and the dashboard list on the device.
It opens from those at once, then checks for anything newer in the
background. Every Save goes to the device first and uploads by itself when
there's signal. The bottom-right of the editor's status bar says where it is:
**SAVED ON THIS DEVICE**, **SYNCED**, or **WAITING FOR SIGNAL** (amber dot; tap
it to try again now). Signing out wipes all of it from the device.

## Setting up Edge (once)

1. Open the stripe-plotwire-test link in Edge and sign in.
2. Make two drawings if you haven't got them: **TEST site A** (import a plan
   image or PDF, place a few symbols, Save) and **TEST site B** (a blank sheet
   with a few symbols, Save).
3. Press **F12** to open DevTools and click the **Network** tab. Near the top
   is a drop-down that says **No throttling**. That's where you pick **Slow
   3G** or **Offline**. Leave **Disable cache** unticked.
4. DevTools only fakes the signal for **the tab it's open in**, and keeps
   doing it when you reload that tab. Other tabs have normal signal.
5. Optional: the **Application** tab → **Service workers** should show
   `sw.js` as **activated and is running**. If it doesn't, reload once.

---

## 1. The app opens with no signal

1. With normal signal, load the dashboard. Open **TEST site A** and wait 10
   seconds, then go back to the dashboard.
2. Network → **Offline**. Reload the page (**Ctrl+R**).

**Before:** Edge's "You're not connected" page. On a weak signal, the
"Loading Plotwire…" splash sat there while the app checked your account,
terms and company profile one after another.

**Now:** the dashboard appears within a second or two, thumbnails included,
with an amber bar: **No signal. These are your drawings as this device last
saw them.** It has a **Try now** button.

3. Open **TEST site A**. It opens at once with its plan. The status bar says
   **SYNCED** (nothing of yours is waiting).
4. Go back. Open a TEST drawing you have **not** opened on this laptop: **This
   drawing didn't open**, with Back and Retry, as before. Nothing has been
   changed.

Set Network back to **No throttling**.

---

## 2. Dashboard on a weak signal

1. Network → **Slow 3G**. Reload.

**Before:** the list took several seconds. Then every thumbnail downloaded
its full plan image one by one (about 140 KB each), on every visit.

**Now:** the cards and thumbnails appear at once from the laptop. The list
refreshes quietly in the background. A thumbnail's image downloads once per
device, ever.

---

## 3. Opening a drawing on a weak signal

Stay on **Slow 3G**.

1. Open **TEST site A** (opened before on this laptop).

**Before:** **Opening drawing…** for several seconds, then the plan image
appeared later still.

**Now:** it's on screen at once, plan and all, and you can work straight
away. The server is checked in the background. If another device saved a
newer version and you haven't changed anything yet, it swaps to that one
and says **Updated to the latest version from the server.** If you have
changed something, it says your changes will be saved as a copy (test 7).

2. Open a TEST drawing you've never opened on this laptop: **Opening
   drawing…** as before, the first time only.

---

## 4. Placing, moving and deleting symbols never wait

On **Slow 3G** or **Offline**, drag symbols in, move them, delete them, undo
and redo. All of it is instant. Nothing shows a spinner or waits for the
network.

---

## 5. Saving with no signal

1. Network → **Offline**. In **TEST site A**, place **3** symbols. Tap
   **Save**.

**Before:** the save failed, or hung until it timed out.

**Now:** it saves at once. The status bar says **WAITING FOR SIGNAL** with an
amber dot. Hover it (or tap it on the iPad) for the explanation.

2. Tap the **Dashboard** arrow. It goes straight away. The amber bar says
   **1 save is waiting for signal. It's safe on this device and will upload by
   itself when there's signal.** The card says **Waiting for signal**.
3. Reload the page, still Offline. Open **TEST site A**: your 3 symbols are
   there.
4. Close the tab. Open the link in a new tab (it has normal signal).

**Now:** within a few seconds the save uploads by itself. Open **TEST site
A**: the 3 symbols are there and the status bar says **SYNCED**.

---

## 6. Saving on a weak signal

1. Network → **Slow 3G**. Place a symbol in **TEST site A**. Tap **Save**.

**Now:** **SAVED ON THIS DEVICE** at once, then **SYNCED** a few seconds
later.

2. Place another symbol, tap **Save** and straight away tap the **Dashboard**
   arrow.

**Before:** leaving waited for the save to finish.

**Now:** the dashboard appears at once. The save carries on in the
background.

Set Network back to **No throttling**.

---

## 7. Drawing safety still holds

A waiting save never writes over a newer version saved anywhere else. As
before, your work is kept as **"… (copy)"** instead, and the app says so.

**a. Another device saved first**

1. Laptop: open **TEST site B**. Network → **Offline**. Place **1** symbol and
   **Save** (**WAITING FOR SIGNAL**).
2. iPad (or an Edge InPrivate window signed in to the test account): open
   **TEST site B**, place **5** symbols and **Save**.
3. Laptop: Network → **No throttling**.

**Now:** within a few seconds, a message: **This drawing was changed somewhere
else (another tab or device) after it was opened here, so your version can't
replace it. Your work has been saved as a new drawing, "TEST site B
(copy)".** The laptop carries on in the copy. On the dashboard, **TEST site
B** has the iPad's 5 symbols and **TEST site B (copy)** has the laptop's 1.

**b. The same drawing in two tabs on the laptop**

1. Open **TEST site A** in two tabs. Open DevTools in **both** and set both
   to **Offline**.
2. Tab 1: place 1 symbol, **Save**.
3. Tab 2: place 2 symbols, **Save**.

**Now:** tab 2 says your work has been saved as a new drawing, **"TEST site A
(copy)"**. Tab 2 never saw tab 1's save, so it can't replace it.

4. Set **No throttling** in both tabs. Both saves upload: **TEST site A**
   has tab 1's symbol, and the copy has tab 2's two.

If instead you **reload** tab 2 after tab 1's save (step 2), tab 2 opens
showing tab 1's symbol. Saving there joins the same waiting save, with no
copy, because tab 2 has seen it.

---

## 8. Importing a plan on a weak signal

1. Network → **Slow 3G**. Dashboard → **Blank A3 sheet** → **Import** → pick a
   plan image. Straight away, place a symbol and tap **Save**.

**Before:** **Finishing plan upload** covered the screen until the plan
had uploaded.

**Now:** **SAVED ON THIS DEVICE** at once, then **SYNCED** once the plan and
the drawing are up. Open it from the dashboard: plan and symbol are there.

2. Network → **Offline**. **Blank A3 sheet** → **Import** a plan → place a
   symbol → **Save**: **WAITING FOR SIGNAL**. Reload (still Offline): the plan
   and the symbol are still there. Network → **No throttling**: **SYNCED**,
   and the dashboard card shows the plan.

---

## 9. Signing out clears the laptop; another account sees nothing

1. Network → **Offline**. Place a symbol in a TEST drawing and **Save**
   (**WAITING FOR SIGNAL**). Go to the dashboard and tap the **sign-out**
   icon.

**Now:** a warning: **1 save is still waiting for signal on this device. If
you log out now, those changes will be lost.** Tap **Cancel**. Nothing
changes.

2. Network → **No throttling**. Wait until the amber bar has gone (the save
   is up). Sign out.
3. In DevTools: **Application** → **IndexedDB** → **plotwire-device**.
   Right-click → **Refresh**. **drawings**, **images**, **lists** and
   **outbox** are all empty. (**Cache storage** still holds the app's own
   code. No drawings are in it.)
4. If you have a second test account, sign in with it. Its dashboard shows
   only its own drawings. Network → **Offline**, reload: still only its own.

---

## 10. iPad (Safari)

1. With signal: open the stripe-plotwire-test link in Safari and sign in.
   Open the dashboard. Open **TEST site A** and **TEST site B**, waiting 10
   seconds on each. This puts the app and both drawings on the iPad.
2. Turn on **Airplane Mode**, and make sure Wi-Fi is off too.
3. Swipe Safari away in the app switcher. Open Safari again and go to the
   link.

**Before:** "Safari cannot open the page because your iPad is not connected
to the internet."

**Now:** the app opens with the amber **No signal** bar, and the drawings
and thumbnails are there.

4. Open **TEST site A**. It's there at once with its plan. Place 3 symbols,
   move one, delete one: all instant. Tap **Save**: **WAITING FOR SIGNAL**.
5. Go back to the dashboard: **1 save is waiting for signal**.
6. Turn Airplane Mode off. Within a few seconds the bar goes. Or tap **Try
   now**, or **WAITING FOR SIGNAL** in the editor. Check on the laptop: TEST
   site A has the changes.
7. On site with a genuinely poor signal, repeat steps 4 to 6 without
   Airplane Mode. Opening, placing and saving should never wait.

If Plotwire is on the iPad's **Home Screen** (Add to Home Screen), repeat
steps 1–6 from that icon too. It keeps its own storage, separate from
Safari's.

Good to know: Safari may clear a website's stored data if it isn't used for
about a week. The app asks Safari to keep it. Saves waiting for signal are
only at risk if the iPad isn't used with Plotwire for that long.

---

## 11. Kill switch: turning the service worker off everywhere

If the cached app ever causes trouble, one deploy removes it from every
device. Saves waiting to upload are kept and still go up. Only the app's
cached code and pages are removed.

**How to switch it off:** in Vercel, add the environment variable
`NEXT_PUBLIC_SW_OFF` = `1` to the deployment (for this test, the
stripe-plotwire-test preview only) and redeploy. (Without Vercel: copy
`public/sw-off.js` over `public/sw.js` and deploy. It does the same.)
**To switch it back on:** remove the variable and redeploy.

1. Before switching it off, on the laptop with signal: open the app.
   DevTools → **Application** → **Service workers** shows `sw.js` running, and
   **Cache storage** lists `plotwire-static-v1` and `plotwire-pages-…`.
2. Network → **Offline**. Open a TEST drawing, place a symbol, **Save**
   (**WAITING FOR SIGNAL**). Leave the tab open.
3. Switch it off (above) and wait for the deploy to finish.
4. Network → **No throttling**, then reload the tab.

**Now:**
- **Service workers** shows nothing for the site.
- **Cache storage** has no `plotwire-…` caches.
- **IndexedDB** → **plotwire-device** → **outbox** still holds the waiting
  save, and within a few seconds it uploads. The amber bar goes and the
  drawing has the symbol.

5. Go to `/sw.js` in the address bar. The file starts **Plotwire service
   worker: SWITCHED OFF**.
6. **iPad:** open the app (with signal). It switches itself off the same way.
   A tab left open in the background also picks it up within 30 minutes of
   being brought back into view. With Airplane Mode on, the app no longer
   opens. That's expected while it's switched off.
7. Switch it back on, wait for the deploy, and reload twice. **Service
   workers** shows `sw.js` running again.

---

Delete the TEST drawings when done, including the **(copy)** ones.
