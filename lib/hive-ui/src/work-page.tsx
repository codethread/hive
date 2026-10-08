import type { Board, Card, Navigation } from "../contracts.ts";
import { EMPTY, boards, colonies, inventories, loadView, preferences, snapshot } from "./data.ts";
import { Label, ResourceNotice, time } from "./ui.tsx";
import { Link, Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
	PAGE_SIZE,
	REQUEST_PAGE_SIZE,
	boardFilterSchema,
	boardKey,
	inventoryKey,
	navigationSchema,
} from "../contracts.ts";
import { BeeWorkspace } from "./bee-workspace.tsx";
import { BoardToolbar } from "./filter-drawer.tsx";
import { Inspector } from "./inspector.tsx";
import { useStore } from "zustand";

const STATUS_ORDER = ["in_progress", "open", "blocked", "deferred", "closed"];
const STATUS_NAMES: Record<string, string> = {
	blocked: "Blocked",
	closed: "Closed",
	deferred: "Deferred",
	in_progress: "In progress",
	open: "Open",
};

export function Shell() {
	const theme = useStore(preferences, (state) => state.theme);
	const resource = useStore(colonies.store, (state) => state.entries["colonies"] ?? EMPTY);
	const choices = snapshot(resource)?.colonies ?? [];
	const { colonyId } = useParams({ strict: false });
	const navigate = useNavigate();
	return (
		<div data-theme={theme} className="min-h-screen bg-canvas text-ink">
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-5 py-3">
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
								{name === "moss" ? "Moss" : "Paper"}
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
	return <p className="p-6 text-muted">Choose a configured colony to read its work.</p>;
}

// eslint-disable-next-line max-statements -- Select the board and inventory resources together for one route.
export function WorkPage() {
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	const search = useSearch({ from: "/colonies/$colonyId" });
	const filter = boardFilterSchema.parse(search);
	const key = boardKey(colonyId, filter);
	const resource = useStore(boards.store, (state) => state.entries[key] ?? EMPTY);
	const board = snapshot(resource);
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
		summary = board ? `${board.cards.length} beads on this page` : "No work snapshot";
		readAt = board?.fetchedAt ?? null;
	} else if (inventory?.kind === "loaded") {
		({ readAt } = inventory);
	}

	return (
		<main>
			<BoardToolbar board={board} />
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2 text-xs text-muted">
				<span>
					{summary}
					{inventory?.kind === "loaded" && ` · ${inventory.bees.length} ${search.view} requests`}
				</span>
				<div className="flex items-center gap-3">
					{readAt !== null && <span>Read {time(readAt)} · manual refresh</span>}
					<button
						className="button"
						type="button"
						disabled={resource.kind === "loading" || inventoryResource.kind === "loading"}
						onClick={() => {
							void loadView(colonyId, search, true);
						}}
					>
						Refresh
					</button>
				</div>
			</div>
			<ResourceNotice resource={resource} />
			{search.view !== "beads" && <ResourceNotice resource={inventoryResource} />}
			{inventory?.kind === "loaded" && search.view === "completed" && (
				<RequestPagination hasMore={inventory.hasMore} />
			)}
			<div className="work-layout">
				{search.view === "beads" ? (
					<section aria-label="Bead board" className="min-w-0">
						{board && <BoardColumns board={board} />}
						{board && <Pagination hasMore={board.hasMore} />}
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
				<span>
					{search.view === "beads"
						? "Read-only bead snapshot · refresh to read the latest changes."
						: "Recorded observations may be stale. Process health is not checked."}
				</span>
				<details className="max-w-full">
					<summary>Tracker & query</summary>
					<div className="mt-3 space-y-2 break-all font-mono text-[11px]">
						<p>{colony?.root}</p>
						<p>{colony?.beadsDb}</p>
						{inventory?.kind === "loaded" && <p>Request inventory read: {inventory.readAt}</p>}
						<pre className="whitespace-pre-wrap">
							{board && board.query.length > 0
								? board.query.map(shellQuote).join(" ")
								: "No linked tasks; no task query executed."}
						</pre>
					</div>
				</details>
			</footer>
		</main>
	);
}

// --- Board and navigation controls ---
function BoardColumns({ board }: { board: Board }) {
	const statuses = [
		...new Set([
			...STATUS_ORDER.filter((status) => status !== "deferred" && status !== "closed"),
			...board.cards.map((card) => card.status),
		]),
	];
	statuses.sort((left, right) => STATUS_ORDER.indexOf(left) - STATUS_ORDER.indexOf(right));
	if (board.cards.length === 0) {
		return (
			<div className="grid min-h-80 place-content-center gap-2 p-6 text-center">
				<h2 className="font-medium">No matching beads</h2>
				<p className="text-sm text-muted">
					Try clearing the label filters or including closed beads.
				</p>
			</div>
		);
	}
	return (
		<section className="board-columns" aria-label="Native status columns">
			{statuses.map((status) => {
				const cards = board.cards.filter((card) => card.status === status);
				return (
					<section key={status} className="min-w-0">
						<header className="mb-3 flex items-center justify-between border-b border-line py-4 text-xs">
							<h2 className="flex items-center gap-2">
								<span className={`status-dot status-${status}`} />
								{STATUS_NAMES[status] ?? status}
							</h2>
							<span className="font-mono text-muted">{cards.length}</span>
						</header>
						<div className="space-y-3">
							{cards.map((card) => (
								<BeadCard key={card.id} card={card} />
							))}
							{cards.length === 0 && (
								<p className="py-3 text-xs text-muted">No beads in this column</p>
							)}
						</div>
					</section>
				);
			})}
		</section>
	);
}

function BeadCard({ card }: { card: Card }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	return (
		<article className={`bead-card ${search.bead === card.id ? "selected" : ""}`}>
			<div className="p-3.5">
				<div className="flex items-center justify-between gap-2">
					<span className="font-mono text-[11px] text-muted">{card.id}</span>
					<Label>P{card.priority}</Label>
				</div>
				<h3 className="my-3 text-[15px] leading-snug font-medium">
					<Link
						from="/colonies/$colonyId"
						to="."
						search={(current) => ({ ...current, bead: card.id })}
						className="hover:text-accent"
						aria-current={search.bead === card.id ? "true" : undefined}
					>
						{card.title}
					</Link>
				</h3>
				<div className="flex flex-wrap gap-1">
					{card.labels.map((label) => (
						<Label key={label}>{label}</Label>
					))}
				</div>
			</div>
			<div className="space-y-2 border-t border-line bg-panel px-3.5 py-2.5">
				<p className="text-[11px] text-muted">
					Assigned to {card.assignee ?? "nobody"} · updated {time(card.updatedAt)}
				</p>
			</div>
		</article>
	);
}

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
