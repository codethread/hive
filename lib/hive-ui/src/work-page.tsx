import type { Board, Card, Navigation } from "../contracts.ts";
import { EMPTY, boards, colonies, loadBoard, loadDetail, preferences, snapshot } from "./data.ts";
import { Label, ResourceNotice, outcomeName, time } from "./ui.tsx";
import { Link, Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
	PAGE_SIZE,
	REQUEST_PAGE_SIZE,
	boardFilterSchema,
	boardKey,
	navigationSchema,
	requestScopeSchema,
} from "../contracts.ts";
import { Inspector } from "./inspector.tsx";
import type { SubmitEvent } from "react";
import { useStore } from "zustand";
import { z } from "zod";

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

export function WorkPage() {
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	const search = useSearch({ from: "/colonies/$colonyId" });
	const filter = boardFilterSchema.parse(search);
	const key = boardKey(colonyId, filter);
	const resource = useStore(boards.store, (state) => state.entries[key] ?? EMPTY);
	const board = snapshot(resource);
	const colony = useStore(colonies.store, (state) =>
		snapshot(state.entries["colonies"] ?? EMPTY)?.colonies.find((entry) => entry.id === colonyId),
	);
	return (
		<main>
			<FilterBar board={board} />
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2 text-xs text-muted">
				<span>
					{board
						? `${board.bees.length} ${search.requests} requests · ${board.cards.length} beads on this page`
						: "No work snapshot"}
				</span>
				<div className="flex items-center gap-3">
					{board && <span>Read {time(board.fetchedAt)} · manual refresh</span>}
					<button
						className="button"
						type="button"
						disabled={resource.kind === "loading"}
						onClick={() => {
							void loadBoard(colonyId, filter, true);
							if (search.bead !== undefined) {
								void loadDetail(colonyId, search.bead, {
									fresh: true,
									scope: requestScopeSchema.parse(search),
								});
							}
						}}
					>
						Refresh
					</button>
				</div>
			</div>
			<ResourceNotice resource={resource} />
			{board && search.requests === "completed" && (
				<RequestPagination hasMore={board.requestHasMore} />
			)}
			<div className={search.bead === undefined ? "work-layout" : "work-layout with-inspector"}>
				<section aria-label="Bead board" className="min-w-0">
					{board && <BoardColumns board={board} />}
					{board && <Pagination hasMore={board.hasMore} />}
				</section>
				{search.bead !== undefined && <Inspector colonyId={colonyId} id={search.bead} />}
			</div>
			<footer className="flex flex-wrap justify-between gap-2 border-t border-line px-5 py-3 text-xs text-muted">
				<span>Recorded observations may be stale. Process health is not checked.</span>
				<details className="max-w-full">
					<summary>Tracker & query</summary>
					<div className="mt-3 space-y-2 break-all font-mono text-[11px]">
						<p>{colony?.root}</p>
						<p>{colony?.beadsDb}</p>
						<p>Request inventory read: {board?.inventoryReadAt}</p>
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
function FilterBar({ board }: { board: Board | null }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const count = search.all.length + search.any.length + search.exclude.length;
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const query = z.string().parse(new FormData(event.currentTarget).get("query"));
		void navigate({ search: (current) => ({ ...current, page: 0, query }) });
	};
	return (
		<section aria-label="Work filters" className="border-b border-line bg-panel">
			<div className="flex flex-wrap items-center gap-3 px-5 py-3">
				<label className="flex items-center gap-2 text-sm text-muted">
					Bee requests
					<select
						className="control"
						value={search.requests}
						onChange={(event) => {
							const requests = requestScopeSchema.shape.requests.parse(event.target.value);
							void navigate({
								search: (current) =>
									withoutSelection({
										...current,
										closed: requests === "completed",
										page: 0,
										requestPage: 0,
										requests,
									}),
							});
						}}
					>
						<option value="open">Open</option>
						<option value="completed">Completed</option>
					</select>
				</label>
				<form key={search.query} className="flex flex-1 gap-2 sm:max-w-md" onSubmit={submit}>
					<label className="sr-only" htmlFor="search">
						Search native bead text
					</label>
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
					Closed beads
				</label>
				{(count > 0 || search.query) && (
					<button
						className="button"
						type="button"
						onClick={() => {
							void navigate({
								search: (current) => ({
									...current,
									all: [],
									any: [],
									exclude: [],
									page: 0,
									query: "",
								}),
							});
						}}
					>
						Clear filters
					</button>
				)}
			</div>
			<details className="border-t border-line px-5 py-3" open>
				<summary className="text-xs text-muted">
					Labels{count > 0 ? ` · ${count} selected` : ""}
				</summary>
				<div className="mt-3 grid gap-4 md:grid-cols-3">
					{(["all", "any", "exclude"] as const).map((group) => (
						<LabelFilter key={group} group={group} labels={board?.labels ?? []} />
					))}
				</div>
				<p className="mt-3 text-[11px] text-muted">
					Exact, case-sensitive labels · groups combine with AND · suggestions from this page only
				</p>
			</details>
		</section>
	);
}

function LabelFilter({ group, labels }: { group: "all" | "any" | "exclude"; labels: string[] }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const name = { all: "All of", any: "Any of", exclude: "Exclude" }[group];
	const flag = { all: "--label", any: "--label-any", exclude: "--exclude-label" }[group];
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
			<p className="mb-2 text-xs font-medium">
				{name}
				<span className="ml-2 font-mono text-[10px] text-muted">{flag}</span>
			</p>
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

function BoardColumns({ board }: { board: Board }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const statuses = [
		...new Set([
			...(search.requests === "open"
				? STATUS_ORDER.filter((status) => status !== "deferred" && status !== "closed")
				: []),
			...board.cards.map((card) => card.status),
		]),
	];
	statuses.sort((left, right) => STATUS_ORDER.indexOf(left) - STATUS_ORDER.indexOf(right));
	if (board.cards.length === 0) {
		return (
			<div className="grid min-h-80 place-content-center gap-2 p-6 text-center">
				<h2 className="font-medium">
					{board.bees.length === 0 ? `No ${search.requests} bee requests` : "No matching beads"}
				</h2>
				<p className="text-sm text-muted">
					{board.bees.length === 0
						? "No requests in this view. Choose another request view or history page."
						: "Try clearing the label filters or including closed beads."}
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
				{card.bees.map((bee) => (
					<div key={bee.id} className="text-[11px]">
						<div className="flex justify-between gap-2 text-muted">
							<span className="truncate">{bee.identity}</span>
							<span>{bee.kind}</span>
						</div>
						<p
							className="mt-1 truncate text-muted"
							title={
								bee.observation
									? `${bee.observation.text} · ${bee.observation.at}`
									: "No recorded observation"
							}
						>
							{bee.outcome === "pending"
								? `Recorded: ${bee.observation?.text ?? "unknown"}`
								: `${outcomeName(bee.outcome)}${bee.closedAt === null ? "" : ` · ${time(bee.closedAt)}`}`}
						</p>
					</div>
				))}
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
		void navigate({ search: (current) => withoutSelection({ ...current, page: 0, requestPage }) });
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
