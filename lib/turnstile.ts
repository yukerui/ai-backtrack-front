export const TURNSTILE_VERIFY_PATH = "/verify";
export const TURNSTILE_REDIRECT_PARAM = "redirect";

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

export function buildTurnstileVerificationPath(redirectPath: string) {
  const searchParams = new URLSearchParams({
    [TURNSTILE_REDIRECT_PARAM]: normalizeTurnstileRedirectPath(redirectPath),
  });

  return `${TURNSTILE_VERIFY_PATH}?${searchParams.toString()}`;
}
