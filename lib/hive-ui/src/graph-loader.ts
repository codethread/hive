import type { BeeScene } from "./bee-scene.ts";
import type { ComponentType } from "react";
import { createStore } from "zustand/vanilla";

export interface GraphProps {
	/** Already loaded evidence; the graph performs no data reads. */
	scene: BeeScene;
	/** URL-owned request selection shared with the outline. */
	selected: string | undefined;
	/** Select a request without changing its recorded data. */
	onSelect: (id: string) => void;
	/** Current palette uses the same CSS tokens as the board. */
	theme: "moss" | "paper";
}
type GraphRuntime =
	| { kind: "idle" | "loading" }
	| { kind: "ready"; Component: ComponentType<GraphProps> }
	| { kind: "failed"; message: string };

export const graphRuntime = createStore<GraphRuntime>(() => ({ kind: "idle" }));

/** Only a route or Graph activation imports the optional visualization package. */
export async function loadGraph(): Promise<void> {
	const { kind } = graphRuntime.getState();
	if (kind === "ready" || kind === "loading") {
		return;
	}
	graphRuntime.setState({ kind: "loading" }, true);
	try {
		const { BeeGraph } = await import("./bee-graph.tsx");
		graphRuntime.setState({ Component: BeeGraph, kind: "ready" }, true);
	} catch (error) {
		graphRuntime.setState({ kind: "failed", message: String(error) }, true);
	}
}
