"use client";

import { useEffect, useRef, useState } from "react";
import { TurnstileWidget } from "./turnstile-widget";

type VerificationState = "idle" | "error" | "verified";

export function TurnstileVerificationPage({
  redirectPath,
  siteKey,
}: {
  redirectPath: string;
  siteKey: string;
}) {
  const [verificationState, setVerificationState] =
    useState<VerificationState>("idle");
  const redirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (verificationState !== "verified") {
      return;
    }

    redirectTimerRef.current = window.setTimeout(() => {
      window.location.replace(redirectPath);
    }, 600);

    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, [redirectPath, verificationState]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-3 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Cloudflare Verification
          </p>
          <h1 className="font-semibold text-2xl text-foreground">
            先完成一次页面验证
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            验证成功后会自动返回主页，后续聊天页里不再显示验证组件。
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-dashed border-border bg-background/70 p-5">
          {verificationState === "verified" ? (
            <div className="space-y-2 text-center">
              <div className="text-sm font-medium text-foreground">
                验证完成
              </div>
              <div className="text-sm text-muted-foreground">
                正在返回你刚才的页面……
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <TurnstileWidget
                action="chat"
                onVerifiedChange={(verified) => {
                  setVerificationState(verified ? "verified" : "error");
                }}
                siteKey={siteKey}
              />
              <p className="text-center text-xs text-muted-foreground">
                仅首次进入或验证失效时需要完成一次。
              </p>
            </div>
          )}
        </div>

        {verificationState === "error" ? (
          <p className="mt-4 text-center text-sm text-destructive">
            验证还未完成，请重试一次。
          </p>
        ) : null}
      </div>
    </main>
  );
}
