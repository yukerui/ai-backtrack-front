import {
	AUTH_REDIRECT_QUERY_PARAM,
	normalizeAuthRedirectPath,
} from "@/lib/auth-redirect";
import { LoginPageClient } from "./login-page-client";

type LoginPageProps = {
	searchParams: Promise<{
		[AUTH_REDIRECT_QUERY_PARAM]?: string | string[] | undefined;
	}>;
};

export default async function Page({ searchParams }: LoginPageProps) {
	const search = await searchParams;
	const redirectTo = search[AUTH_REDIRECT_QUERY_PARAM];

	return (
		<LoginPageClient
			redirectTo={normalizeAuthRedirectPath(
				Array.isArray(redirectTo) ? redirectTo[0] : redirectTo,
			)}
		/>
	);
}
