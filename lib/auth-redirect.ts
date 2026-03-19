export const AUTH_REDIRECT_QUERY_PARAM = "redirectTo";
export const DEFAULT_AUTH_REDIRECT_PATH = "/";

const AUTH_PAGES = new Set(["/login", "/register"]);

export function normalizeAuthRedirectPath(value: string | null | undefined) {
	const normalized = value?.trim();

	if (
		!normalized ||
		!normalized.startsWith("/") ||
		normalized.startsWith("//") ||
		AUTH_PAGES.has(normalized)
	) {
		return DEFAULT_AUTH_REDIRECT_PATH;
	}

	return normalized;
}

export function buildAuthPagePath(
	authPath: "/login" | "/register",
	redirectTo: string,
) {
	const searchParams = new URLSearchParams({
		[AUTH_REDIRECT_QUERY_PARAM]: normalizeAuthRedirectPath(redirectTo),
	});

	return `${authPath}?${searchParams.toString()}`;
}
