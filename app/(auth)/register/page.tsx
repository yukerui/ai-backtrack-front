import { connection } from "next/server";
import { Suspense } from "react";
import {
	AUTH_REDIRECT_QUERY_PARAM,
	normalizeAuthRedirectPath,
} from "@/lib/auth-redirect";
import { RegisterPageClient } from "./register-page-client";

type RegisterPageContentProps = {
	searchParams: Promise<{
		[AUTH_REDIRECT_QUERY_PARAM]?: string | string[] | undefined;
	}>;
};

export default function Page({ searchParams }: RegisterPageContentProps) {
	return (
		<Suspense fallback={<div className="flex h-dvh bg-background" />}>
			<RegisterPageContent searchParams={searchParams} />
		</Suspense>
	);
}

async function RegisterPageContent({ searchParams }: RegisterPageContentProps) {
	await connection();
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
