// What to tell someone when signing in, creating an account or a password
// step is refused. Supabase's own wording ("Invalid login credentials",
// "Email not confirmed") never reaches the screen: every refusal becomes a
// plain message that says what to do next.
//
//   authFailure(error, step) -> { code, message, resend }
//     step    "signin" | "signup" | "reset" | "resend" | "newpassword"
//     code    Supabase's error code, or "network" / "server" / "unknown";
//             safe to log (never holds an email address or password)
//     resend  true when the screen should offer "Resend confirmation email"
//
// What a 400 from sign-in (POST /auth/v1/token) can mean, by code:
//   invalid_credentials  wrong password, or no account with that email
//   email_not_confirmed  right password, but the confirmation link in the
//                        sign-up email hasn't been opened yet
//   captcha_failed       the security check (components/Turnstile.jsx) was
//                        missing, used already or refused
//   validation_failed    email or password missing or badly formed
//   user_banned          the account has been switched off
// Too many attempts come back as 429 (over_request_rate_limit), not 400.
//
// Used by components/LoginScreen.jsx. Plain functions so tests can run them
// (tests/inapp-browser.test.mjs).

export const SUPPORT_EMAIL = "admin@plotwire.uk";

export const NOT_CONFIRMED_MESSAGE =
  "Email not confirmed yet. Check your inbox and tap the link, then come back here.";

// Also components/Turnstile.jsx's CAPTCHA_MESSAGE.
export const CAPTCHA_MESSAGE =
  "The security check didn't go through. Wait for it to finish, then try again.";
const CAPTCHA = CAPTCHA_MESSAGE;
const NETWORK =
  "Couldn't reach Plotwire. Check your signal or Wi-Fi, then try again.";
const SERVER =
  "Signing in is having a problem at our end. Try again in a minute.";

const FALLBACK = {
  signin: "Couldn't sign you in. Check your email and password, then try again.",
  signup: "Couldn't create your account. Check your details, then try again.",
  reset: "Couldn't send the reset email. Try again in a minute.",
  resend: "Couldn't resend the confirmation email. Try again in a minute.",
  newpassword: "Couldn't save your new password. Try again, or ask for a new reset link.",
};

// Older Supabase servers and some errors carry no code; read the wording.
function codeFromMessage(message) {
  const m = String(message || "").toLowerCase();
  if (!m) return "";
  if (m.includes("invalid login credentials")) return "invalid_credentials";
  if (m.includes("email not confirmed")) return "email_not_confirmed";
  if (m.includes("captcha")) return "captcha_failed";
  if (m.includes("already registered") || m.includes("already exists")) return "user_already_exists";
  if (m.includes("email rate limit") || m.includes("only request this after")) return "over_email_send_rate_limit";
  if (m.includes("rate limit") || m.includes("too many")) return "over_request_rate_limit";
  if (m.includes("password should") || m.includes("weak password")) return "weak_password";
  if (m.includes("same as the old") || m.includes("different from the old")) return "same_password";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "signup_disabled";
  if (m.includes("banned")) return "user_banned";
  if (m.includes("auth session missing")) return "session_not_found";
  if (/failed to fetch|load failed|networkerror|network request failed/.test(m)) return "network";
  if (m.includes("invalid") && m.includes("email")) return "email_address_invalid";
  return "";
}

/** Supabase's error code for a refusal, or "network" / "server" / "unknown". */
export function authErrorCode(error) {
  if (!error) return "unknown";
  // No answer at all (status 0), or the auth server's gateway failing (502-504).
  if (error.name === "AuthRetryableFetchError") return error.status >= 500 ? "server" : "network";
  if (error.status === 0) return "network";
  if (typeof error.code === "string" && error.code) return error.code;
  if (error.name === "AuthWeakPasswordError") return "weak_password";
  if (error.name === "AuthSessionMissingError") return "session_not_found";
  const fromMessage = codeFromMessage(error.message);
  if (fromMessage) return fromMessage;
  if (typeof error.status === "number" && error.status >= 500) return "server";
  return "unknown";
}

function weakPasswordMessage(error) {
  const reasons = Array.isArray(error?.reasons) ? error.reasons : [];
  if (reasons.includes("pwned")) {
    return "That password has turned up in a data leak on another website. Choose a different one.";
  }
  return "That password is too easy to guess. Use a longer one with a mix of letters and numbers.";
}

/** The plain message for a refused sign-in, sign-up or password step. */
export function authFailure(error, step = "signin") {
  const code = authErrorCode(error);
  const fallback = FALLBACK[step] || FALLBACK.signin;
  const result = (message, resend = false) => ({ code, message, resend });

  switch (code) {
    case "invalid_credentials":
      return result("That email and password don't match. Check them and try again, or tap “Forgot password?” to set a new one.");
    case "email_not_confirmed":
      return result(NOT_CONFIRMED_MESSAGE, true);
    case "captcha_failed":
      return result(CAPTCHA);
    case "over_request_rate_limit":
      return result("Too many tries in a short time. Wait a minute, then try again.");
    case "over_email_send_rate_limit":
      return result("We've only just sent an email to this address. Wait a minute before asking for another, and check your junk folder.");
    case "user_already_exists":
    case "email_exists":
      return result("There's already an account with this email. Sign in instead, or tap “Forgot password?” if you can't remember the password.");
    case "weak_password":
      return result(weakPasswordMessage(error));
    case "same_password":
      return result("That's the password you already have. Choose a different one.");
    case "email_address_invalid":
      return result("That email address doesn't look right. Check it for typos, then try again.");
    case "email_address_not_authorized":
      return result(`We can't send email to that address yet. Try a different one, or email ${SUPPORT_EMAIL}.`);
    case "validation_failed":
      return result(step === "newpassword"
        ? "That password can't be used. Choose a different one."
        : "Check your email address and password are filled in correctly, then try again.");
    case "signup_disabled":
    case "email_provider_disabled":
      return result(step === "signup"
        ? `New accounts can't be created right now. Try again later, or email ${SUPPORT_EMAIL}.`
        : `Signing in with email is switched off right now. Try again later, or email ${SUPPORT_EMAIL}.`);
    case "user_banned":
      return result(`This account can't sign in. Email ${SUPPORT_EMAIL} if you think that's a mistake.`);
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return result(step === "newpassword"
        ? "This reset link has run out. Go back to sign in and tap “Forgot password?” for a new one."
        : fallback);
    case "network":
    case "request_timeout":
      return result(NETWORK);
    case "server":
    case "unexpected_failure":
    case "hook_timeout":
    case "hook_timeout_after_retry":
      return result(SERVER);
    default:
      return result(fallback);
  }
}
