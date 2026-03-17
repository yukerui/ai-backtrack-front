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

const VERIFICATION_BENEFITS = [
  {
    description: "验证成功后自动返回刚才的页面，不需要重新找入口。",
    icon: ArrowRight,
    title: "自动返回",
  },
  {
    description: "通常只在首次进入或 `cf_clearance` 失效时出现一次。",
    icon: TimerReset,
    title: "一次通过即可",
  },
  {
    description: "通过后聊天页不再展示验证组件，交互会恢复正常。",
    icon: ShieldCheck,
    title: "直接恢复会话",
  },
] as const;

function summarizeRedirectPath(path: string) {
  if (!path || path === "/") {
    return "主页";
  }

  if (path.length <= 36) {
    return path;
  }

  return `${path.slice(0, 33)}...`;
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
    <main className="relative min-h-dvh overflow-hidden bg-[#f6f1e8] px-4 py-6 text-foreground sm:px-6 lg:px-8 dark:bg-[#09090b]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="-left-24 absolute top-0 h-72 w-72 rounded-full bg-amber-300/30 blur-3xl dark:bg-amber-500/12" />
        <div className="absolute right-[-5rem] top-1/3 h-80 w-80 rounded-full bg-orange-200/35 blur-3xl dark:bg-orange-500/10" />
        <div className="absolute bottom-[-6rem] left-1/3 h-72 w-72 rounded-full bg-lime-100/50 blur-3xl dark:bg-emerald-500/8" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.045)_1px,transparent_1px)] bg-[size:34px_34px] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.8),transparent_42%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_30%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100dvh-3rem)] max-w-6xl items-center">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,460px)]">
          <section className="animate-in fade-in-0 slide-in-from-bottom-4 relative overflow-hidden rounded-[2rem] border border-black/10 bg-white/72 p-7 shadow-[0_40px_120px_-60px_rgba(15,23,42,0.5)] backdrop-blur duration-700 sm:p-9 dark:border-white/10 dark:bg-white/6">
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-black/15 to-transparent dark:via-white/15" />

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-black/70 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
                <Sparkles className="size-3.5" />
                Cloudflare Turnstile
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
                <CheckCheck className="size-3.5" />
                验证通过后立即恢复聊天
              </div>
            </div>

            <div className="mt-8 max-w-2xl space-y-5">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">安全校验页面</p>
                <h1 className="text-balance font-semibold text-4xl tracking-tight text-zinc-950 sm:text-5xl dark:text-white">
                  完成一次快速验证，
                  <br />
                  然后继续你刚才的会话。
                </h1>
                <p className="max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
                  这是一次轻量的人机验证，用来避免公共入口被滥用。成功后会自动跳回你原来的页面，后续聊天流程不再被这个组件打断。
                </p>
              </div>

              <div className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200">
                <span className="shrink-0 rounded-full bg-black px-2 py-0.5 font-medium text-[11px] uppercase tracking-[0.22em] text-white dark:bg-white dark:text-black">
                  返回到
                </span>
                <span className="truncate font-medium">{destinationLabel}</span>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {VERIFICATION_BENEFITS.map((item, index) => {
                const Icon = item.icon;

                return (
                  <div
                    className="animate-in fade-in-0 slide-in-from-bottom-4 rounded-[1.5rem] border border-black/10 bg-white/70 p-4 duration-700 dark:border-white/10 dark:bg-white/[0.03]"
                    key={item.title}
                    style={{ animationDelay: `${index * 80}ms` }}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-sm dark:bg-white dark:text-black">
                      <Icon className="size-4" />
                    </div>
                    <div className="mt-4 space-y-1.5">
                      <p className="font-medium text-sm text-zinc-950 dark:text-white">
                        {item.title}
                      </p>
                      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        {item.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 rounded-[1.75rem] border border-black/10 bg-gradient-to-r from-black to-zinc-800 p-5 text-white shadow-[0_30px_100px_-70px_rgba(15,23,42,0.8)] dark:border-white/10 dark:from-white/8 dark:to-white/3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/12">
                  <ShieldCheck className="size-5" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-sm">为什么会出现这个页面？</p>
                  <p className="text-sm leading-6 text-white/70">
                    当你首次进入、清空 Cookie，或 Cloudflare
                    的校验状态失效时，系统会要求重新确认一次。这是为了把真实用户和脚本流量分开。
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="animate-in fade-in-0 slide-in-from-bottom-4 relative rounded-[2rem] border border-black/10 bg-white/82 p-5 shadow-[0_40px_100px_-65px_rgba(15,23,42,0.45)] backdrop-blur duration-700 sm:p-6 dark:border-white/10 dark:bg-[#101114]/88">
            <div className="rounded-[1.6rem] border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.85),rgba(247,244,238,0.88))] p-6 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Step 1 / 1
                  </p>
                  <h2 className="mt-2 font-semibold text-2xl text-zinc-950 dark:text-white">
                    完成 Cloudflare 验证
                  </h2>
                </div>
                <div
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                    verificationState === "verified"
                      ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : verificationState === "error"
                        ? "border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        : "border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {verificationState === "verified"
                    ? "已通过"
                    : verificationState === "error"
                      ? "需要重试"
                      : "等待验证"}
                </div>
              </div>

              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                完成后会在 0.6
                秒内自动跳转。你不需要手动返回，也不需要重复刷新聊天页。
              </p>

              <div className="mt-6 rounded-[1.5rem] border border-black/10 bg-white/75 p-5 shadow-inner dark:border-white/10 dark:bg-black/20">
                {verificationState === "verified" ? (
                  <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
                      <CheckCheck className="size-8" />
                    </div>
                    <h3 className="mt-5 font-semibold text-xl text-zinc-950 dark:text-white">
                      验证通过
                    </h3>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                      安全校验已完成，正在把你送回刚才的页面。
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
                  <div className="space-y-4">
                    <div className="rounded-[1.25rem] border border-dashed border-black/10 bg-[#fbfaf8] px-4 py-5 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-sm text-zinc-950 dark:text-white">
                            人机校验
                          </p>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            勾选下方组件，完成一次快速确认。
                          </p>
                        </div>
                        <div className="hidden rounded-full border border-black/10 px-3 py-1 text-xs text-zinc-500 sm:block dark:border-white/10 dark:text-zinc-400">
                          安全网关
                        </div>
                      </div>

                      <div className="mx-auto w-fit max-w-full rounded-[1.1rem] border border-black/10 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#0d0e11]">
                        <TurnstileWidget
                          action="chat"
                          className="h-[65px] w-[300px] overflow-hidden rounded-[0.8rem]"
                          key={widgetKey}
                          onVerifiedChange={(verified) => {
                            setVerificationState(
                              verified ? "verified" : "error"
                            );
                          }}
                          siteKey={siteKey}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border border-black/10 bg-black/[0.025] px-4 py-3 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300">
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
                <div className="mt-5 rounded-[1.25rem] border border-rose-500/20 bg-rose-500/8 p-4 text-sm text-rose-700 dark:text-rose-300">
                  <p className="font-medium">验证还未完成</p>
                  <p className="mt-1 leading-6">
                    这通常是勾选未完成、脚本加载失败，或验证码状态过期。点击“重试验证”会重新渲染组件。
                  </p>
                </div>
              ) : (
                <div className="mt-5 flex items-start gap-3 rounded-[1.25rem] border border-black/10 bg-black/[0.025] p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-zinc-950 dark:text-white" />
                  <p className="leading-6">
                    验证过程由 Cloudflare
                    提供。页面本身不会要求你输入额外密码或短信验证码。
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
