import {
	AUTH_REDIRECT_QUERY_PARAM,
	normalizeAuthRedirectPath,
} from "@/lib/auth-redirect";
import { RegisterPageClient } from "./register-page-client";

type RegisterPageProps = {
	searchParams: Promise<{
		[AUTH_REDIRECT_QUERY_PARAM]?: string | string[] | undefined;
	}>;
};

export default async function Page({ searchParams }: RegisterPageProps) {
	const search = await searchParams;
	const redirectTo = search[AUTH_REDIRECT_QUERY_PARAM];

	return (
		<RegisterPageClient
			redirectTo={normalizeAuthRedirectPath(
				Array.isArray(redirectTo) ? redirectTo[0] : redirectTo,
			)}
		/>
	);
}
