export const TURNSTILE_CHALLENGE_PATH = "/challenge";
export const TURNSTILE_RETURN_TO_PARAM = "returnTo";
export const TURNSTILE_VERIFIED_SESSION_KEY = "cf_turnstile_verified_v1";

export function getTurnstileSiteKey() {
  return (
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY?.trim() ||
    ""
  );
}

export function isTurnstileEnabled() {
  return Boolean(getTurnstileSiteKey());
}

export function shouldRequireTurnstileVerification(pathname: string) {
  if (pathname === "/") {
    return true;
  }

  if (pathname === "/chat/history") {
    return false;
  }

  return /^\/chat\/[^/]+$/.test(pathname);
}

export function normalizeTurnstileRedirectPath(
  value: string | null | undefined
) {
  const normalized = value?.trim();

  if (
    !normalized ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//")
  ) {
    return "/";
  }

  return normalized;
}

export function buildTurnstileChallengePath(redirectPath: string) {
  const searchParams = new URLSearchParams({
    [TURNSTILE_RETURN_TO_PARAM]: normalizeTurnstileRedirectPath(redirectPath),
  });

  return `${TURNSTILE_CHALLENGE_PATH}?${searchParams.toString()}`;
}

export function hasTurnstileVerifiedSession() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.sessionStorage.getItem(TURNSTILE_VERIFIED_SESSION_KEY) === "1";
}

export function setTurnstileVerifiedSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(TURNSTILE_VERIFIED_SESSION_KEY, "1");
}

export function clearTurnstileVerifiedSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(TURNSTILE_VERIFIED_SESSION_KEY);
}
