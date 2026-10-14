import { useEffect, useId, useRef } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { editFilters } from "./filter-controls.tsx";
import { preferences } from "./data.ts";
import { useStore } from "zustand";
import { z } from "zod";

export function HeaderSearch() {
	const showWorkflowBeads = useStore(preferences, (state) => state.showWorkflowBeads);
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const input = useRef<HTMLInputElement>(null);
	const id = useId();
	useEffect(() => {
		const focusSearch = (event: KeyboardEvent) => {
			if (!isSearchShortcut(event)) {
				return;
			}
			event.preventDefault();
			input.current!.focus();
			input.current!.select();
		};
		globalThis.addEventListener("keydown", focusSearch);
		return () => {
			globalThis.removeEventListener("keydown", focusSearch);
		};
	}, []);
	return (
		<search className="header-search" aria-label="Bead search">
			<form
				key={search.query}
				className="flex min-w-0 flex-1 gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const query = z.string().parse(new FormData(event.currentTarget).get("query"));
					void navigate({ search: (current) => editFilters(current, { query }) });
				}}
			>
				<label className="sr-only" htmlFor={id}>
					Search beads
				</label>
				<div className="relative min-w-0 flex-1">
					<input
						ref={input}
						id={id}
						name="query"
						type="search"
						defaultValue={search.query}
						placeholder="Search beads…"
						className="control w-full pr-9"
						aria-keyshortcuts="/"
					/>
					<kbd aria-hidden="true" className="search-shortcut">
						/
					</kbd>
				</div>
				<button className="button" type="submit">
					Search
				</button>
			</form>
			{search.view === "beads" && search.outline === undefined && (
				<label className="flex shrink-0 items-center gap-2 text-xs text-muted">
					<input
						type="checkbox"
						checked={showWorkflowBeads}
						onChange={(event) => {
							preferences.setState({ showWorkflowBeads: event.target.checked });
						}}
					/>
					Show workflow beads
				</label>
			)}
		</search>
	);
}

export function BeeSearch() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	const id = useId();
	return (
		<form
			key={search.beeQuery}
			className="flex min-w-0 gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				const beeQuery = z.string().parse(new FormData(event.currentTarget).get("query"));
				void navigate({ search: (current) => ({ ...current, beeQuery }) });
			}}
		>
			<label className="sr-only" htmlFor={id}>
				Requests on this page
			</label>
			<input
				id={id}
				name="query"
				type="search"
				defaultValue={search.beeQuery}
				placeholder="Find a bee on this page…"
				className="control min-w-0 flex-1"
			/>
			<button className="button" type="submit">
				Find bee
			</button>
		</form>
	);
}

// --- Global keyboard navigation ---
function isSearchShortcut(event: KeyboardEvent): boolean {
	const { target } = event;
	const editing =
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target.closest('input, textarea, select, [role="textbox"], [role="combobox"]') !== null);
	return (
		event.key === "/" &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		!event.isComposing &&
		!event.defaultPrevented &&
		!editing &&
		document.querySelector('dialog[open], [role="dialog"], [role="menu"]') === null
	);
}
