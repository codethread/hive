/* eslint-disable import/max-dependencies -- The route composes the board shell, navigation, filters and detail panels. */
import { BeeHistory, BoardTabs } from "./board-navigation.tsx";
import {
	EMPTY,
	boards,
	colonies,
	hierarchies,
	inventories,
	loadView,
	outlines,
	preferences,
	snapshot,
} from "./data.ts";
import { Link, Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
	PAGE_SIZE,
	REQUEST_PAGE_SIZE,
	boardFilterSchema,
	boardKey,
	hierarchyKey,
	inventoryKey,
	navigationSchema,
} from "../contracts.ts";
import { ResourceNotice, time } from "./ui.tsx";
import { BeadBoard } from "./bead-board.tsx";
import { BeadOutline } from "./bead-outline.tsx";
import { BeeWorkspace } from "./bee-workspace.tsx";
import { ColumnSettings } from "./column-settings.tsx";
import { FilterWorkspace } from "./filter-drawer.tsx";
import { HeaderSearch } from "./board-search.tsx";
import { Inspector } from "./inspector.tsx";
import type { Navigation } from "../contracts.ts";
import { useStore } from "zustand";

export function Shell() {
	const theme = useStore(preferences, (state) => state.theme);
	const resource = useStore(colonies.store, (state) => state.entries["colonies"] ?? EMPTY);
	const choices = snapshot(resource)?.colonies ?? [];
	const { colonyId } = useParams({ strict: false });
	const navigate = useNavigate();
	return (
		<div data-theme={theme} className="app-shell bg-canvas text-ink">
			<header className="app-header">
				<div className="flex items-center gap-3">
					<Link to="/" className="text-lg font-semibold tracking-tight text-accent">
						hive<span className="ml-1 text-muted">/</span>
					</Link>
					<label className="sr-only" htmlFor="colony">
						Select colony
					</label>
					<select
						id="colony"
						className="control max-w-64"
						value={colonyId ?? ""}
						onChange={(event) => {
							const selected = event.target.value;
							void navigate({
								params: { colonyId: selected },
								search: preferences.getState().views[selected] ?? navigationSchema.parse({}),
								to: "/colonies/$colonyId",
							});
						}}
					>
						{colonyId === undefined && <option value="">Select colony</option>}
						{choices.map((entry) => (
							<option key={entry.id} value={entry.id}>
								{entry.name}
							</option>
						))}
					</select>
					<h1 className="text-sm font-medium">Work board</h1>
				</div>
				{colonyId !== undefined && <BoardTabs />}
				{colonyId !== undefined && <HeaderSearch />}
				<div className="flex items-center gap-4">
					<span className="text-xs text-muted">Read-only</span>
					<fieldset className="flex rounded-md border border-line p-0.5" aria-label="Theme">
						{(["moss", "paper"] as const).map((name) => (
							<button
								key={name}
								type="button"
								aria-pressed={theme === name}
								className="theme-button"
								onClick={() => {
									preferences.setState({ theme: name });
								}}
							>
								{name === "moss" ? "Dark" : "Light"}
							</button>
						))}
					</fieldset>
				</div>
			</header>
			<ResourceNotice resource={resource} />
			<Outlet />
		</div>
	);
}

export function Welcome() {
	return <p className="p-6 text-muted">Select a colony.</p>;
}

// eslint-disable-next-line max-statements -- Select the board and inventory resources together for one route.
export function WorkPage() {
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	const search = useSearch({ from: "/colonies/$colonyId" });
	const filter = boardFilterSchema.parse(search);
	const key = boardKey(colonyId, filter);
	const resource = useStore(boards.store, (state) => state.entries[key] ?? EMPTY);
	const board = snapshot(resource);
	const hierarchyResource = useStore(
		hierarchies.store,
		(state) =>
			state.entries[hierarchyKey(colonyId, board?.cards.map((card) => card.id) ?? [])] ?? EMPTY,
	);
	const outlineResource = useStore(
		outlines.store,
		(state) => state.entries[`${colonyId}/${search.outline}`] ?? EMPTY,
	);
	const inventoryResource = useStore(
		inventories.store,
		(state) => state.entries[inventoryKey(colonyId, search)] ?? EMPTY,
	);
	const inventory = search.view === "beads" ? undefined : snapshot(inventoryResource);
	const colony = useStore(colonies.store, (state) =>
		snapshot(state.entries["colonies"] ?? EMPTY)?.colonies.find((entry) => entry.id === colonyId),
	);
	let summary = "Bee provenance";
	let readAt: string | null = null;
	if (search.view === "beads") {
		summary = board ? `${board.cards.length} beads on this page` : "Beads";
		if (search.outline !== undefined) {
			summary = `Outline · ${search.outline}`;
		}
		readAt =
			search.outline === undefined
				? (board?.fetchedAt ?? null)
				: (snapshot(outlineResource)?.fetchedAt ?? null);
	} else if (inventory?.kind === "loaded") {
		({ readAt } = inventory);
	}

	return (
		<main className="work-page">
			<FilterWorkspace board={board}>
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2 text-xs text-muted">
					<div className="flex flex-wrap items-center gap-3">
						{search.view !== "beads" && <BeeHistory />}
						<span>
							{summary}
							{inventory?.kind === "loaded" &&
								` · ${inventory.bees.length} matching ${search.view} requests`}
						</span>
					</div>
					<div className="flex items-center gap-3">
						{readAt !== null && <span>Updated {time(readAt)}</span>}
						{search.view === "beads" && search.outline === undefined && board && (
							<ColumnSettings
								key={colonyId}
								colony={colonyId}
								present={board.cards.map((card) => card.status)}
								selected={search.statuses}
							/>
						)}
						<button
							className="button"
							type="button"
							disabled={
								resource.kind === "loading" ||
								inventoryResource.kind === "loading" ||
								outlineResource.kind === "loading" ||
								hierarchyResource.kind === "loading"
							}
							onClick={() => {
								void loadView(colonyId, search, true);
							}}
						>
							Refresh
						</button>
					</div>
				</div>
				{search.outline === undefined && <ResourceNotice resource={resource} />}
				{search.view !== "beads" && <ResourceNotice resource={inventoryResource} />}
				{inventory?.kind === "loaded" && search.view === "completed" && (
					<RequestPagination hasMore={inventory.hasMore} />
				)}
				<div className="work-layout">
					{search.view === "beads" ? (
						<section aria-label="Bead board" className="min-w-0">
							{search.outline === undefined ? (
								board && (
									<>
										<ResourceNotice resource={hierarchyResource} label="Hierarchy" />
										<BeadBoard board={board} hierarchy={snapshot(hierarchyResource)} />
										<Pagination hasMore={board.hasMore} />
									</>
								)
							) : (
								<BeadOutline colonyId={colonyId} id={search.outline} />
							)}
						</section>
					) : (
						inventory?.kind === "loaded" && (
							<div className="min-w-0">
								<BeeWorkspace colonyId={colonyId} inventory={inventory} board={board} />
								{search.request !== undefined && board && <Pagination hasMore={board.hasMore} />}
							</div>
						)
					)}
					{search.bead !== undefined && <Inspector colonyId={colonyId} id={search.bead} />}
				</div>
				<footer className="flex flex-wrap justify-between gap-2 border-t border-line px-5 py-3 text-xs text-muted">
					<details className="max-w-full">
						<summary>Tracker & query</summary>
						<div className="mt-3 space-y-2 break-all font-mono text-[11px]">
							<p>{colony?.root}</p>
							<p>{colony?.beadsDb}</p>
							{inventory?.kind === "loaded" && <p>Request inventory read: {inventory.readAt}</p>}
							<pre className="whitespace-pre-wrap">
								{board && board.query.length > 0
									? board.query.map(shellQuote).join(" ")
									: "No task board query for this selection."}
							</pre>
						</div>
					</details>
				</footer>
			</FilterWorkspace>
		</main>
	);
}

// --- Board and navigation controls ---
function Pagination({ hasMore }: { hasMore: boolean }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	return (
		<div className="flex items-center justify-end gap-3 px-5 py-4 text-xs text-muted">
			<span>
				Page {search.page + 1} · up to {PAGE_SIZE} beads
			</span>
			<button
				type="button"
				className="button"
				disabled={search.page === 0}
				onClick={() => {
					void navigate({
						search: (current) => withoutSelection({ ...current, page: current.page - 1 }),
					});
				}}
			>
				Previous
			</button>
			<button
				type="button"
				className="button"
				disabled={!hasMore}
				onClick={() => {
					void navigate({
						search: (current) => withoutSelection({ ...current, page: current.page + 1 }),
					});
				}}
			>
				Next
			</button>
		</div>
	);
}

function RequestPagination({ hasMore }: { hasMore: boolean }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const move = (requestPage: number): void => {
		void navigate({
			search: (current) => {
				const { ancestry: _ancestry, request: _request, bead: _bead, ...rest } = current;
				return { ...rest, page: 0, requestPage };
			},
		});
	};
	return (
		<nav
			aria-label="Completed request history"
			className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 text-xs text-muted"
		>
			<span>
				Completed requests · page {search.requestPage + 1} · up to {REQUEST_PAGE_SIZE} requests,
				newest first
			</span>
			<div className="flex gap-2">
				<button
					type="button"
					className="button"
					disabled={search.requestPage === 0}
					onClick={() => {
						move(search.requestPage - 1);
					}}
				>
					Newer requests
				</button>
				<button
					type="button"
					className="button"
					disabled={!hasMore}
					onClick={() => {
						move(search.requestPage + 1);
					}}
				>
					Older requests
				</button>
			</div>
		</nav>
	);
}

function withoutSelection(navigation: Navigation): Navigation {
	const { bead: _bead, ...rest } = navigation;
	return rest;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
