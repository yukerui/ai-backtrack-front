"use client";

import {
  ArrowRight,
  CheckCheck,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "./turnstile-widget";

type VerificationState = "idle" | "error" | "verified";

const CHECKPOINT_ITEMS = [
  {
    description: "通过后会自动跳回你刚才停留的页面。",
    title: "无缝返回",
  },
  {
    description: "通常只在首次进入或校验失效时出现。",
    title: "只做一次",
  },
  {
    description: "完成后聊天页不再显示验证组件。",
    title: "恢复对话",
  },
] as const;

function summarizeRedirectPath(path: string) {
  if (!path || path === "/") {
    return "主页";
  }

  if (path.length <= 40) {
    return path;
  }

  return `${path.slice(0, 37)}...`;
}

function statePillClassName(state: VerificationState) {
  if (state === "verified") {
    return "border border-emerald-500/20 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  }

  if (state === "error") {
    return "border border-rose-500/20 bg-rose-500/12 text-rose-700 dark:text-rose-300";
  }

  return "border border-amber-500/20 bg-amber-500/12 text-amber-700 dark:text-amber-300";
}

function stateLabel(state: VerificationState) {
  if (state === "verified") {
    return "已通过";
  }

  if (state === "error") {
    return "需要重试";
  }

  return "等待验证";
}

export function TurnstileVerificationPage({
  redirectPath,
  siteKey,
}: {
  redirectPath: string;
  siteKey: string;
}) {
  const [verificationState, setVerificationState] =
    useState<VerificationState>("idle");
  const [widgetKey, setWidgetKey] = useState(0);
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

  const resetWidget = () => {
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
    }
    setVerificationState("idle");
    setWidgetKey((current) => current + 1);
  };

  const destinationLabel = summarizeRedirectPath(redirectPath);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f4efe6] px-4 py-4 text-foreground sm:px-6 sm:py-6 dark:bg-[#0a0b0d]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(17,24,39,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(17,24,39,0.04)_1px,transparent_1px)] bg-[size:30px_30px] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)]" />
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-amber-200/55 blur-3xl dark:bg-amber-500/10" />
        <div className="absolute right-[-5rem] top-16 h-[28rem] w-[28rem] rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-500/10" />
        <div className="absolute bottom-[-7rem] left-1/3 h-96 w-96 rounded-full bg-emerald-100/65 blur-3xl dark:bg-emerald-500/8" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100dvh-2rem)] max-w-5xl items-center">
        <div className="w-full overflow-hidden rounded-[2.25rem] border border-black/10 bg-white/82 shadow-[0_40px_120px_-55px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-[#111318]/84">
          <div className="grid lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="relative overflow-hidden bg-[#111318] px-6 py-7 text-white sm:px-8 sm:py-9">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.22),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.14),transparent_32%)]" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/10" />

              <div className="relative flex h-full flex-col">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/72">
                  <Sparkles className="size-3.5" />
                  Secure Passage
                </div>

                <div className="mt-7 space-y-4">
                  <p className="text-sm text-white/55">
                    Cloudflare Turnstile 校验
                  </p>
                  <h1 className="text-balance font-semibold text-4xl tracking-tight text-white">
                    通过一次校验，
                    <br />
                    然后继续当前会话。
                  </h1>
                  <p className="text-base leading-7 text-white/68">
                    这是一个简短的人机验证，用来过滤异常流量。你不需要重新打开聊天页，验证成功后会自动送回刚才的位置。
                  </p>
                </div>

                <div className="mt-8 space-y-3">
                  {CHECKPOINT_ITEMS.map((item, index) => (
                    <div
                      className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] px-4 py-3"
                      key={item.title}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/8 text-sm font-medium text-white/80">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium text-sm text-white">
                            {item.title}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-white/60">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/52">
                    <ArrowRight className="size-3.5" />
                    返回目的地
                  </div>
                  <p className="mt-3 break-all font-medium text-sm text-white/88">
                    {destinationLabel}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/56">
                    完成验证后会自动跳转，不需要手动刷新页面。
                  </p>
                </div>
              </div>
            </aside>

            <section className="relative bg-[linear-gradient(180deg,rgba(255,255,255,0.68),rgba(249,245,238,0.92))] px-4 py-5 sm:px-6 sm:py-6 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]">
              <div className="rounded-[1.9rem] border border-black/10 bg-white/74 p-5 shadow-[0_25px_80px_-60px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-black/18 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-black/55 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
                      <ShieldCheck className="size-3.5" />
                      Cloudflare Verification
                    </div>
                    <div>
                      <h2 className="font-semibold text-3xl tracking-tight text-zinc-950 dark:text-white">
                        安全校验
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        整个过程通常只需要几秒。完成后会自动返回，不会要求你输入额外密码、短信验证码或其他敏感信息。
                      </p>
                    </div>
                  </div>

                  <div
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statePillClassName(verificationState)}`}
                  >
                    {verificationState === "verified" ? (
                      <CheckCheck className="size-3.5" />
                    ) : (
                      <TimerReset className="size-3.5" />
                    )}
                    {stateLabel(verificationState)}
                  </div>
                </div>

                <div className="mt-7 overflow-hidden rounded-[1.75rem] border border-black/10 bg-[#f7f1e7] p-4 dark:border-white/10 dark:bg-[#0e1014] sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm text-zinc-950 dark:text-white">
                        Challenge Zone
                      </p>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Cloudflare 原生校验控件会直接显示在下方。
                      </p>
                    </div>
                    <div className="rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                      自动返回约 0.6 秒
                    </div>
                  </div>

                  {verificationState === "verified" ? (
                    <div className="mt-6 flex min-h-[220px] flex-col items-center justify-center rounded-[1.5rem] border border-emerald-500/18 bg-white/70 px-4 py-8 text-center dark:bg-black/15">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
                        <CheckCheck className="size-8" />
                      </div>
                      <p className="mt-5 font-semibold text-xl text-zinc-950 dark:text-white">
                        验证通过
                      </p>
                      <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        安全校验已完成，正在跳转回你刚才的页面。
                      </p>
                      <Button
                        className="mt-5 rounded-full px-5"
                        onClick={() => window.location.replace(redirectPath)}
                        type="button"
                      >
                        立即返回
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-6 space-y-4">
                      <div className="rounded-[1.45rem] border border-black/10 bg-white/72 p-3 shadow-sm dark:border-white/10 dark:bg-black/18">
                        <div className="overflow-x-auto pb-1">
                          <div className="mx-auto max-w-[420px] min-w-[300px] rounded-[1.25rem] border border-black/10 bg-white p-1.5 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-[#12141a]">
                            <TurnstileWidget
                              action="chat"
                              className="w-full min-w-[300px] overflow-hidden rounded-[0.95rem]"
                              key={widgetKey}
                              onVerifiedChange={(verified) => {
                                setVerificationState(
                                  verified ? "verified" : "error"
                                );
                              }}
                              siteKey={siteKey}
                              size="flexible"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.3rem] border border-black/10 bg-black/[0.025] px-4 py-3 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300">
                        <span>仅首次进入或验证失效时需要完成一次。</span>
                        {verificationState === "error" ? (
                          <Button
                            className="rounded-full"
                            onClick={resetWidget}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <RefreshCcw className="size-4" />
                            重试验证
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                {verificationState === "error" ? (
                  <div className="mt-5 rounded-[1.35rem] border border-rose-500/20 bg-rose-500/8 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    <p className="font-medium">验证还未完成</p>
                    <p className="mt-1 leading-6">
                      这通常表示控件校验未完成、网络重试失败，或 token
                      已过期。点击“重试验证”会重新生成挑战。
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 flex items-start gap-3 rounded-[1.35rem] border border-black/10 bg-black/[0.025] px-4 py-3 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-zinc-950 dark:text-white" />
                    <p className="leading-6">
                      验证过程由 Cloudflare
                      提供。通过后聊天页不再显示这块校验区域。
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
