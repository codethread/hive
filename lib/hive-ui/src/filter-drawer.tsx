import {
	ActiveFilters,
	LabelFilters,
	PriorityFilters,
	StatusFilters,
	editFilters,
} from "./filter-controls.tsx";
import type { Board, Navigation } from "../contracts.ts";
import type { ReactNode, SubmitEvent } from "react";
import {
	deleteView,
	filterSet,
	sameFilters,
	saveView,
	savedViews,
	selectSavedView,
} from "./saved-views.ts";
import { useId, useRef } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { SavedView } from "./saved-views.ts";
import { preferences } from "./data.ts";
import { useStore } from "zustand";
import { z } from "zod";

export function FilterWorkspace({ board, children }: { board: Board | null; children: ReactNode }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const { colonyId, saved, views, selected, modified } = useViewPresets(search);
	const collapsed = useStore(preferences, (state) => state.sidebarCollapsed);
	const dialog = useRef<HTMLDialogElement>(null);
	const id = useId();
	const filters = (
		<>
			<SavedViewList
				views={views}
				selected={modified ? undefined : selected}
				apply={(view) => {
					selectSavedView(colonyId, view.id);
					void navigate({ search: (current) => editFilters(current, view.filters) });
				}}
			/>
			<StatusFilters />
			<PriorityFilters />
			<LabelFilters labels={board?.labels ?? []} />
			<details className="save-view-details">
				<summary>Save view</summary>
				<SavedViewForm colonyId={colonyId} search={search} selected={selected} />
			</details>
		</>
	);
	return (
		<div className="filter-workspace">
			<div className="mobile-filter-toolbar">
				<button
					className="button"
					type="button"
					aria-haspopup="dialog"
					onClick={() => {
						dialog.current!.showModal();
					}}
				>
					Filters & views
				</button>
			</div>
			<div className="filter-workspace-body">
				<aside
					className={`view-sidebar ${collapsed ? "is-collapsed" : ""}`}
					aria-label="Filters and views"
				>
					<div className="sidebar-heading">
						{!collapsed && <h2 className="text-sm font-medium">Filters</h2>}
						<button
							type="button"
							className="sidebar-collapse"
							aria-label={collapsed ? "Expand filters" : "Collapse filters"}
							title={collapsed ? "Expand filters" : "Collapse filters"}
							aria-expanded={!collapsed}
							aria-controls={`${id}-sidebar`}
							onClick={() => {
								preferences.setState({ sidebarCollapsed: !collapsed });
							}}
						>
							<svg
								aria-hidden="true"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
							>
								<rect x="3" y="4" width="18" height="16" rx="2" />
								<path d="M9 4v16" />
								<path d={collapsed ? "m13 9 3 3-3 3" : "m17 9-3 3 3 3"} />
							</svg>
						</button>
					</div>
					<div id={`${id}-sidebar`} className="sidebar-content" hidden={collapsed}>
						{filters}
					</div>
				</aside>
				<div className="board-pane">
					<section aria-label="Board filters" className="filter-summary">
						{(modified || saved.notice.kind === "error") && (
							<div className="view-notice">
								{modified && (
									<span className="text-xs text-alert">{selected!.name} · modified</span>
								)}
								{saved.notice.kind === "error" && (
									<p role="alert" className="text-xs text-alert">
										{saved.notice.message}
									</p>
								)}
							</div>
						)}
						<ActiveFilters />
					</section>
					{children}
				</div>
			</div>
			<dialog ref={dialog} className="filter-drawer" aria-labelledby={`${id}-title`}>
				<header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
					<h2 id={`${id}-title`} className="font-medium">
						Filters & views
					</h2>
					<button
						className="button"
						type="button"
						aria-label="Close filters"
						onClick={() => {
							dialog.current!.close();
						}}
					>
						Done <span className="ml-1 text-muted">Esc</span>
					</button>
				</header>
				<div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5">
					{filters}
					<ActiveFilters />
				</div>
			</dialog>
		</div>
	);
}

// --- Explicit browser-local filter persistence ---
function SavedViewList({
	views,
	selected,
	apply,
}: {
	views: SavedView[];
	selected: SavedView | undefined;
	apply: (view: SavedView) => void;
}) {
	return (
		<section aria-label="Saved views" className="space-y-2">
			<h3 className="filter-heading">Views</h3>
			{views.length === 0 ? (
				<p className="text-xs leading-relaxed text-muted">No saved views.</p>
			) : (
				<div className="saved-view-list">
					{views.map((view) => (
						<button
							key={view.id}
							type="button"
							aria-pressed={selected?.id === view.id}
							onClick={() => {
								apply(view);
							}}
						>
							<span aria-hidden="true">▤</span>
							<span>{view.name}</span>
						</button>
					))}
				</div>
			)}
		</section>
	);
}
function SavedViewForm({
	colonyId,
	search,
	selected,
}: {
	colonyId: string;
	search: Navigation;
	selected: SavedView | undefined;
}) {
	const id = useId();
	const notice = useStore(savedViews, (state) => state.notice);
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const data = new FormData(event.currentTarget, event.nativeEvent.submitter);
		const name = z.string().parse(data.get("name"));
		saveView(colonyId, {
			filters: filterSet(search),
			name,
			replaceId: data.get("action") === "update" ? selected!.id : null,
		});
	};
	return (
		<section aria-label="Manage saved views" className="space-y-3 pt-3">
			<form
				key={`${selected?.id ?? "new"}:${selected?.name ?? ""}`}
				onSubmit={submit}
				className="space-y-3"
			>
				<label className="block text-xs text-muted" htmlFor={id}>
					View name
				</label>
				<input
					id={id}
					name="name"
					className="control w-full"
					defaultValue={selected?.name ?? ""}
					placeholder="View name"
					required
					maxLength={80}
				/>
				<div className="flex flex-wrap gap-2">
					<button
						className="button"
						type="submit"
						name="action"
						value="new"
						aria-label="Save new view"
					>
						Save new
					</button>
					{selected && (
						<>
							<button
								className="button"
								type="submit"
								name="action"
								value="update"
								aria-label="Update saved view"
							>
								Update
							</button>
							<button
								className="button"
								type="button"
								aria-label="Delete saved view"
								onClick={() => {
									deleteView(colonyId, selected.id);
								}}
							>
								Delete
							</button>
						</>
					)}
				</div>
			</form>
			{notice.kind !== "none" && (
				<p
					role={notice.kind === "error" ? "alert" : "status"}
					className="break-words text-xs leading-relaxed text-muted"
				>
					{notice.message}
				</p>
			)}
		</section>
	);
}

function useViewPresets(search: Navigation) {
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	const saved = useStore(savedViews);
	const views = saved.byColony[colonyId] ?? [];
	const selected = views.find((entry) => entry.id === saved.active[colonyId]);
	const modified = selected !== undefined && !sameFilters(selected.filters, filterSet(search));
	return { colonyId, modified, saved, selected, views };
}
