import type { WorkflowLifecycle } from "../contracts.ts";

/** Native workflow disposition remains visible independently of the saved chart. */
export function WorkflowLifecycleBanner({
	inspection,
	colony,
}: {
	inspection: WorkflowLifecycle;
	colony: string;
}) {
	const { lifecycle, resolution, publication } = inspection;
	let outcome = "Pending";
	if (lifecycle.kind === "unavailable") {
		outcome = "Unclassified closure";
	} else if (lifecycle.kind === "terminal") {
		outcome = { succeeded: "Succeeded", failed: "Failed", cancelled: "Cancelled" }[
			lifecycle.fact.outcome
		];
	}
	return (
		<section aria-label="Workflow lifecycle" className="workflow-lifecycle">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
				<strong>Workflow: {outcome}</strong>
				<span className="text-muted">Native task: {inspection.nativeStatus}</span>
				{lifecycle.kind === "terminal" && <time>{lifecycle.closedAt}</time>}
			</div>
			{lifecycle.kind === "terminal" && <p>{lifecycle.fact.reason}</p>}
			{lifecycle.kind === "unavailable" && (
				<p>The native closure has no recognized workflow outcome.</p>
			)}
			{resolution.kind === "unresolved" && <p>Follow-up: unresolved.</p>}
			{resolution.kind === "resolved" && <p>Follow-up: resolved.</p>}
			{resolution.kind === "acknowledged" && (
				<p>
					Follow-up acknowledged by {resolution.actor} at {resolution.acknowledgedAt}.{" "}
					{resolution.reason}
				</p>
			)}
			{resolution.kind === "superseded" && (
				<p>
					Replaced by{" "}
					{resolution.replacementIds.map((id) => (
						<a
							key={id}
							href={`/colonies/${encodeURIComponent(colony)}?bead=${encodeURIComponent(id)}`}
							className="mr-2 underline"
						>
							{id}
						</a>
					))}
				</p>
			)}
			{(publication.locked || publication.settlement === "pending") && (
				<p className="text-alert">
					Publication:{" "}
					{publication.settlement === "pending" ? "settlement pending" : "lock retained"}.
				</p>
			)}
		</section>
	);
}
