"use client";

import { useEffect } from "react";
import {
  hasTurnstileVerifiedSession,
  setTurnstileVerifiedSession,
} from "@/lib/turnstile";
import { TurnstileWidget } from "./turnstile-widget";

function CloudflareIcon() {
  return (
    <svg aria-label="Cloudflare" fill="none" viewBox="0 0 96 42" width="132">
      <path
        d="M63.35 34.72H19.08a2.48 2.48 0 0 1-.52-4.9l42.55-8.8a.98.98 0 0 1 1.17 1.21l-1.47 4.66h16.94a2.48 2.48 0 0 1 .53 4.9l-14.44 2.99a.95.95 0 0 1-.49-.06"
        fill="#F38020"
      />
      <path
        d="M69.4 16.54c-.8 0-1.6.13-2.33.37a11.2 11.2 0 0 0-21.46 1.38 6.95 6.95 0 0 0-8.35 5.3 8.9 8.9 0 0 0-12.15 8.3c0 .95.16 1.86.44 2.72a.97.97 0 0 0 .92.67h52.28c6.95 0 12.58-5.54 12.58-12.37 0-3.54-1.51-6.74-3.93-9a12.71 12.71 0 0 0-8-2.84"
        fill="#F38020"
      />
      <path
        d="M35.54 35.28h42.1c.44 0 .86-.29.97-.73l1.18-4.72a1 1 0 0 0-.97-1.26H36.95a.98.98 0 0 0-.95.77l-1.43 4.72a.99.99 0 0 0 .97 1.22"
        fill="#FAAE40"
      />
    </svg>
  );
}

export function TurnstileChallengePage({
  redirectPath,
  siteKey,
}: {
  redirectPath: string;
  siteKey: string;
}) {
  useEffect(() => {
    if (hasTurnstileVerifiedSession()) {
      window.location.replace(redirectPath);
    }
  }, [redirectPath]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-6 py-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <CloudflareIcon />
        <div className="w-full overflow-hidden">
          <TurnstileWidget
            action="chat"
            className="flex justify-center"
            onVerifiedChange={(verified) => {
              if (!verified) {
                return;
              }

              setTurnstileVerifiedSession();
              window.location.replace(redirectPath);
            }}
            siteKey={siteKey}
            size="flexible"
          />
        </div>
      </div>
    </main>
  );
}
