// Adapted from shadcn/ui Tabs (default variant) to Hive's theme tokens.
// https://ui.shadcn.com/docs/components/radix/tabs — MIT; see ../SHADCN_LICENSE.
/* eslint-disable react/jsx-props-no-spreading -- Styled shadcn wrappers preserve the Radix component props. */
import {
	Content as TabsPrimitiveContent,
	List as TabsPrimitiveList,
	Root as TabsPrimitiveRoot,
	Trigger as TabsPrimitiveTrigger,
} from "@radix-ui/react-tabs";
import type { ClassValue } from "clsx";
import type { ComponentProps } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitiveRoot>) {
	return (
		<TabsPrimitiveRoot
			data-slot="tabs"
			className={cn("flex flex-col gap-2", className)}
			{...props}
		/>
	);
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitiveList>) {
	return (
		<TabsPrimitiveList
			data-slot="tabs-list"
			className={cn(
				"inline-flex h-9 w-fit items-center justify-center rounded-lg bg-raised p-[3px] text-muted",
				className,
			)}
			{...props}
		/>
	);
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitiveTrigger>) {
	return (
		<TabsPrimitiveTrigger
			data-slot="tabs-trigger"
			className={cn(
				"inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors hover:text-ink focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-line data-[state=active]:bg-panel data-[state=active]:text-ink data-[state=active]:shadow-sm",
				className,
			)}
			{...props}
		/>
	);
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitiveContent>) {
	return (
		<TabsPrimitiveContent
			data-slot="tabs-content"
			className={cn("flex-1 outline-none", className)}
			{...props}
		/>
	);
}

// --- shadcn class composition ---
function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
