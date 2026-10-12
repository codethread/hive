import type { BoardScope, Navigation } from "../contracts.ts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

export function BoardTabs() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	return (
		<nav className="board-tabs" aria-label="Work board sections">
			{(["beads", "bees"] as const).map((section) => {
				const selected = section === "beads" ? search.view === "beads" : search.view !== "beads";
				return (
					<Link
						key={section}
						from="/colonies/$colonyId"
						to="/colonies/$colonyId"
						className="board-tab"
						aria-current={selected ? "page" : undefined}
						search={(current) =>
							selected ? current : changeScope(current, section === "beads" ? "beads" : "open")
						}
					>
						{section === "beads" ? "Beads" : "Bees"}
					</Link>
				);
			})}
		</nav>
	);
}

export function BeeHistory() {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	return (
		<fieldset className="flex rounded-md border border-line p-0.5" aria-label="Bee requests">
			{(["open", "completed"] as const).map((view) => (
				<button
					key={view}
					type="button"
					className="theme-button"
					aria-pressed={search.view === view}
					onClick={() => {
						void navigate({ search: (current) => changeScope(current, view) });
					}}
				>
					{view === "open" ? "Open" : "Completed"}
				</button>
			))}
		</fieldset>
	);
}

/** Switching sections changes navigation without changing the active bead view. */
function changeScope(current: Navigation, view: BoardScope["view"]): Navigation {
	const {
		ancestry: _ancestry,
		bead: _bead,
		outline: _outline,
		request: _request,
		...rest
	} = current;
	return { ...rest, page: 0, requestPage: 0, view };
}
