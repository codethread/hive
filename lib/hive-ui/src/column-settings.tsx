// Dialog composition follows shadcn/ui's Radix variant, adapted to Hive theme tokens.
// https://ui.shadcn.com/docs/components/radix/dialog — MIT; see ../SHADCN_LICENSE.
import {
	Root as Dialog,
	Close as DialogClose,
	Content as DialogContent,
	Description as DialogDescription,
	Overlay as DialogOverlay,
	Portal as DialogPortal,
	Title as DialogTitle,
	Trigger as DialogTrigger,
} from "@radix-ui/react-dialog";
import { boardStatuses, columnOrder, createColumnOrders, swapColumns } from "./column-order.ts";
import { Columns3 } from "lucide-react";
import { preferences } from "./data.ts";
import { statusName } from "./filter-controls.tsx";
import { useStore } from "zustand";

const DIRECTIONS = [
	{ name: "left", step: -1, icon: "←" },
	{ name: "right", step: 1, icon: "→" },
];
export const columnOrders = createColumnOrders(localStorage);
export const DEFAULT_COLUMN_ORDER: string[] = [];
interface ColumnSettingsProps {
	/** Colony whose browser preference is being edited. */
	colony: string;
	/** Native statuses present on the current board page. */
	present: string[];
	/** Current status filter, used only to determine visible columns. */
	selected: string[];
	/** CSS classes for the trigger button. */
	className?: string;
}

export function ColumnSettings({
	colony,
	present,
	selected,
	className = "button",
}: ColumnSettingsProps) {
	const theme = useStore(preferences, (state) => state.theme);
	const preferred = useStore(
		columnOrders.store,
		(state) => state.byColony[colony] ?? DEFAULT_COLUMN_ORDER,
	);
	const error = useStore(columnOrders.store, (state) => state.error);
	const statuses = boardStatuses(present, selected, preferred);
	const order = columnOrder(statuses, preferred);
	return (
		<Dialog>
			<DialogTrigger asChild>
				<button type="button" className={className} aria-label="Columns" title="Columns">
					<Columns3 size={16} aria-hidden="true" />
					<span className="sidebar-action-label">Columns</span>
				</button>
			</DialogTrigger>
			<DialogPortal>
				<DialogOverlay className="fixed inset-0 z-50 bg-black/50" />
				<DialogContent
					data-theme={theme}
					className={
						"fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] " +
						"max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto " +
						"rounded-lg border border-line bg-panel p-5 text-sm text-ink " +
						"shadow-xl"
					}
				>
					<header className="flex items-center justify-between gap-4">
						<DialogTitle className="font-semibold">Column settings</DialogTitle>
						<DialogClose asChild>
							<button type="button" className="button" aria-label="Close column settings">
								Close
							</button>
						</DialogClose>
					</header>
					<DialogDescription className="mt-2 text-xs text-muted">
						Move visible columns left or right. Saved for this colony.
					</DialogDescription>
					<ol className="my-2 space-y-1" aria-label="Column order">
						{statuses.map((status, index) => (
							<li key={status} className="flex items-center justify-between gap-4">
								<span>{statusName(status)}</span>
								<div className="flex gap-1">
									{DIRECTIONS.map(({ name, step, icon }) => (
										<button
											key={step}
											type="button"
											className="button"
											aria-label={`Move ${statusName(status)} ${name}`}
											disabled={index + step < 0 || index + step >= statuses.length}
											onClick={() => {
												columnOrders.save(
													colony,
													swapColumns(order, status, statuses[index + step]!),
												);
											}}
										>
											{icon}
										</button>
									))}
								</div>
							</li>
						))}
					</ol>
					<button
						type="button"
						className="button"
						onClick={() => {
							columnOrders.save(colony, []);
						}}
					>
						Reset to default
					</button>
					{error && (
						<p role="alert" className="mt-2 text-alert">
							{error}
						</p>
					)}
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}
