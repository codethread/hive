import type { Board, Navigation } from "../contracts.ts";
import {
	deleteView,
	filterSet,
	sameFilters,
	saveView,
	savedViews,
	selectSavedView,
} from "./saved-views.ts";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { SavedView } from "./saved-views.ts";
import type { SubmitEvent } from "react";
import { boardScopeSchema } from "../contracts.ts";
import { useRef } from "react";
import { useStore } from "zustand";
import { z } from "zod";

export function BoardToolbar({ board }: { board: Board | null }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const dialog = useRef<HTMLDialogElement>(null);
	const saved = useStore(savedViews);
	const views = saved.byColony[colonyId] ?? [];
	const selected = views.find((entry) => entry.id === saved.active[colonyId]);
	const modified = selected !== undefined && !sameFilters(selected.filters, filterSet(search));
	const count =
		search.all.length +
		search.any.length +
		search.exclude.length +
		Number(search.closed) +
		Number(search.query.length > 0) +
		Number(search.beeQuery.length > 0);
	return (
		<section aria-label="Board views" className="border-b border-line bg-panel">
			<div className="flex flex-wrap items-center gap-3 px-5 py-3">
				<ViewSelector />
				<button
					className="button"
					type="button"
					aria-haspopup="dialog"
					aria-label={count > 0 ? `Filters (${count} active)` : "Filters"}
					onClick={() => {
						dialog.current!.showModal();
					}}
				>
					Filters
					{count > 0 && <span className="ml-2 rounded bg-tint px-1.5 text-accent">{count}</span>}
				</button>
				<label className="flex min-w-0 items-center gap-2 text-sm text-muted">
					Saved view
					<select
						className="control min-w-0 max-w-56"
						value={modified ? "" : (selected?.id ?? "")}
						onChange={(event) => {
							const id = event.target.value;
							const view = views.find((entry) => entry.id === id)!;
							selectSavedView(colonyId, id);
							void navigate({ search: { ...view.filters, page: 0, requestPage: 0 } });
						}}
					>
						<option value="" disabled>
							{views.length === 0 ? "No saved views" : "Custom filters"}
						</option>
						{views.map((entry) => (
							<option key={entry.id} value={entry.id}>
								{entry.name}
							</option>
						))}
					</select>
				</label>
				{saved.notice.kind === "error" && (
					<p role="alert" className="text-xs text-alert">
						Saved views need attention. Open Filters for details.
					</p>
				)}
			</div>
			<dialog ref={dialog} className="filter-drawer" aria-labelledby="filters-title">
				<header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
					<h2 id="filters-title" className="font-medium">
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
				<div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain p-5">
					<NativeFilters />
					{search.view !== "beads" && (
						<p className="text-xs text-muted">
							Bead text, labels and closed-bead filters apply to the selected request’s linked work.
							They do not hide requests.
						</p>
					)}
					<section aria-label="Label filters" className="space-y-5 border-t border-line pt-5">
						<h3 className="text-sm font-medium">Labels</h3>
						{(["all", "any", "exclude"] as const).map((group) => (
							<LabelFilter key={group} group={group} labels={board?.labels ?? []} />
						))}
						<p className="text-xs leading-relaxed text-muted">
							Exact, case-sensitive labels. Groups combine with AND. Suggestions come from this page
							only.
						</p>
					</section>
					<SavedViewForm
						colonyId={colonyId}
						search={search}
						selected={selected}
						modified={modified}
					/>
				</div>
			</dialog>
		</section>
	);
}

// --- URL filters and browser-local named views ---
function ViewSelector() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	return (
		<label className="flex items-center gap-2 text-sm text-muted">
			View
			<select
				className="control"
				value={search.view}
				onChange={(event) => {
					const view = boardScopeSchema.shape.view.parse(event.target.value);
					void navigate({
						search: (current) => {
							const { ancestry: _ancestry, bead: _bead, request: _request, ...rest } = current;
							return { ...rest, closed: view === "completed", page: 0, requestPage: 0, view };
						},
					});
				}}
			>
				<option value="beads">Beads</option>
				<option value="open">Open bees</option>
				<option value="completed">Completed bees</option>
			</select>
		</label>
	);
}

function NativeFilters() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const query = z.string().parse(new FormData(event.currentTarget).get("query"));
		void navigate({ search: (current) => ({ ...current, page: 0, query }) });
	};
	return (
		<section aria-label="Bead filters" className="space-y-4">
			{search.view !== "beads" && (
				<form
					key={`requests:${search.beeQuery}`}
					className="space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						const beeQuery = z.string().parse(new FormData(event.currentTarget).get("beeQuery"));
						void navigate({ search: (current) => ({ ...current, beeQuery }) });
					}}
				>
					<label className="text-sm font-medium" htmlFor="bee-search">
						Search requests on this page
					</label>
					<div className="flex gap-2">
						<input
							id="bee-search"
							name="beeQuery"
							type="search"
							defaultValue={search.beeQuery}
							placeholder="Identity, kind, requester or ID…"
							className="control min-w-0 flex-1"
						/>
						<button className="button" type="submit">
							Search bees
						</button>
					</div>
				</form>
			)}
			<form key={`beads:${search.query}`} className="space-y-2" onSubmit={submit}>
				<label className="text-sm font-medium" htmlFor="search">
					Search bead text
				</label>
				<div className="flex gap-2">
					<input
						id="search"
						name="query"
						type="search"
						defaultValue={search.query}
						placeholder="Search bead text…"
						className="control min-w-0 flex-1"
					/>
					<button className="button" type="submit">
						Search
					</button>
				</div>
			</form>
			<label className="flex items-center gap-2 text-sm text-muted">
				<input
					type="checkbox"
					checked={search.closed}
					onChange={(event) => {
						void navigate({
							search: (current) => ({ ...current, closed: event.target.checked, page: 0 }),
						});
					}}
				/>
				Include closed beads
			</label>
			<button
				className="button"
				type="button"
				onClick={() => {
					void navigate({
						search: (current) => ({
							...current,
							all: [],
							any: [],
							beeQuery: "",
							closed: current.view === "completed",
							exclude: [],
							page: 0,
							query: "",
						}),
					});
				}}
			>
				Clear filters
			</button>
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
				Keep a named set of filters for this colony in this browser. Includes the Beads or Bees
				view; opens at the first page.
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
				<label className="block text-xs text-muted" htmlFor="view-name">
					View name
				</label>
				<input
					id="view-name"
					name="name"
					className="control w-full"
					defaultValue={selected?.name ?? ""}
					placeholder="e.g. UI ready to pick up"
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
function LabelFilter({ group, labels }: { group: "all" | "any" | "exclude"; labels: string[] }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const name = { all: "All of", any: "Any of", exclude: "Exclude" }[group];
	const hint = {
		all: "Every label required",
		any: "At least one label",
		exclude: "Hide any matching bead",
	}[group];
	const add = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const label = z.string().parse(new FormData(event.currentTarget).get("label"));
		if (label.length === 0) {
			return;
		}
		void navigate({
			search: (current) => ({
				...current,
				[group]: [...new Set([...current[group], label])],
				page: 0,
			}),
		});
		event.currentTarget.reset();
	};
	return (
		<div>
			<p className="mb-2 text-xs font-medium">{name}</p>
			<div className="mb-2 flex min-h-6 flex-wrap gap-1">
				{search[group].map((label) => (
					<button
						className="filter-chip"
						type="button"
						key={label}
						aria-label={`Remove ${label} from ${name}`}
						onClick={() => {
							void navigate({
								search: (current) => ({
									...current,
									[group]: current[group].filter((entry) => entry !== label),
									page: 0,
								}),
							});
						}}
					>
						{label}
						<span aria-hidden="true"> ×</span>
					</button>
				))}
				{search[group].length === 0 && <span className="text-xs text-muted">{hint}</span>}
			</div>
			<form className="flex gap-2" onSubmit={add}>
				<label className="sr-only" htmlFor={`label-${group}`}>
					{name} label
				</label>
				<input
					className="control min-w-0 flex-1"
					id={`label-${group}`}
					name="label"
					list={`suggestions-${group}`}
					placeholder="Exact label…"
					autoComplete="off"
				/>
				<datalist id={`suggestions-${group}`}>
					{labels.map((label) => (
						<option key={label} value={label} aria-label={label} />
					))}
				</datalist>
				<button className="button" type="submit" aria-label={`Add ${name} label`}>
					+
				</button>
			</form>
		</div>
	);
}
