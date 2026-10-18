// Adapted from shadcn/ui Resizable to Hive's theme tokens.
// https://ui.shadcn.com/docs/components/radix/resizable — MIT; see ../SHADCN_LICENSE.
/* eslint-disable react/jsx-props-no-spreading -- Styled shadcn wrappers preserve the panel primitives' props. */
import { Group, Panel, Separator } from "react-resizable-panels";
import type { ClassValue } from "clsx";
import type { ComponentProps } from "react";
import { GripVertical } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
	return (
		<Group
			data-slot="resizable-panel-group"
			className={cn("h-full w-full", className)}
			{...props}
		/>
	);
}

export function ResizablePanel(props: ComponentProps<typeof Panel>) {
	return <Panel data-slot="resizable-panel" {...props} />;
}

export function ResizableHandle({
	className,
	withHandle = false,
	...props
}: ComponentProps<typeof Separator> & { withHandle?: boolean }) {
	return (
		<Separator
			data-slot="resizable-handle"
			className={cn(
				"relative z-10 flex w-px shrink-0 items-center justify-center bg-line " +
					"hover:bg-accent focus-visible:bg-accent focus-visible:outline-none " +
					"data-[separator=active]:bg-accent aria-[orientation=horizontal]:h-px " +
					"aria-[orientation=horizontal]:w-full [&[aria-orientation=horizontal]>div]:rotate-90",
				className,
			)}
			{...props}
		>
			{withHandle && (
				<div className="flex h-6 w-3 items-center justify-center rounded-sm border border-line bg-panel text-muted">
					<GripVertical className="size-3" aria-hidden="true" />
				</div>
			)}
		</Separator>
	);
}

function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
