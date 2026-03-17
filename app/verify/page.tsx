import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TurnstileVerificationPage } from "@/components/turnstile-verification-page";
import {
  getTurnstileSiteKey,
  normalizeTurnstileRedirectPath,
} from "@/lib/turnstile";

type VerifyPageProps = {
  searchParams: Promise<{
    redirect?: string | string[] | undefined;
  }>;
};

export default function Page({ searchParams }: VerifyPageProps) {
  return (
    <Suspense fallback={<div className="flex h-dvh" />}>
      <VerifyPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function VerifyPageContent({ searchParams }: VerifyPageProps) {
  await connection();

  const [{ redirect: redirectParam }, cookieStore] = await Promise.all([
    searchParams,
    cookies(),
  ]);
  const redirectPath = normalizeTurnstileRedirectPath(
    Array.isArray(redirectParam) ? redirectParam[0] : redirectParam
  );
  const siteKey = getTurnstileSiteKey();

  if (!siteKey || cookieStore.get("cf_clearance")?.value) {
    redirect(redirectPath);
  }

  return (
    <TurnstileVerificationPage redirectPath={redirectPath} siteKey={siteKey} />
  );
}
