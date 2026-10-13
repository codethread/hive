// Adapted from shadcn/ui Button, Badge and Card to Hive's theme tokens.
// https://ui.shadcn.com/docs/components — MIT; see ../SHADCN_LICENSE.
/* eslint-disable react/jsx-props-no-spreading -- Styled shadcn primitives preserve native element and Slot props. */
import type { ClassValue } from "clsx";
import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { cva } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva(
	[
		"inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium",
		"whitespace-nowrap transition-colors outline-none focus-visible:border-accent",
		"focus-visible:ring-[3px] focus-visible:ring-accent/30 disabled:pointer-events-none disabled:opacity-50",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	],
	{
		variants: {
			variant: {
				default: "bg-accent text-canvas hover:bg-accent/90",
				outline:
					"border border-line bg-panel text-ink shadow-xs hover:bg-raised hover:border-accent",
				secondary: "bg-raised text-ink hover:bg-raised/80",
				ghost: "text-muted hover:bg-raised hover:text-ink",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
				icon: "size-9",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);
const badgeVariants = cva(
	[
		"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border",
		"border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
		"focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/30",
		"[&>svg]:pointer-events-none [&>svg]:size-3",
	],
	{
		variants: {
			variant: {
				default: "bg-tint text-accent",
				secondary: "bg-raised text-muted",
				outline: "border-line text-ink",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

export function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
	const Component = asChild ? Slot : "button";
	return (
		<Component
			data-slot="button"
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

export function Badge({
	className,
	variant,
	...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export function Card({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"flex flex-col gap-6 rounded-xl border border-line bg-card py-6 text-ink shadow-sm",
				className,
			)}
			{...props}
		/>
	);
}

// --- shadcn class composition ---
function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
