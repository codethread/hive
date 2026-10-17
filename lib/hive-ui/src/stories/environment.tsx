/* eslint-disable import/max-dependencies -- The workshop wires the production router and resource boundaries once. */
import { COLONY_ID, OBSERVED_AT } from "./fixtures.ts";
import {
	Outlet,
	RouterProvider,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	defaultStringifySearch,
	redirect,
} from "@tanstack/react-router";
import {
	annotations,
	boards,
	colonies,
	details,
	hierarchies,
	inventories,
	loadColonies,
	loadView,
	outlines,
	preferences,
	provenance,
	workflows,
} from "../data.ts";
import { createContext, useContext, useEffect, useState } from "react";
import { ActivityClock } from "../activity-clock.tsx";
import type { Navigation } from "../../contracts.ts";
import type { ReactNode } from "react";
import { Shell } from "../work-page.tsx";
import { columnOrders } from "../column-settings.tsx";
import { loadGraph } from "../graph-loader.ts";
import { navigationSchema } from "../../contracts.ts";
import { savedViews } from "../saved-views.ts";

export const storyNavigationSchema = navigationSchema.extend({
	view: navigationSchema.shape.view.default("beads"),
});

const STORY_NOW = Date.parse(OBSERVED_AT);
const StoryContent = createContext<ReactNode>(null);

export function StoryEnvironment({
	children,
	theme,
	navigation,
	shell,
}: {
	children: ReactNode;
	theme: "moss" | "paper";
	navigation: Partial<Navigation> | undefined;
	shell: boolean;
}) {
	// eslint-disable-next-line react/hook-use-state -- Each story owns one router for its mounted lifetime.
	const [router] = useState(() => storyRouter(navigation, shell));
	useEffect(() => {
		preferences.setState({ theme });
		document.documentElement.dataset["theme"] = theme;
	}, [theme]);
	return (
		<div data-theme={theme} className="min-h-screen bg-canvas text-ink">
			<ActivityClock.Provider value={STORY_NOW}>
				<StoryContent.Provider value={children}>
					<RouterProvider router={router} />
				</StoryContent.Provider>
			</ActivityClock.Provider>
		</div>
	);
}

// eslint-disable-next-line max-statements -- Reset each independent production store before a story starts.
export function resetStoryState(): void {
	boards.store.setState({ entries: {} });
	annotations.store.setState({ entries: {} });
	colonies.store.setState({ entries: {} });
	details.store.setState({ entries: {} });
	hierarchies.store.setState({ entries: {} });
	inventories.store.setState({ entries: {} });
	outlines.store.setState({ entries: {} });
	workflows.store.setState({ entries: {} });
	provenance.store.setState({ entries: {} });
	preferences.setState({
		showWorkflowBeads: false,
		outlineClosed: false,
		sidebarCollapsed: true,
		views: {},
	});
	columnOrders.store.setState({ byColony: {}, error: "" });
	localStorage.removeItem("hive-ui.column-order");
	savedViews.setState({ active: {}, byColony: {}, notice: { kind: "none" } });
	localStorage.removeItem("hive-ui.saved-views");
}

function StoryRoute() {
	return useContext(StoryContent);
}

function storyRouter(navigation: Partial<Navigation> | undefined, shell: boolean) {
	const initial = navigationSchema.parse({ view: "beads", ...navigation });
	let initialLoad = true;
	const root = createRootRoute({ component: shell ? Shell : Outlet, loader: loadColonies });
	const route = createRoute({
		getParentRoute: () => root,
		path: "/colonies/$colonyId",
		validateSearch: (search) => navigationSchema.parse(search),
		beforeLoad: async ({ search }) => {
			if (search.presentation === "graph") {
				await loadGraph();
			}
		},
		loaderDeps: ({ search }) => {
			const { presentation: _presentation, beeQuery: _beeQuery, ...data } = search;
			return data;
		},
		loader: async ({ deps }) => {
			await loadView(COLONY_ID, navigationSchema.parse(deps), initialLoad);
			initialLoad = false;
		},
		component: StoryRoute,
	});
	const index = createRoute({
		getParentRoute: () => root,
		path: "/",
		beforeLoad: () => {
			// eslint-disable-next-line typescript/only-throw-error -- TanStack redirects are thrown response objects.
			throw redirect({
				to: "/colonies/$colonyId",
				params: { colonyId: COLONY_ID },
				search: initial,
			});
		},
	});
	return createRouter({
		routeTree: root.addChildren([index, route]),
		history: createMemoryHistory({
			initialEntries: [`/colonies/${COLONY_ID}${defaultStringifySearch(initial)}`],
		}),
		defaultPendingComponent: () => <output className="block p-6">Loading story fixtures…</output>,
		defaultErrorComponent: ({ error }) => <p role="alert">{String(error)}</p>,
	});
}
