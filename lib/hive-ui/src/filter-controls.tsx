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
import { EMPTY, colonies, snapshot } from "./data.ts";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { DEFAULT_BEAD_STATUSES } from "../contracts.ts";
import type { Navigation } from "../contracts.ts";
import type { SubmitEvent } from "react";
import { useId } from "react";
import { useStore } from "zustand";
import { z } from "zod";

const PRIORITY_NAMES = ["Critical", "High", "Normal", "Low", "Backlog"];
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

export function PriorityFilters() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	return (
		<fieldset aria-label="Priority">
			<legend className="filter-heading">Priority</legend>
			<div className="status-options">
				{PRIORITY_NAMES.map((name, priority) => (
					<button
						key={name}
						type="button"
						className="status-option"
						aria-label={`P${priority} · ${name}`}
						title={name}
						aria-pressed={search.priorities.includes(priority)}
						onClick={() => {
							void navigate({
								search: (current) =>
									editFilters(current, {
										priorities: current.priorities.includes(priority)
											? current.priorities.filter((value) => value !== priority)
											: [...current.priorities, priority],
									}),
							});
						}}
					>
						P{priority}
					</button>
				))}
			</div>
		</fieldset>
	);
}

export function StatusFilters() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const { colonyId } = useParams({ from: "/colonies/$colonyId" });
	const resource = useStore(colonies.store, (state) => state.entries["colonies"] ?? EMPTY);
	const statuses =
		snapshot(resource)?.colonies.find((colony) => colony.id === colonyId)?.statuses ??
		DEFAULT_BEAD_STATUSES;
	return (
		<fieldset className="min-w-0">
			<legend className="filter-heading">Status</legend>
			<div className="status-options">
				{statuses.map((status) => (
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
						{statusName(status)}
					</button>
				))}
			</div>
			{search.statuses.length === 0 && (
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
		</section>
	);
}

export function ActiveFilters() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const chips = [
		...search.statuses.map((status) => ({
			key: `status:${status}`,
			name: `Status: ${statusName(status)}`,
			patch: { statuses: search.statuses.filter((value) => value !== status) },
		})),
		...search.priorities.map((priority) => ({
			key: `priority:${priority}`,
			name: `Priority: P${priority}`,
			patch: { priorities: search.priorities.filter((value) => value !== priority) },
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
		...(search.view !== "beads" && search.beeQuery
			? [{ key: "beeQuery", name: `Requests: ${search.beeQuery}`, patch: { beeQuery: "" } }]
			: []),
		...(search.closed && search.statuses.length === 0
			? [{ key: "closed", name: "Including closed", patch: { closed: false } }]
			: []),
	];
	if (chips.length === 0) {
		return null;
	}
	return (
		<div className="active-filters" aria-label="Active filters">
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
								priorities: [],
								query: "",
								statuses: [],
							}),
					});
				}}
			>
				Clear all
			</button>
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

/** Native custom statuses share the same readable naming as built-in statuses. */
export function statusName(status: string): string {
	const words = status.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
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
			<label className="filter-heading" htmlFor={id} title={GROUP_HINTS[group]}>
				{GROUP_NAMES[group]}
			</label>
			<form className="flex gap-2" onSubmit={add}>
				<input
					className="control min-w-0 flex-1"
					id={id}
					name="label"
					list={`${id}-suggestions`}
					placeholder="Add exact label…"
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
