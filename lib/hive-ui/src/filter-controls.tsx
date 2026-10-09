import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuTrigger,
} from "@radix-ui/react-context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Navigation } from "../contracts.ts";
import type { SubmitEvent } from "react";
import { beadStatusSchema } from "../contracts.ts";
import { useId } from "react";
import { z } from "zod";

export const STATUS_NAMES = {
	blocked: "Blocked",
	closed: "Closed",
	deferred: "Deferred",
	in_progress: "In progress",
	open: "Open",
};
const LABEL_GROUPS = ["all", "any", "exclude"] as const;
const GROUP_NAMES = { all: "AND", any: "OR", exclude: "Exclude" };
const GROUP_HINTS = {
	all: "Every label required",
	any: "At least one label",
	exclude: "Hide matching beads",
};
type LabelGroup = (typeof LABEL_GROUPS)[number];

/** Bead filters change request membership too; start both pages without stale selections. */
export function editFilters(current: Navigation, patch: Partial<Navigation>): Navigation {
	const { ancestry: _ancestry, bead: _bead, request: _request, ...rest } = current;
	return { ...rest, ...patch, page: 0, requestPage: 0 };
}

export function SearchFilters() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const id = useId();
	return (
		<div className="search-filters">
			{(search.view === "beads" ? (["query"] as const) : (["query", "beeQuery"] as const)).map(
				(field) => (
					<form
						key={`${field}:${search[field]}`}
						className="min-w-0"
						onSubmit={(event) => {
							event.preventDefault();
							const value = z.string().parse(new FormData(event.currentTarget).get("query"));
							void navigate({
								search: (current) =>
									field === "query"
										? editFilters(current, { query: value })
										: { ...current, beeQuery: value },
							});
						}}
					>
						<label className="filter-heading" htmlFor={`${id}-${field}`}>
							{field === "query" ? "Bead text" : "Requests on this page"}
						</label>
						<div className="flex gap-2">
							<input
								id={`${id}-${field}`}
								name="query"
								type="search"
								defaultValue={search[field]}
								placeholder={field === "query" ? "Search beads…" : "Identity, kind, requester…"}
								className="control min-w-0 flex-1"
							/>
							<button className="button" type="submit">
								{field === "query" ? "Search" : "Search bees"}
							</button>
						</div>
					</form>
				),
			)}
		</div>
	);
}

export function StatusFilters() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	return (
		<fieldset className="min-w-0">
			<legend className="filter-heading">
				Bead status <span className="font-normal text-muted">· match any selected</span>
			</legend>
			<div className="status-options">
				{beadStatusSchema.options.map((status) => (
					<button
						key={status}
						type="button"
						className="status-option"
						aria-pressed={search.statuses.includes(status)}
						onClick={() => {
							void navigate({
								search: (current) =>
									editFilters(current, {
										statuses: current.statuses.includes(status)
											? current.statuses.filter((value) => value !== status)
											: [...current.statuses, status],
									}),
							});
						}}
					>
						<span className={`status-dot status-${status}`} />
						{STATUS_NAMES[status]}
					</button>
				))}
			</div>
			{search.statuses.length === 0 ? (
				<label className="mt-3 flex items-center gap-2 text-xs text-muted">
					<input
						type="checkbox"
						checked={search.closed}
						onChange={(event) => {
							const closed = event.target.checked;
							void navigate({ search: (current) => editFilters(current, { closed }) });
						}}
					/>
					Include closed beads
				</label>
			) : (
				<p className="mt-2 text-xs text-muted">Only selected statuses. Select again to remove.</p>
			)}
		</fieldset>
	);
}

export function LabelFilters({ labels }: { labels: string[] }) {
	return (
		<section aria-label="Label filters" className="space-y-3">
			<div className="label-groups">
				{LABEL_GROUPS.map((group) => (
					<LabelFilter key={group} group={group} labels={labels} />
				))}
			</div>
			<p className="text-[11px] leading-relaxed text-muted">
				Exact labels. AND, OR and Exclude groups combine with AND. Suggestions are from this page.
			</p>
		</section>
	);
}

export function ActiveFilters() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const chips = [
		...search.statuses.map((status) => ({
			key: `status:${status}`,
			name: `Status: ${STATUS_NAMES[status]}`,
			patch: { statuses: search.statuses.filter((value) => value !== status) },
		})),
		...LABEL_GROUPS.flatMap((group) =>
			search[group].map((label) => ({
				key: `${group}:${label}`,
				name: `${GROUP_NAMES[group]} ${label}`,
				patch: { [group]: search[group].filter((value) => value !== label) },
			})),
		),
		...(search.query
			? [{ key: "query", name: `Text: ${search.query}`, patch: { query: "" } }]
			: []),
		...(search.beeQuery
			? [{ key: "beeQuery", name: `Requests: ${search.beeQuery}`, patch: { beeQuery: "" } }]
			: []),
		...(search.closed && search.statuses.length === 0
			? [{ key: "closed", name: "Including closed", patch: { closed: false } }]
			: []),
	];
	return (
		<div className="active-filters" aria-label="Active filters">
			<span className="text-[11px] font-medium text-muted">
				{chips.length === 0 ? "No bead filters" : "Showing"}
			</span>
			{chips.map((chip) => (
				<button
					key={chip.key}
					className="filter-chip"
					type="button"
					aria-label={`Remove ${chip.name}`}
					onClick={() => {
						void navigate({
							search: (current) =>
								chip.key === "beeQuery"
									? { ...current, beeQuery: "" }
									: editFilters(current, chip.patch),
						});
					}}
				>
					{chip.name}
					<span aria-hidden="true"> ×</span>
				</button>
			))}
			{chips.length > 0 && (
				<button
					className="clear-filters"
					type="button"
					onClick={() => {
						void navigate({
							search: (current) =>
								editFilters(current, {
									all: [],
									any: [],
									beeQuery: "",
									closed: false,
									exclude: [],
									query: "",
									statuses: [],
								}),
						});
					}}
				>
					Clear all
				</button>
			)}
		</div>
	);
}

/** Radix owns pointer/keyboard menus; native label groups remain URL state. */
export function FilterableLabel({ label }: { label: string }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const choose = (group: LabelGroup) => {
		void navigate({
			search: (current) =>
				editFilters(current, { [group]: [...new Set([...current[group], label])] }),
		});
	};
	return (
		<ContextMenu>
			<DropdownMenu>
				<ContextMenuTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button className="bead-label" type="button" aria-label={`Filter by label ${label}`}>
							{label}
							<span aria-hidden="true" className="label-chevron">
								⌄
							</span>
						</button>
					</DropdownMenuTrigger>
				</ContextMenuTrigger>
				<DropdownMenuContent
					className="label-menu"
					sideOffset={4}
					align="start"
					collisionPadding={12}
				>
					<DropdownMenuLabel className="label-menu-title">
						Filter by <strong>{label}</strong>
					</DropdownMenuLabel>
					{LABEL_GROUPS.map((group) => (
						<DropdownMenuItem
							key={group}
							className="label-menu-item"
							disabled={search[group].includes(label)}
							onSelect={() => {
								choose(group);
							}}
						>
							<span>{GROUP_NAMES[group]}</span>
							<small>{GROUP_HINTS[group]}</small>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<ContextMenuContent className="label-menu" collisionPadding={12}>
				<ContextMenuLabel className="label-menu-title">
					Filter by <strong>{label}</strong>
				</ContextMenuLabel>
				{LABEL_GROUPS.map((group) => (
					<ContextMenuItem
						key={group}
						className="label-menu-item"
						disabled={search[group].includes(label)}
						onSelect={() => {
							choose(group);
						}}
					>
						<span>{GROUP_NAMES[group]}</span>
						<small>{GROUP_HINTS[group]}</small>
					</ContextMenuItem>
				))}
			</ContextMenuContent>
		</ContextMenu>
	);
}

// --- Exact-label entry ---
function LabelFilter({ group, labels }: { group: LabelGroup; labels: string[] }) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const id = useId();
	const add = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const label = z.string().min(1).parse(new FormData(event.currentTarget).get("label"));
		void navigate({
			search: (current) =>
				editFilters(current, { [group]: [...new Set([...current[group], label])] }),
		});
		event.currentTarget.reset();
	};
	return (
		<div className="label-group">
			<label className="filter-heading" htmlFor={id}>
				{GROUP_NAMES[group]} <span className="font-normal text-muted">· {GROUP_HINTS[group]}</span>
			</label>
			<form className="flex gap-2" onSubmit={add}>
				<input
					className="control min-w-0 flex-1"
					id={id}
					name="label"
					list={`${id}-suggestions`}
					placeholder="Exact label…"
					autoComplete="off"
					required
				/>
				<datalist id={`${id}-suggestions`}>
					{labels.map((label) => (
						<option key={label} value={label} aria-label={label} />
					))}
				</datalist>
				<button className="button" type="submit" aria-label={`Add ${GROUP_NAMES[group]} label`}>
					+
				</button>
			</form>
			<div className="mt-2 flex flex-wrap gap-1">
				{search[group].map((label) => (
					<button
						className="filter-chip"
						type="button"
						key={label}
						aria-label={`Remove ${label} from ${GROUP_NAMES[group]}`}
						onClick={() => {
							void navigate({
								search: (current) =>
									editFilters(current, {
										[group]: current[group].filter((value) => value !== label),
									}),
							});
						}}
					>
						{label}
						<span aria-hidden="true"> ×</span>
					</button>
				))}
			</div>
		</div>
	);
}
