"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import LoginScreen from "@/components/LoginScreen";
import ComingSoon from "@/components/ComingSoon";
import Paywall from "@/components/Paywall";
import BusinessInfo from "@/components/BusinessInfo";
import { hasCompanyProfile, getCompanyProfile } from "@/lib/companyProfile";
import { listCompanyLogos } from "@/lib/companyLogos";
import { supabase, isConfigured } from "@/lib/supabase";
import { getSettings, saveSettings } from "@/lib/db";
import { clearSignedOutDeviceData } from "@/lib/deviceData";
import { DEFAULT_TITLEBLOCK, normaliseTitleBlock, companyProfileToTitleBlock, companyLogoFrom, mergeTitleBlocks } from "@/lib/titleBlock";
import { useSubscription } from "@/lib/useSubscription";
import { useCheckoutReturn } from "@/lib/useCheckoutReturn";
import { PAYMENT_PENDING_MESSAGE } from "@/lib/checkoutReturn";
import { ConfirmingPayment, PaymentNote } from "@/components/PaymentStatus";
import { TRY_SYMBOL_LIMIT } from "@/lib/pricing";
import { isPaymentOverdue } from "@/lib/access";
import { openBillingPortal, syncSubscriptionFromStripe } from "@/lib/billingClient";
import { LEGAL_LINKS } from "@/lib/legal";
import TermsGate from "@/components/TermsGate";
import RotateNotice from "@/components/RotateNotice";
import { hasAcceptedCurrentTerms, recordTermsAcceptance, acceptedAtSignup } from "@/lib/termsAcceptance";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx) || {};

function Splash({ label = "Loading Plotwire…" }) {
  return (
    <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117]">
      <div className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">{label}</div>
    </div>
  );
}

const ACTION_BTN = "bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)]";

// Coming Soon holding page: while it's on, visitors who aren't signed in see
// the "Coming Soon" page instead of the login (the owner's way past it is the
// discreet "Sign in" link, or ?login / #login). It is ON unless the Vercel
// environment variable NEXT_PUBLIC_COMING_SOON is "false", "0" or "off" (any
// case, spaces ignored); unset or anything else keeps the holding page up.
// NEXT_PUBLIC_* values are fixed when the app is BUILT (Next writes them into
// the browser code), so changing it in Vercel only takes effect after a
// redeploy. Written out in full on purpose: Next only fills in a literal
// process.env.NEXT_PUBLIC_... reference.
const COMING_SOON = !["false", "0", "off"].includes(
  String(process.env.NEXT_PUBLIC_COMING_SOON ?? "true").trim().toLowerCase()
);

// Billing is on and the account's access level couldn't be checked yet (the
// database didn't answer). In place of the app, never Try: showing a paying or
// exempt account the Try limits because of a network blip would be wrong. It
// keeps retrying by itself (lib/useSubscription.js); "Try again" checks now.
function AccessCheckFailed({ onRetry, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try { await onRetry?.(); } finally { setBusy(false); }
  };
  return (
    <div className="w-full min-h-screen flex items-center justify-center px-4 text-white"
      style={{ background: "linear-gradient(150deg,#1A2530 0%,#233241 55%,#2C4150 100%)" }}>
      <main role="alert" className="max-w-[420px] w-full text-center">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">We couldn&rsquo;t check your subscription</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#aab8c6]">
          Check your connection. We&rsquo;ll keep trying, or you can try again now. Your drawings are safe.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={retry} disabled={busy}
            className={`h-11 px-5 rounded-[11px] text-[14px] font-semibold transition-colors disabled:opacity-60 ${ACTION_BTN}`}>
            {busy ? "Checking…" : "Try again"}
          </button>
          <button type="button" onClick={onSignOut}
            className={`h-11 px-5 rounded-[11px] text-[14px] font-semibold transition-colors ${ACTION_BTN}`}>
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}

// Public, read-only pages that must NOT be behind any gate -- login, Coming
// Soon, terms acceptance or paywall: the planner share link contractors open
// without a Plotwire account, the legal documents (which people must be able
// to read before they sign up or accept them), and the page the "Confirm your
// email" and "Reset your password" links land on (it signs the user in, then
// sends them into the app, where the gates apply).
const PUBLIC_PATHS = [
  "/planner/view",
  LEGAL_LINKS.terms, LEGAL_LINKS.privacy, LEGAL_LINKS.dataProcessing,
  "/auth/confirm",
];
const isPublicPath = (pathname) =>
  typeof pathname === "string" && PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));

// Every page renders inside this: the gates below, plus the "please rotate"
// notice for tablets held in portrait (components/RotateNotice.jsx). The
// notice sits BESIDE the app, not around it, and shows or hides by CSS alone,
// so turning the device never unmounts anything. Public pages don't get it.
export default function AppShell({ children }) {
  const pathname = usePathname();
  return (
    <>
      <AppGates>{children}</AppGates>
      {!isPublicPath(pathname) && <RotateNotice />}
    </>
  );
}

function AppGates({ children }) {
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    try { return localStorage.getItem("planworks:theme") || "light"; } catch { return "light"; }
  });
  const [session, setSession] = useState(null);
  // Owner route past the Coming Soon page (COMING_SOON, above): the discreet
  // "Sign in" link, or ?login / #login.
  const [showLogin, setShowLogin] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [checking, setChecking] = useState(true);
  const [titleBlock, setTitleBlock] = useState(null); // null until loaded → default in the meantime
  // Title block derived from company_profile, the authoritative source of
  // company identity. null when the account hasn't filled one in, which is what
  // makes the legacy user_settings block a safe fallback below.
  const [companyBlock, setCompanyBlock] = useState(null);
  const [companyLogo, setCompanyLogo] = useState(null); // company logo data-URI (BOQ documents)
  const [boqTemplate, setBoqTemplate] = useState(null); // null = use built-in default
  const [boqPrefs, setBoqPrefs] = useState(null);       // { vatOn } for new BOQs; null = defaults
  const settingsRef = useRef({}); // latest full settings blob, so saves merge

  // --- Billing gate state ---
  // Billing ships dark: the paywall only enforces when this flag is explicitly
  // turned on in the environment. Until then the app behaves exactly as before
  // (no gate), so a half-configured Stripe can never lock users out. Set
  // NEXT_PUBLIC_BILLING_ENABLED=true in Vercel once Stripe is live and tested.
  const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
  const subscription = useSubscription(BILLING_ENABLED ? session : null);
  // Back from Stripe Checkout: "Confirming your payment…" until the webhook
  // has unlocked the account (lib/checkoutReturn.js). The return URL itself
  // grants nothing. If the webhook is late or lost, the server is asked to
  // check with Stripe itself (POST /api/billing/sync).
  const checkoutReturn = useCheckoutReturn({
    enabled: BILLING_ENABLED,
    userId: session?.user?.id || null,
    ready: !subscription.loading,
    full: subscription.level === "full",
    refresh: subscription.refresh,
    sync: syncSubscriptionFromStripe,
  });
  const beginCheckoutReturn = checkoutReturn.begin;

  // ---- First-login company details ----------------------------------------
  // "unknown" until we know whether this account has a company_profile row;
  // "needed" shows the one-screen onboarding; "ok" means carry on into the app.
  const [profileStep, setProfileStep] = useState("unknown");
  // Skipping is remembered HERE, on the device, not by writing a placeholder
  // row. Writing an empty row to suppress the prompt would leave a junk record
  // that makes "have they filled this in?" unanswerable ever after.
  const skipKey = (uid) => "plotwire:onboardingSkipped:" + uid;
  const [billingNotice, setBillingNotice] = useState("");
  // The Subscribe screen, opened from Subscribe buttons in the app. Nobody is
  // made to see it first: never-paid accounts use Try mode instead.
  const [showSubscribe, setShowSubscribe] = useState(false);
  const openSubscribe = useCallback(() => { setBillingNotice(""); setShowSubscribe(true); }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("planworks:theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    if (!isConfigured || !supabase) { setChecking(false); setSession(false); return; }
    let active = true;
    // A password-reset link lands back here carrying a recovery token in the URL
    // hash. Flag it before the app renders so we show the set-password screen
    // instead of dropping the user straight into the app.
    if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
      setRecovery(true);
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || false);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (_e === "PASSWORD_RECOVERY") setRecovery(true);
      if (_e === "SIGNED_OUT") setRecovery(false);
      setSession(s || false);
      setChecking(false);
    });
    return () => { active = false; sub?.subscription?.unsubscribe(); };
  }, []);

  // ---- Terms acceptance (before the paywall and the app) --------------------
  // step: "unknown" while checking, "needed" shows the acceptance page, "ok"
  // lets the user on. Checked once per signed-in user, not on every token
  // refresh. Any failure keeps the user on the acceptance page, never lets
  // them through. See lib/termsAcceptance.js.
  //
  // The state carries the user id it belongs to, and a result only lands if
  // it is still for that user: a slow check or accept for one account can
  // never let another account (signed in since, on the same device) through.
  const [terms, setTerms] = useState({ uid: null, step: "unknown", error: "" });
  const sessionUserId = session?.user?.id || null;
  const termsStep = terms.uid === sessionUserId ? terms.step : "unknown";
  const termsError = terms.uid === sessionUserId ? terms.error : "";
  const setTermsFor = useCallback(
    (uid, patch) => setTerms(t => (t.uid === uid ? { ...t, ...patch } : t)),
    []
  );

  useEffect(() => {
    const user = session?.user;
    setTerms({ uid: user?.id || null, step: "unknown", error: "" });
    if (!user) return;
    // Also ignore this check once a newer one has started, even for the same
    // user (signed out and back in elsewhere): its answer may be out of date.
    let active = true;
    const land = (patch) => { if (active) setTermsFor(user.id, patch); };
    (async () => {
      try {
        if (await hasAcceptedCurrentTerms(user.id)) { land({ step: "ok" }); return; }
        // Accepted on the sign-up form, before there was a session to record
        // it with (email confirmation): record it now, on the first sign-in.
        if (acceptedAtSignup(user)) {
          await recordTermsAcceptance(user.id);
          land({ step: "ok" });
          return;
        }
        land({ step: "needed" });
      } catch (err) {
        console.warn("terms acceptance check failed:", err?.message);
        land({
          step: "needed",
          error: "We couldn't confirm that you've accepted the current terms. Tick both boxes and try again.",
        });
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per user, not per token refresh
  }, [sessionUserId]);

  const acceptTerms = useCallback(async () => {
    const uid = sessionUserId;
    if (!uid) return;
    setTermsFor(uid, { error: "" });
    try {
      await recordTermsAcceptance(uid);
      setTermsFor(uid, { step: "ok" });
    } catch (err) {
      console.warn("terms acceptance save failed:", err?.message);
      setTermsFor(uid, { error: "Your acceptance couldn't be saved, so you can't continue yet. Check your connection and try again." });
    }
  }, [sessionUserId, setTermsFor]);

  const toggleTheme = useCallback(() => setTheme(t => (t === "dark" ? "light" : "dark")), []);
  // Resolves to "" when signed out, or a message when it didn't go through
  // (e.g. offline: Supabase keeps the session until it can reach the server).
  // Callers that don't show messages can ignore it.
  const forgetCheckoutReturn = checkoutReturn.forget;
  const signOut = useCallback(async () => {
    const failed = "Couldn't log out. Check your connection and try again.";
    try {
      const { error } = (await supabase?.auth.signOut()) || {};
      if (error) return failed;
      // Signed out: don't leave client details or per-user flags on this
      // device (lib/deviceData.js). Only on success -- a failed sign-out keeps
      // the session, so it keeps the crash-recovery draft too.
      clearSignedOutDeviceData();
      // Nor a remembered return from Stripe: signing out on purpose isn't the
      // "session expired on the way back" case that sends them to sign-in.
      forgetCheckoutReturn();
      return "";
    } catch {
      return failed;
    }
  }, [forgetCheckoutReturn]);

  // Open the Stripe Customer Portal (change plan / card / cancel).
  const manageBilling = useCallback(async () => {
    try { await openBillingPortal(); }
    catch (e) { setBillingNotice(e?.message || "Couldn't open the billing portal. Try again in a moment."); }
  }, []);

  // Read the ?checkout= flag Stripe appends to our return URL, then strip it so
  // a reload doesn't re-trigger. success → wait for the webhook (remembered for
  // this tab, so a reload keeps waiting); cancelled → a gentle note on the
  // paywall.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("checkout");
    if (!flag) return;
    params.delete("checkout");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    if (flag === "success") beginCheckoutReturn();
    else if (flag === "cancelled" || flag === "canceled") {
      setBillingNotice("Checkout cancelled — subscribe whenever you're ready.");
      setShowSubscribe(true);
    }
  }, [beginCheckoutReturn]);

  // Load the account's saved settings (title block + BOQ preset) once signed in.
  useEffect(() => {
    if (!session) { setTitleBlock(null); setBoqTemplate(null); setBoqPrefs(null); return; }
    let active = true;
    getSettings().then(s => {
      if (!active) return;
      settingsRef.current = s || {};
      setTitleBlock(s?.titleBlock ? normaliseTitleBlock(s.titleBlock) : DEFAULT_TITLEBLOCK);
      setBoqTemplate(s?.boqTemplate || null);
      setBoqPrefs(s?.boqPrefs || null);
    });
    return () => { active = false; };
  }, [session]);

  // Runs once per signed-in session, alongside the settings load above.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) { setProfileStep("unknown"); return; }
    let active = true;
    try {
      if (localStorage.getItem(skipKey(uid))) { setProfileStep("ok"); return; }
    } catch { /* storage unavailable -- fall through to the query */ }
    hasCompanyProfile().then(has => {
      if (active) setProfileStep(has ? "ok" : "needed");
    });
    return () => { active = false; };
  }, [session]);

  const skipOnboarding = useCallback(() => {
    const uid = session?.user?.id;
    try { if (uid) localStorage.setItem(skipKey(uid), "1"); } catch { /* not fatal */ }
    setProfileStep("ok");
  }, [session]);

  // Read on sign-in, and again after the business information screen saves.
  const refreshCompany = useCallback(async () => {
    try {
      const [profile, logos] = await Promise.all([getCompanyProfile(), listCompanyLogos()]);
      setCompanyBlock(companyProfileToTitleBlock(profile, logos));
      setCompanyLogo(companyLogoFrom(profile, logos));
    } catch (err) {
      console.warn("company profile load failed:", err && err.message);
      setCompanyBlock(null);
      setCompanyLogo(null);
    }
  }, []);

  useEffect(() => {
    if (!session) { setCompanyBlock(null); setCompanyLogo(null); return; }
    refreshCompany();
  }, [session, refreshCompany]);

  const saveTitleBlock = useCallback(async (tb) => {
    const next = normaliseTitleBlock(tb);
    settingsRef.current = { ...settingsRef.current, titleBlock: next };
    await saveSettings(settingsRef.current);
    setTitleBlock(next);
  }, []);

  // Presets = the item template plus BOQ preferences, saved together.
  const saveBoqTemplate = useCallback(async (tpl, prefs) => {
    settingsRef.current = { ...settingsRef.current, boqTemplate: tpl, ...(prefs ? { boqPrefs: prefs } : {}) };
    await saveSettings(settingsRef.current);
    setBoqTemplate(tpl);
    if (prefs) setBoqPrefs(prefs);
  }, []);

  // One BOQ preference (e.g. the last quote export choice), merged in and saved
  // with the account's settings. Best effort: a failed save only means it
  // isn't remembered next time.
  const saveBoqPrefs = useCallback(async (patch) => {
    const next = { ...(settingsRef.current.boqPrefs || {}), ...patch };
    settingsRef.current = { ...settingsRef.current, boqPrefs: next };
    setBoqPrefs(next);
    try { await saveSettings(settingsRef.current); } catch (e) { console.warn("BOQ preference save failed:", e?.message); }
  }, []);

  if (isPublic) {
    return (
      <AppCtx.Provider value={{ theme, toggleTheme, user: null }}>
        {children}
      </AppCtx.Provider>
    );
  }

  if (checking) return <Splash />;
  if (recovery) return <LoginScreen recovery onRecovered={() => setRecovery(false)} />;
  if (!session) {
    // Back from Stripe but signed out (session expired, or another address):
    // straight to sign-in, never the holding page, then on to confirming.
    const wantLogin = showLogin || checkoutReturn.awaitingSignIn ||
      (typeof window !== "undefined" && /[?&#]login(=1)?\b/.test(window.location.search + window.location.hash));
    if (COMING_SOON && !wantLogin) return <ComingSoon onSignIn={() => setShowLogin(true)} />;
    return <LoginScreen />;
  }

  // Signed in — the terms come first, before the paywall and everything else.
  if (termsStep === "unknown") return <Splash />;
  if (termsStep === "needed") {
    return <TermsGate user={session?.user || null} onAccept={acceptTerms} onSignOut={signOut} error={termsError} />;
  }

  // Then billing, only when it's switched on. Every signed-in account gets into
  // the app: "full" as normal, "try" with the symbol cap, watermark and locked
  // exports, "lapsed" read-only. The level is the one the database decides and
  // enforces (my_access(), lib/useSubscription.js; the rule is written out in
  // lib/access.js). With billing off, everyone is full, exactly as before.
  const level = BILLING_ENABLED ? subscription.level : "full";
  if (BILLING_ENABLED) {
    // Not known yet: the splash, retrying -- never Try because a check failed.
    if (subscription.loading) {
      return subscription.failed
        ? <AccessCheckFailed onRetry={subscription.refresh} onSignOut={signOut} />
        : <Splash />;
    }
    // Just back from Stripe and not unlocked yet. In place of the app: this
    // only follows a fresh page load (the return from Stripe), so there is no
    // open drawing to lose.
    if (checkoutReturn.confirming) {
      return <ConfirmingPayment canContinue={checkoutReturn.canContinue} onContinue={checkoutReturn.continueNow} />;
    }
  }
  // Still waiting on Stripe after the confirming screen: say so instead of
  // pitching Try or "your subscription has ended" as if they hadn't paid.
  const paymentPending = BILLING_ENABLED && checkoutReturn.pending && level !== "full";
  // Lapsed because a payment is owed (past_due beyond the grace, or unpaid),
  // not because the subscription ended: told to pay in Billing, not to
  // re-subscribe (lib/access.js isPaymentOverdue).
  const paymentOverdue = BILLING_ENABLED && isPaymentOverdue(level, subscription.status);
  // Drawn OVER the app, not instead of it: swapping the app out would unmount
  // an open drawing and lose unsaved work.
  const subscribeScreen = BILLING_ENABLED && showSubscribe && level !== "full" ? (
    <Paywall
      user={session?.user || null}
      onSignOut={signOut}
      onManageBilling={manageBilling}
      onBack={() => setShowSubscribe(false)}
      hasLapsed={level === "lapsed"}
      paymentOverdue={paymentOverdue}
      notice={billingNotice || (paymentPending ? PAYMENT_PENDING_MESSAGE : "")}
    />
  ) : null;
  const paymentNote = !BILLING_ENABLED || subscribeScreen ? null
    : paymentPending && checkoutReturn.showPendingBanner ? (
      <PaymentNote
        message={PAYMENT_PENDING_MESSAGE}
        onCheck={checkoutReturn.checkAgain}
        checking={checkoutReturn.checking}
        onDismiss={checkoutReturn.dismissPending}
      />
    ) : checkoutReturn.showConfirmedNote && level === "full" ? (
      <PaymentNote
        message="Payment confirmed. Thanks for subscribing to Plotwire."
        onDismiss={checkoutReturn.dismissConfirmed}
      />
    ) : null;

  // Waiting on the profile check -- brief, and only on a fresh sign-in.
  if (profileStep === "unknown") return <Splash />;

  return (
    <AppCtx.Provider value={{
      theme, toggleTheme, user: session?.user || null, signOut,
      // Merged, not replaced: the profile wins per field, and any legacy line
      // or scheme logo it does not cover is carried through.
      titleBlock: mergeTitleBlocks(companyBlock, titleBlock) || DEFAULT_TITLEBLOCK, saveTitleBlock, refreshCompany,
      boqTemplate, boqPrefs, saveBoqTemplate, saveBoqPrefs,
      // Business information, for document headers: the company logo alone and
      // the profile's detail lines (name first).
      companyBrand: { logo: companyLogo, details: companyBlock?.details || [] },
      subscription, manageBilling,
      // What this account may do (lib/access.js). isTry: 25-symbol cap,
      // watermark, no exports. readOnly: lapsed -- view and export only.
      access: {
        level,
        isTry: level === "try",
        readOnly: level === "lapsed",
        // readOnly because a payment is owed, not because it ended.
        paymentOverdue,
        symbolLimit: TRY_SYMBOL_LIMIT,
        openSubscribe,
        // Back from Stripe, payment not confirmed yet (see paymentPending).
        paymentPending,
      },
    }}>
      {profileStep === "needed" ? (
        <BusinessInfo
          onboarding
          onSkip={skipOnboarding}
          onSaved={refreshCompany}
          onClose={() => setProfileStep("ok")}
        />
      ) : children}
      {subscribeScreen}
      {paymentNote}
    </AppCtx.Provider>
  );
}

