import type { WorkflowPreview } from "../contracts.ts";
import type { createInspector } from "@statelyai/sdk/inspect";

const LAST_PATH_SEGMENT = -1;
type Inspector = Pick<ReturnType<typeof createInspector>, "actor" | "snapshot" | "stop">;
type Actor = WorkflowPreview["actors"][number];
interface PublishedActor {
	/** Generic identity for this registration, never a saved actor path. */
	id: string;
	/** Serialized structure determines when the SDK needs a fresh registration. */
	machine: string;
	/** Generic parent identity; the root has no parent. */
	parent: string | null;
}

export function createWorkflowPublisher(inspector: Inspector, selectRoot: (id: string) => void) {
	const registered = new Map<string, PublishedActor>();
	// The SDK cannot replace or revive manual registrations, so each lifetime needs a fresh ID.
	let sequence = 0;
	// eslint-disable-next-line max-statements -- One registration owns identity, machine and parent together.
	const publishActor = (actor: Actor) => {
		const path = JSON.stringify(actor.path);
		const machine = JSON.stringify(actor.machine);
		let parent: string | null = null;
		if (actor.path.length > 0) {
			parent = registered.get(JSON.stringify(actor.path.slice(0, LAST_PATH_SEGMENT)))!.id;
		}
		const previous = registered.get(path);
		if (previous?.machine === machine && previous.parent === parent) {
			inspector.snapshot(previous.id, actor.snapshot);
		} else {
			if (previous) {
				inspector.stop(previous.id);
			}
			const id = `actor-${sequence++}`;
			const options = { machine: actor.machine, snapshot: actor.snapshot };
			if (parent === null) {
				inspector.actor(id, options);
				selectRoot(id);
			} else {
				inspector.actor(id, { ...options, parent });
			}
			registered.set(path, { id, machine, parent });
		}
	};
	return (actors: WorkflowPreview["actors"]): void => {
		const paths = new Set(actors.map((actor) => JSON.stringify(actor.path)));
		for (const [path, actor] of registered) {
			if (!paths.has(path)) {
				inspector.stop(actor.id);
				registered.delete(path);
			}
		}
		for (const actor of actors) {
			publishActor(actor);
		}
	};
}
