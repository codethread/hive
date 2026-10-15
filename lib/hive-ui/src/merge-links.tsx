import { GitMerge, GitPullRequestClosed, TriangleAlert } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { MergeLink } from "../contracts.ts";

const LINK_CLASS =
	"inline-flex size-7 shrink-0 items-center justify-center rounded hover:bg-accent/10 " +
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const PRESENTATION = {
	active: { icon: GitMerge, color: "text-accent" },
	merged: { icon: GitMerge, color: "text-merged" },
	abandoned: { icon: GitPullRequestClosed, color: "text-muted" },
};

/** Open valid requests at the provider and malformed records in the bead inspector. */
export function MergeLinks({ merges }: { merges: MergeLink[] }) {
	return merges.map((merge) => {
		if (merge.kind === "invalid") {
			const label = `Malformed merge bead: ${merge.title} (${merge.id}) · ${merge.problem}`;
			return (
				<Link
					key={merge.id}
					from="/colonies/$colonyId"
					to="."
					search={(current) => ({ ...current, bead: merge.id })}
					title={label}
					aria-label={label}
					className={`${LINK_CLASS} text-alert`}
				>
					<TriangleAlert size={16} aria-hidden="true" />
				</Link>
			);
		}
		const label = `${merge.title} · ${merge.resolution} · ${merge.branch}`;
		const { icon: Icon, color } = PRESENTATION[merge.resolution];
		return (
			<a
				key={merge.id}
				href={merge.url}
				target="_blank"
				rel="noreferrer"
				title={label}
				aria-label={`Open merge request: ${label}`}
				className={`${LINK_CLASS} ${color}`}
			>
				<Icon size={16} aria-hidden="true" />
			</a>
		);
	});
}
