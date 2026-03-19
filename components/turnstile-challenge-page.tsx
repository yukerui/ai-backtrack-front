"use client";

import Image from "next/image";
import { useEffect } from "react";
import {
	hasTurnstileVerifiedSession,
	setTurnstileVerifiedSession,
} from "@/lib/turnstile";
import { TurnstileWidget } from "./turnstile-widget";

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
				<Image
					alt="Free Backtrack"
					height={48}
					priority
					src="/site-icon.png"
					width={48}
				/>
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
