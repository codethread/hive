/* eslint-disable import/max-dependencies -- The workspace composes evidence, graph loading and failure toasts. */
import type { Bee, Board, Provenance, RequestInventory } from "../contracts.ts";
import { BeeActivity, Label, ResourceNotice, outcomeName, time } from "./ui.tsx";
import { EMPTY, loadProvenance, preferences, provenance, snapshot } from "./data.ts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ancestryEnding, beeScene } from "./bee-scene.ts";
import { graphRuntime, loadGraph } from "./graph-loader.ts";
import { useCallback, useEffect, useMemo } from "react";
import type { BeeScene } from "./bee-scene.ts";
import { BeeSearch } from "./board-search.tsx";
import type { GraphProps } from "./graph-loader.ts";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "zustand";

const MAX_VISIBLE_DEPTH = 4;
const INDENT_PX = 16;

export function BeeWorkspace({
	colonyId,
	inventory,
	board,
}: {
	colonyId: string;
	inventory: Extract<RequestInventory, { kind: "loaded" }>;
	board: Board | null;
}) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });

	const ancestryResource = useStore(
		provenance.store,
		(state) => state.entries[`${colonyId}/${search.ancestry}`] ?? EMPTY,
	);
	const ancestry = snapshot(ancestryResource);
	const scene = useMemo(
		() => beeScene(inventory.bees, search.beeQuery, ancestry),
		[inventory.bees, search.beeQuery, ancestry],
	);

	const selected = scene.requests.find((bee) => bee.id === search.request);
	const select = useCallback(
		(request: string) => {
			void navigate({
				search: (current) => {
					const { bead: _bead, ...rest } = current;
					return { ...rest, page: 0, request };
				},
			});
		},
		[navigate],
	);
	return (
		<section aria-label="Bee provenance" className="min-w-0">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
				<fieldset className="flex gap-2" aria-label="Bee presentation">
					{(["outline", "graph"] as const).map((presentation) => (
						<button
							className="button"
							type="button"
							key={presentation}
							aria-pressed={search.presentation === presentation}
							onClick={() => {
								if (presentation === "graph") {
									void loadGraph();
								}
								void navigate({ search: (current) => ({ ...current, presentation }) });
							}}
						>
							{presentation === "outline" ? "Outline" : "Graph"}
						</button>
					))}
				</fieldset>
				<BeeSearch />
				<span className="text-xs text-muted">
					{scene.matches.length} of {inventory.total} requests
					{scene.contextIds.size > 0 && ` · ${scene.contextIds.size} from ancestry`}
				</span>
				<label className="flex min-w-0 items-center gap-2 text-sm text-muted">
					Inspect request
					<select
						className="control min-w-0 max-w-72"
						value={selected?.id ?? ""}
						onChange={(event) => {
							select(event.target.value);
						}}
					>
						<option value="" disabled>
							Select a bee
						</option>
						{scene.requests.map((bee) => (
							<option key={bee.id} value={bee.id}>
								{bee.identity} · {bee.id}
							</option>
						))}
					</select>
				</label>
			</div>
			<div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_380px]">
				<div className="min-w-0">
					<BeeRenderer
						scene={scene}
						selected={search.request}
						onSelect={select}
						presentation={search.presentation}
					/>
					{search.ancestry !== undefined && (
						<div className="border-t border-line p-5 text-xs text-muted">
							<ResourceNotice
								resource={ancestryResource}
								source={`provenance:${colonyId}/${search.ancestry}`}
							/>
							{ancestry && (
								<>
									<p>{ancestryEnding(ancestry.end)}</p>
									<p className="mt-2">Updated {time(ancestry.fetchedAt)}</p>
								</>
							)}
							<button
								className="button mt-3"
								type="button"
								onClick={() => {
									void navigate({
										search: (current) => {
											const {
												ancestry: _ancestry,
												request: _request,
												bead: _bead,
												...rest
											} = current;
											return { ...rest, page: 0 };
										},
									});
								}}
							>
								Clear ancestry
							</button>
						</div>
					)}
				</div>
				<aside
					className="min-w-0 border-t border-line bg-panel p-5 xl:border-t-0 xl:border-l"
					aria-label="Selected bee request"
				>
					{selected ? (
						<RequestSummary
							bee={selected}
							board={board}
							colonyId={colonyId}
							ancestry={ancestry}
							fetching={ancestryResource.kind === "loading"}
						/>
					) : (
						<div className="py-8 text-sm text-muted">
							<h2 className="mb-2 font-medium text-ink">Select a bee request</h2>
						</div>
					)}
				</aside>
			</div>
		</section>
	);
}

// --- Request outline and selected work ---

// Keep the outline visible until the graph is ready.
// eslint-disable-next-line max-statements
function BeeRenderer({
	scene,
	selected,
	onSelect,
	presentation,
}: Omit<GraphProps, "theme"> & { presentation: "outline" | "graph" }) {
	const runtime = useStore(graphRuntime);
	useEffect(() => {
		if (runtime.kind === "failed" && presentation === "graph") {
			toast.error("Graph unavailable", {
				id: "bee-graph",
				description: runtime.message,
				action: {
					label: "Retry graph",
					onClick: () => {
						void loadGraph();
					},
				},
			});
		}
	}, [runtime, presentation]);
	const theme = useStore(preferences, (state) => state.theme);
	if (scene.requests.length === 0) {
		return <p className="p-8 text-sm text-muted">No matching bee requests in this page.</p>;
	}
	if (presentation === "outline") {
		return <BeeOutline scene={scene} selected={selected} onSelect={onSelect} />;
	}
	if (runtime.kind === "ready") {
		return (
			<runtime.Component scene={scene} selected={selected} onSelect={onSelect} theme={theme} />
		);
	}
	return <BeeOutline scene={scene} selected={selected} onSelect={onSelect} />;
}

// A bounded walk keeps cyclic components visible once, alongside rooted branches.
// eslint-disable-next-line max-statements
function BeeOutline({
	scene,
	selected,
	onSelect,
}: {
	scene: BeeScene;
	selected: string | undefined;
	onSelect: (id: string) => void;
}) {
	const children = new Map<string, Bee[]>();
	const childIds = new Set(scene.inferred.map((edge) => edge.child));
	for (const edge of scene.inferred) {
		const child = scene.requests.find((bee) => bee.id === edge.child)!;
		children.set(edge.parent, [...(children.get(edge.parent) ?? []), child]);
	}
	const seen = new Set<string>();
	const rows: { bee: Bee; depth: number }[] = [];
	const visit = (bee: Bee, depth: number): void => {
		if (seen.has(bee.id)) {
			return;
		}
		seen.add(bee.id);
		rows.push({ bee, depth });
		for (const child of children.get(bee.id) ?? []) {
			visit(child, depth + 1);
		}
	};
	for (const bee of scene.requests.filter((item) => !childIds.has(item.id))) {
		visit(bee, 0);
	}
	// Cyclic components have no root; keep every request visible once.
	for (const bee of scene.requests) {
		visit(bee, 0);
	}
	return (
		<ul aria-label="Request outline" className="space-y-2 p-4">
			{rows.map(({ bee, depth }) => (
				<li
					key={bee.id}
					style={{ marginInlineStart: `${Math.min(depth, MAX_VISIBLE_DEPTH) * INDENT_PX}px` }}
					className={depth > 0 ? "border-l border-dashed border-accent pl-3" : ""}
				>
					<button
						type="button"
						data-attention={bee.needsAttention}
						className={`bee-outline-card w-full rounded-lg border p-4 text-left ${
							selected === bee.id ? "border-accent bg-tint" : "border-line bg-panel hover:bg-raised"
						}`}
						aria-pressed={selected === bee.id}
						onClick={() => {
							onSelect(bee.id);
						}}
					>
						<span className="flex flex-wrap items-center justify-between gap-2">
							<span className="font-medium">{bee.identity}</span>
							<span className="text-xs text-muted">
								{bee.kind} · {outcomeName(bee.outcome)}
							</span>
						</span>
						<span className="mt-2 block text-xs text-muted">
							{bee.id} · {bee.taskIds.length} linked {bee.taskIds.length === 1 ? "bead" : "beads"}
							{scene.contextIds.has(bee.id) && " · From ancestry"}
						</span>
						<span className="mt-2 block text-xs text-muted">
							{depth > 0 ? "↳ Inferred parent · " : ""}Requested by {bee.requester ?? "unrecorded"}
						</span>
						<span className="mt-3 block">
							<BeeActivity bee={bee} />
						</span>
						<span className="mt-2 block text-xs text-muted">
							{bee.observation
								? `Last observed ${time(bee.observation.at)}`
								: "No recorded observation"}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function RequestSummary({
	bee,
	board,
	colonyId,
	ancestry,
	fetching,
}: {
	bee: Bee;
	board: Board | null;
	colonyId: string;
	ancestry: Provenance | null;
	fetching: boolean;
}) {
	const search = useSearch({ from: "/colonies/$colonyId" });
	const navigate = useNavigate({ from: "/colonies/$colonyId" });
	return (
		<>
			<p className="font-mono text-xs text-muted">{bee.id}</p>
			<h2 className="mt-3 break-words text-xl font-semibold">{bee.identity}</h2>
			<div className="my-3 flex gap-2">
				<Label>{bee.kind}</Label>
				<Label>{outcomeName(bee.outcome)}</Label>
			</div>
			<p className="text-xs text-muted">
				{bee.harness} · {bee.model}
			</p>
			<h3 className="section-title">Recorded requester</h3>
			<p className="break-words text-sm">{bee.requester ?? "Not recorded"}</p>
			<button
				className="button mt-3 inline-flex items-center gap-2"
				type="button"
				aria-label={search.ancestry === bee.id && ancestry ? "Refresh ancestry" : "Load ancestry"}
				title={search.ancestry === bee.id && ancestry ? "Refresh ancestry" : "Load ancestry"}
				aria-busy={fetching}
				disabled={fetching}
				onClick={() => {
					void loadProvenance(colonyId, bee.id, search.ancestry === bee.id);
					void navigate({ search: (current) => ({ ...current, ancestry: bee.id }) });
				}}
			>
				<RefreshCw
					size={16}
					aria-hidden="true"
					className={fetching ? "refresh-rotating" : undefined}
				/>
				{!(search.ancestry === bee.id && ancestry) && "Load ancestry"}
			</button>
			<div className="mt-4">
				<BeeActivity bee={bee} />
			</div>
			<h3 className="section-title">Last recorded observation</h3>
			{bee.observation ? (
				<>
					<p className="whitespace-pre-wrap break-words text-sm">{bee.observation.text}</p>
					<p className="mt-2 text-xs text-muted">
						{time(bee.observation.at)} · {bee.observation.author}
					</p>
				</>
			) : (
				<p className="text-sm text-muted">No observation recorded.</p>
			)}
			{bee.closedAt !== null && (
				<p className="mt-3 text-xs text-muted">Closed {time(bee.closedAt)}</p>
			)}
			<h3 className="section-title">Linked work · {bee.taskIds.length}</h3>
			<p className="mb-3 text-xs text-muted">
				Native bead filters apply here. Links record requested work, not a current claim.
			</p>
			<ul className="space-y-2">
				{(board?.cards ?? []).map((card) => (
					<li key={card.id}>
						<Link
							from="/colonies/$colonyId"
							to="."
							search={(current) => ({ ...current, bead: card.id })}
							className="block rounded-md border border-line p-3 text-sm hover:border-accent"
						>
							<span className="block font-medium">{card.title}</span>
							<span className="mt-1 block text-xs text-muted">
								{card.id} · {card.status} · P{card.priority}
							</span>
						</Link>
					</li>
				))}
			</ul>
			{board?.cards.length === 0 && (
				<p className="text-sm text-muted">No linked beads match these filters.</p>
			)}
		</>
	);
}
