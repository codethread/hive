import {
	ActiveFilters,
	LabelFilters,
	SearchFilters,
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
import { filterLayoutSchema } from "../contracts.ts";
import { useStore } from "zustand";
import { z } from "zod";

const LAYOUTS = {
	header: {
		button: "Save / manage view",
		name: "Header",
		number: "01",
		title: "Everything within reach",
		description: "Search, status and label rules together above the board.",
	},
	drawer: {
		button: "Filters & views",
		name: "Left drawer",
		number: "02",
		title: "Room for the work",
		description: "A quiet header. Open Filters to shape and save your view.",
	},
	hybrid: {
		button: "Labels & saved views",
		name: "Quick + drawer",
		number: "03",
		title: "Fast filters, deeper rules",
		description: "Search and status up front. Labels and saved views in the drawer.",
	},
	sidebar: {
		button: "Views & status",
		name: "Views + header",
		number: "04",
		title: "A workspace for your views",
		description: "Saved views and status on the left. Search and label rules across the top.",
	},
};

export function FilterWorkspace({ board, children }: { board: Board | null; children: ReactNode }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const { colonyId, saved, views, selected, modified } = useViewPresets(search);
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const layout = LAYOUTS[search.layout];
	const apply = (view: SavedView) => {
		selectSavedView(colonyId, view.id);
		void navigate({
			search: (current) => editFilters(current, view.filters),
		});
	};
	const savedForm = (
		<SavedViewForm colonyId={colonyId} search={search} selected={selected} modified={modified} />
	);
	const viewList = (
		<SavedViewList views={views} selected={modified ? undefined : selected} apply={apply} />
	);
	return (
		<div className={`filter-workspace layout-${search.layout}`}>
			<section className="design-switcher" aria-label="Compare filter designs">
				<div className="design-caption">
					<span className="eyebrow">Filter study</span>
					<span>Same work, four ways to focus</span>
				</div>
				<div className="design-options">
					{filterLayoutSchema.options.map((value) => (
						<button
							type="button"
							key={value}
							aria-pressed={search.layout === value}
							onClick={() => {
								void navigate({ search: (current) => ({ ...current, layout: value }) });
							}}
						>
							<span>{LAYOUTS[value].number}</span>
							{LAYOUTS[value].name}
						</button>
					))}
				</div>
			</section>
			<div className="filter-workspace-body">
				{search.layout === "sidebar" && (
					<aside className="view-sidebar" aria-label="Views and status">
						<div>
							<p className="eyebrow">Your workspace</p>
							<h2 className="mt-2 text-lg font-medium">Views</h2>
							<p className="mt-1 text-xs text-muted">Saved for this colony</p>
						</div>
						{viewList}
						<StatusFilters />
						{savedForm}
					</aside>
				)}
				<div className="min-w-0 flex-1">
					<section aria-label="Board views" className="filter-header">
						<div className="filter-title-row">
							<div>
								<p className="eyebrow">
									{layout.number} / {layout.name}
								</p>
								<h2>{layout.title}</h2>
								<p>{layout.description}</p>
							</div>
						</div>
						<div className="view-toolbar">
							{search.layout !== "sidebar" && (
								<label className="flex min-w-0 items-center gap-2 text-xs text-muted">
									View
									<select
										className="control min-w-0 max-w-56"
										value={modified ? "" : (selected?.id ?? "")}
										onChange={(event) => {
											apply(views.find((entry) => entry.id === event.target.value)!);
										}}
									>
										<option value="" disabled>
											{views.length === 0 ? "No saved views yet" : "Custom filters"}
										</option>
										{views.map((view) => (
											<option key={view.id} value={view.id}>
												{view.name}
											</option>
										))}
									</select>
								</label>
							)}
							{search.layout === "header" ? (
								<details className="header-save">
									<summary className="button">Save / manage view</summary>
									{savedForm}
								</details>
							) : (
								<button
									className={`button ${search.layout === "sidebar" ? "sidebar-toggle" : ""}`}
									type="button"
									aria-haspopup="dialog"
									onClick={() => {
										dialog.current!.showModal();
									}}
								>
									{layout.button}
									<span aria-hidden="true" className="ml-2">
										↗
									</span>
								</button>
							)}
							{modified && <span className="text-xs text-alert">{selected!.name} · modified</span>}
							{saved.notice.kind === "error" && (
								<p role="alert" className="text-xs text-alert">
									{saved.notice.message}
								</p>
							)}
						</div>
						{search.layout !== "drawer" && (
							<div className="filter-header-controls">
								<SearchFilters />
								{search.layout !== "sidebar" && <StatusFilters />}
							</div>
						)}
						{(search.layout === "header" || search.layout === "sidebar") && (
							<LabelFilters labels={board?.labels ?? []} />
						)}
						<ActiveFilters />
						{search.view !== "beads" && (
							<p className="pb-3 text-xs text-muted">
								A bee matches when any linked task meets all bead filters. Loaded ancestry is shown
								separately as context.
							</p>
						)}
					</section>
					{children}
				</div>
			</div>
			{search.layout !== "header" && (
				<dialog ref={dialog} className="filter-drawer" aria-labelledby={titleId}>
					<header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
						<div>
							<p className="eyebrow">
								{layout.number} / {layout.name}
							</p>
							<h2 id={titleId} className="mt-1 font-medium">
								{search.layout === "hybrid" ? "Labels & saved views" : "Filters & views"}
							</h2>
						</div>
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
					<div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain p-5">
						{search.layout === "drawer" && <SearchFilters />}
						{search.layout !== "hybrid" && <StatusFilters />}
						{search.layout !== "sidebar" && <LabelFilters labels={board?.labels ?? []} />}
						<ActiveFilters />
						{viewList}
						{savedForm}
					</div>
				</dialog>
			)}
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
			<h3 className="filter-heading">Saved views</h3>
			{views.length === 0 ? (
				<p className="text-xs leading-relaxed text-muted">
					Create a view for work you return to. Try Blocked + AND hitl.
				</p>
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
	modified,
}: {
	colonyId: string;
	search: Navigation;
	selected: SavedView | undefined;
	modified: boolean;
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
		<section aria-label="Manage saved views" className="space-y-3 border-t border-line pt-5">
			<h3 className="text-sm font-medium">Save this view</h3>
			<p className="text-xs leading-relaxed text-muted">
				Keep named bead filters for this colony in this browser. Use the same view in Beads or Bees;
				applying it starts at the first page.
			</p>
			{selected && (
				<p className="text-xs text-muted">
					Editing “{selected.name}”{modified ? " · filters modified" : ""}. Change its name below to
					rename it.
				</p>
			)}
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
					placeholder="e.g. Blocked · needs me"
					required
					maxLength={80}
				/>
				<div className="flex flex-wrap gap-2">
					<button className="button" type="submit" name="action" value="new">
						Save new view
					</button>
					{selected && (
						<>
							<button className="button" type="submit" name="action" value="update">
								Update saved view
							</button>
							<button
								className="button"
								type="button"
								onClick={() => {
									deleteView(colonyId, selected.id);
								}}
							>
								Delete saved view
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
