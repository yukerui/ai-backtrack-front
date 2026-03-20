"use client";

import { CheckIcon } from "lucide-react";
import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Root
		ref={ref}
		className={cn(
			"peer h-4 w-4 shrink-0 rounded-[4px] border border-input bg-background outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white",
			className,
		)}
		{...props}
	>
		<CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
			<CheckIcon className="h-3.5 w-3.5" />
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
