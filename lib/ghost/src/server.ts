/* eslint-disable unicorn/no-null -- Protocol and persisted revision metadata explicitly encode absent policy, actor and formula name. */
import type {
	AttemptStatus,
	BeesConfig,
	ColonyResponse,
	ColonyStatus,
	PolicyRevision,
	RepositoryEndpoint,
} from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Own daemon directory permissions and socket parent.
import { chmod, mkdir } from "node:fs/promises";
import { colonyRequestSchema, resolveRepository } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Absolute socket and state paths are process boundaries.
import { dirname, isAbsolute } from "node:path";
import { loadPolicy, policySnapshot, policyView, updatePolicy } from "./policy.ts";
import type { ActivePolicy } from "./policy.ts";
import type { ColonyActivity } from "./colony.ts";
import { claimServer } from "./server-ownership.ts";
import { createColony } from "./colony.ts";
import { inspectRepository } from "./inspection.ts";
import { match } from "ts-pattern";
import { openStore } from "./store.ts";
import { waitFor } from "xstate";

const SOCKET_MODE = 0o600;
interface RunningColony {
	/** Explicit repository authority. */
	repository: RepositoryEndpoint;
	/** Whether membership survives daemon exit. */
	registration: "durable" | "temporary";
	/** Parsed effective scheduling policy, exposed to operators. */
	policy: ActivePolicy | null;
	/** Lifecycle actor for this repository. */
	actor: ReturnType<typeof createColony>;
}
interface ServerOptions {
	/** Absolute selected Unix socket. */
	socket: string;
	/** Absolute private SQLite and attempt directory. */
	state: string;
}

/** Bind before serving repository mutations; a second socket owner fails clearly. */
// eslint-disable-next-line max-statements -- The server owns registry, actors and orderly shutdown in one scope.
export async function serve(options: ServerOptions): Promise<void> {
	if (!isAbsolute(options.socket) || !isAbsolute(options.state)) {
		throw new Error("Ghost requires absolute socket and state paths");
	}
	await mkdir(options.state, { mode: 0o700, recursive: true });
	await mkdir(dirname(options.socket), { recursive: true });
	const ownership = await claimServer(options);
	const store = openStore(options.state);
	const colonies = new Map<string, RunningColony>();
	const install = (
		repository: RepositoryEndpoint,
		registration: RunningColony["registration"],
		activity: ColonyActivity,
	) => {
		const actor = createColony({ repository, state: options.state, store }, activity);
		const policy = match(activity)
			.with({ state: "awake" }, ({ config, revisionId }) => ({ config, revisionId }))
			// eslint-disable-next-line unicorn/no-null -- JSON explicitly distinguishes absent effective policy from loaded policy.
			.otherwise(() => null);
		colonies.set(repository.root, { actor, policy, registration, repository });
		actor.start();
	};
	// eslint-disable-next-line max-params -- One activation joins authority, membership, validated policy and audit attribution.
	const activate = (
		repository: RepositoryEndpoint,
		registration: RunningColony["registration"],
		config: BeesConfig,
		source: Pick<PolicyRevision, "source" | "actor" | "formulaName">,
	) => {
		const revision = { ...source, createdAt: new Date().toISOString(), id: crypto.randomUUID() };
		store.activatePolicy(repository.root, revision, policySnapshot(config));
		install(repository, registration, { config, revisionId: revision.id, state: "awake" });
	};
	let pending: Promise<Response | void> = Promise.resolve();
	let closing = false;
	const server = Bun.serve({
		fetch: (request) => {
			// eslint-disable-next-line max-statements, promise/prefer-await-to-then -- Serialize lifecycle commands behind registry restoration and prior drains.
			const response = pending.then(async () => {
				try {
					if (closing) {
						throw new Error("Daemon is stopping");
					}
					if (request.method !== "POST" || new URL(request.url).pathname !== "/") {
						throw new Error("Use POST / for Colony commands");
					}
					const selectedState = request.headers.get("x-colony-state");
					if (selectedState !== null && selectedState !== options.state) {
						throw new Error("Selected state does not match this daemon");
					}
					const command = colonyRequestSchema.parse(await request.json());
					const result = await match(command)
						.with({ kind: "status" }, async (): Promise<ColonyResponse> => ({
							colonies: await Promise.all(
								[...colonies.values()].map(async (colony) =>
									colonyStatus(colony, await store.attempts(colony.repository.root)),
								),
							),
							id: ownership.id,
							kind: "status",
							pid: process.pid,
							socket: options.socket,
							state: options.state,
						}))
						.with({ kind: "inspect" }, async ({ repository }): Promise<ColonyResponse> => {
							const canonical = await resolveRepository(repository.root, repository.beadsDb);
							const current = colonies.get(canonical.root);
							assertAuthority(canonical, current);
							const inspection = await inspectRepository(canonical, store);
							let colony: ColonyStatus | null = null;
							if (current) {
								colony = colonyStatus(
									current,
									inspection.attempts.map(({ id, spawnId, state }) => ({ id, spawnId, state })),
								);
							}
							return { ...inspection, colony };
						})
						.with(
							{ kind: "config" },
							// eslint-disable-next-line max-statements -- Validate and drain before atomically activating a revision; inspection exposes metadata only.
							async ({ repository, command: configCommand }): Promise<ColonyResponse> => {
								const canonical = await resolveRepository(repository.root, repository.beadsDb);
								const current = colonies.get(canonical.root);
								assertAuthority(canonical, current);
								store.assertRepository(canonical);
								if (configCommand.operation === "update" || configCommand.operation === "reset") {
									if (
										!current ||
										current.policy === null ||
										current.actor.getSnapshot().matches("asleep") ||
										current.actor.getSnapshot().matches("failed")
									) {
										throw new Error("Configuration changes require an awake colony");
									}
									const config = await match(configCommand)
										.with({ operation: "reset" }, () => loadPolicy(canonical))
										.with({ operation: "update" }, ({ change }) =>
											updatePolicy(current.policy!.config, change),
										)
										.exhaustive();
									const source = match(configCommand)
										// eslint-disable-next-line unicorn/no-null -- Reset changes the complete canonical baseline, not one formula.
										.with({ operation: "reset" }, ({ actor }) => ({
											actor,
											formulaName: null,
											source: "reset" as const,
										}))
										.with(
											{ change: { kind: "formula" }, operation: "update" },
											({ actor, change }) => ({
												actor,
												formulaName: change.name,
												source: "formula" as const,
											}),
										)
										// eslint-disable-next-line unicorn/no-null -- Limit changes do not name a formula.
										.with({ change: { kind: "limits" }, operation: "update" }, ({ actor }) => ({
											actor,
											formulaName: null,
											source: "limits" as const,
										}))
										.exhaustive();
									await drain(current.actor);
									activate(canonical, current.registration, config, source);
								}
								const active = colonies.get(canonical.root)?.policy;
								// eslint-disable-next-line unicorn/no-null -- Sleeping or removed colonies have no active policy.
								let view: ReturnType<typeof policyView> | null = null;
								if (active) {
									view = policyView(active);
								}
								return {
									active: view,
									history: store.policyHistory(canonical.root),
									kind: "config",
									repository: canonical,
								};
							},
						)
						.with({ kind: "add" }, async ({ repository }): Promise<ColonyResponse> => {
							const canonical = await resolveRepository(repository.root, repository.beadsDb);
							assertAuthority(canonical, colonies.get(canonical.root));
							store.register(canonical);
							const current = colonies.get(canonical.root);
							if (current) {
								current.registration = "durable";
								store.setActivity(
									canonical.root,
									match(current.actor.getSnapshot().value)
										.with("asleep", () => "asleep" as const)
										.otherwise(() => "awake" as const),
								);
							} else {
								install(canonical, "durable", { state: "asleep" });
							}
							return { kind: "registered", repository: canonical };
						})
						// eslint-disable-next-line max-statements -- Wake drains the old actor, persists intent, then installs newly loaded canonical configuration.
						.with({ kind: "wake" }, async ({ repository, temporary }): Promise<ColonyResponse> => {
							const canonical = await resolveRepository(repository.root, repository.beadsDb);
							const current = colonies.get(canonical.root);
							assertAuthority(canonical, current);
							store.assertRepository(canonical);
							if (temporary && current?.registration === "durable") {
								throw new Error("Cannot temporarily wake a durable registration");
							}
							if (current) {
								await drain(current.actor);
							}
							if (!temporary) {
								store.register(canonical);
								store.setActivity(canonical.root, "awake");
							}
							const activity = await loadActivity(canonical);
							const registration = match(temporary)
								.with(true, () => "temporary" as const)
								.otherwise(() => "durable" as const);
							if (activity.state === "failed") {
								store.clearPolicy(canonical.root);
								install(canonical, registration, activity);
								throw new Error(activity.message);
							}
							// eslint-disable-next-line unicorn/no-null -- Canonical files have no inferred actor or changed formula name.
							activate(canonical, registration, activity.config, {
								actor: null,
								formulaName: null,
								source: "canonical",
							});
							return { kind: "awake", repository: canonical };
						})
						.with(
							{ kind: "sleep" },
							{ kind: "remove" },
							// eslint-disable-next-line max-statements -- Both commands drain before applying their distinct membership transitions.
							async ({ kind, repository }): Promise<ColonyResponse> => {
								const canonical = await resolveRepository(repository.root, repository.beadsDb);
								const current = colonies.get(canonical.root);
								assertAuthority(canonical, current);
								store.assertRepository(canonical);
								if (current) {
									await drain(current.actor);
								}
								store.clearPolicy(canonical.root);
								if (kind === "remove") {
									store.remove(canonical.root);
									colonies.delete(canonical.root);
									return {
										attempts: await store.attempts(canonical.root),
										kind: "removed",
										repository: canonical,
									};
								}
								if (current?.registration === "durable") {
									store.setActivity(canonical.root, "asleep");
									// eslint-disable-next-line unicorn/no-null -- Sleeping discards the effective policy exposed in JSON.
									current.policy = null;
								} else {
									colonies.delete(canonical.root);
								}
								return { kind: "slept", repository: canonical };
							},
						)
						.with({ kind: "stop" }, async (): Promise<ColonyResponse> => {
							closing = true;
							await Promise.all([...colonies.values()].map(({ actor }) => drain(actor)));
							store.clearPolicies();
							// eslint-disable-next-line promise/no-nesting -- Close SQLite only after the current response and all accepted commands drain.
							void server.stop().then(() => {
								store.close();
								return ownership.close();
							});
							return { kind: "stopped" };
						})
						.exhaustive();
					return Response.json(result);
				} catch (error) {
					const message = errorMessage(error);
					console.error(message);
					return Response.json({ kind: "error", message });
				}
			});
			pending = response;
			return response;
		},
		unix: options.socket,
	});
	const restore = async () => {
		await ownership.recordSocket();
		store.clearPolicies();
		await Promise.all(
			store.registrations().map(async ({ repository, intent }) => {
				if (intent === "asleep") {
					install(repository, "durable", { state: "asleep" });
				} else {
					const activity = await loadActivity(repository);
					if (activity.state === "failed") {
						install(repository, "durable", activity);
					}
					// eslint-disable-next-line unicorn/no-null -- Recovery loads canonical files without attributing their author.
					else {
						activate(repository, "durable", activity.config, {
							actor: null,
							formulaName: null,
							source: "canonical",
						});
					}
				}
			}),
		);
	};
	pending = restore();
	try {
		await pending;
		await chmod(options.socket, SOCKET_MODE);
	} catch (error) {
		await server.stop(true);
		store.close();
		ownership.close();
		throw error;
	}
	console.error(`Colony listening on ${options.socket} (pid ${process.pid})`);
}

// --- Private functions ---
async function drain(actor: ReturnType<typeof createColony>): Promise<void> {
	actor.send({ type: "STOP" });
	await waitFor(actor, (snapshot) => snapshot.status === "done" || snapshot.matches("failed"));
	if (actor.getSnapshot().matches("failed")) {
		actor.send({ type: "STOP" });
		await waitFor(actor, (snapshot) => snapshot.status === "done");
	}
	actor.stop();
}
async function loadActivity(
	repository: RepositoryEndpoint,
): Promise<{ state: "awake"; config: BeesConfig } | { state: "failed"; message: string }> {
	try {
		const canonical = await resolveRepository(repository.root, repository.beadsDb);
		return {
			config: await loadPolicy(canonical),
			state: "awake",
		};
	} catch (error) {
		const message = errorMessage(error);
		console.error(`Colony ${repository.root} failed: ${message}`);
		return { message, state: "failed" };
	}
}
function assertAuthority(repository: RepositoryEndpoint, current: RunningColony | undefined): void {
	if (current && current.repository.beadsDb !== repository.beadsDb) {
		throw new Error("Repository already uses a different tracker");
	}
}
function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function statusPolicy(active: ActivePolicy | null): ColonyStatus["policy"] {
	if (active === null) {
		return active;
	}
	return { limits: active.config.limits, ranking: active.config.ranking };
}

function colonyStatus(
	{ repository, actor, registration, policy: activePolicy }: RunningColony,
	attempts: AttemptStatus[],
): ColonyStatus {
	const policy = statusPolicy(activePolicy);
	const snapshot = actor.getSnapshot();
	if (snapshot.matches("failed")) {
		return {
			attempts,
			intent: "awake",
			message: snapshot.context.message,
			policy,
			registration,
			repository,
			state: "failed",
		};
	}
	let state: "asleep" | "awake" = "awake";
	if (snapshot.matches("asleep")) {
		state = "asleep";
	}
	return { attempts, intent: state, policy, registration, repository, state };
}
