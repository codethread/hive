/* eslint-disable sort-keys -- TanStack infers loader dependencies in declaration order: validateSearch, loaderDeps, loader. */
import { Shell, Welcome, WorkPage } from "./work-page.tsx";
import { boardFilterSchema, navigationSchema, requestScopeSchema } from "../contracts.ts";
import { colonies, loadBoard, loadColonies, loadDetail, rememberView, snapshot } from "./data.ts";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";

const rootRoute = createRootRoute({ component: Shell, loader: loadColonies });
const indexRoute = createRoute({
	beforeLoad: async () => {
		await loadColonies();
		const first = snapshot(colonies.store.getState().entries["colonies"] ?? { kind: "empty" })
			?.colonies[0];
		if (first) {
			// eslint-disable-next-line typescript/only-throw-error -- TanStack Router redirects are thrown response objects.
			throw redirect({
				params: { colonyId: first.id },
				search: navigationSchema.parse({}),
				to: "/colonies/$colonyId",
			});
		}
	},
	component: Welcome,
	getParentRoute: () => rootRoute,
	path: "/",
});
const boardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/colonies/$colonyId",
	validateSearch: (search) => navigationSchema.parse(search),
	loaderDeps: ({ search }) => search,
	loader: async ({ params, deps }) => {
		rememberView(params.colonyId, deps);
		await Promise.all([
			loadBoard(params.colonyId, boardFilterSchema.parse(deps)),
			...(deps.bead === undefined
				? []
				: [loadDetail(params.colonyId, deps.bead, { scope: requestScopeSchema.parse(deps) })]),
		]);
	},
	component: WorkPage,
});

export const router = createRouter({
	defaultErrorComponent: ({ error }) => (
		<p className="p-6 text-alert" role="alert">
			{String(error)}
		</p>
	),
	defaultPendingComponent: () => (
		<output className="p-6 text-muted">Reading selected colony…</output>
	),
	defaultPreload: false,
	routeTree: rootRoute.addChildren([indexRoute, boardRoute]),
});

declare module "@tanstack/react-router" {
	interface Register {
		/** One typed URL navigation contract for the app. */
		router: typeof router;
	}
}
