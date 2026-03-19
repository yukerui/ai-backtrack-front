import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TurnstileChallengePage } from "@/components/turnstile-challenge-page";
import {
  getTurnstileSiteKey,
  normalizeTurnstileRedirectPath,
  TURNSTILE_RETURN_TO_PARAM,
} from "@/lib/turnstile";

type ChallengePageProps = {
  searchParams: Promise<{
    [TURNSTILE_RETURN_TO_PARAM]?: string | string[] | undefined;
  }>;
};

export const metadata = {
  title: "Just a moment...",
};

export default function Page({ searchParams }: ChallengePageProps) {
  return (
    <Suspense fallback={<div className="flex h-dvh bg-white" />}>
      <ChallengePageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ChallengePageContent({ searchParams }: ChallengePageProps) {
  await connection();

  const search = await searchParams;
  const returnTo = search[TURNSTILE_RETURN_TO_PARAM];
  const redirectPath = normalizeTurnstileRedirectPath(
    Array.isArray(returnTo) ? returnTo[0] : returnTo
  );
  const siteKey = getTurnstileSiteKey();

  if (!siteKey) {
    redirect(redirectPath);
  }

  return (
    <TurnstileChallengePage redirectPath={redirectPath} siteKey={siteKey} />
  );
}
