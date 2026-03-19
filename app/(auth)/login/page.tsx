import { connection } from "next/server";
import { Suspense } from "react";
import {
	AUTH_REDIRECT_QUERY_PARAM,
	normalizeAuthRedirectPath,
} from "@/lib/auth-redirect";
import { LoginPageClient } from "./login-page-client";

type LoginPageContentProps = {
	searchParams: Promise<{
		[AUTH_REDIRECT_QUERY_PARAM]?: string | string[] | undefined;
	}>;
};

export default function Page({ searchParams }: LoginPageContentProps) {
	return (
		<Suspense fallback={<div className="flex h-dvh bg-background" />}>
			<LoginPageContent searchParams={searchParams} />
		</Suspense>
	);
}

async function LoginPageContent({ searchParams }: LoginPageContentProps) {
	await connection();
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
