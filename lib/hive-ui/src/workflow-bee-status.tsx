import {
	Activity,
	CircleCheck,
	CircleDashed,
	CircleHelp,
	CircleSlash,
	CircleX,
	Moon,
	TriangleAlert,
} from "lucide-react";

const presentations = {
	pending: {
		label: "Pending",
		Icon: CircleDashed,
		title: "Request pending; no output has been observed for the current attempt.",
	},
	active: {
		label: "Active",
		Icon: Activity,
		title:
			"Request pending; output observed less than two minutes ago. " +
			"This does not establish task progress or process health.",
	},
	quiet: {
		label: "Quiet",
		Icon: Moon,
		title: "Request pending; no output observed in the last two minutes.",
	},
	attention: {
		label: "Investigate",
		Icon: TriangleAlert,
		title: "Request pending; at least ten minutes without observed output.",
	},
	unknown: {
		label: "Unknown",
		Icon: CircleHelp,
		title: "No request status is available.",
	},
	succeeded: {
		label: "Succeeded",
		Icon: CircleCheck,
		title: "The request completed successfully; work acceptance is separate.",
	},
	failed: {
		label: "Failed",
		Icon: CircleX,
		title: "The request ended unsuccessfully.",
	},
	cancelled: {
		label: "Cancelled",
		Icon: CircleSlash,
		title: "The request was cancelled.",
	},
};

export type WorkflowBeeStatus =
	| "pending"
	| "active"
	| "quiet"
	| "attention"
	| "unknown"
	| "succeeded"
	| "failed"
	| "cancelled";

export function WorkflowBeeStatusBadge({ status }: { status: WorkflowBeeStatus }) {
	const { label, Icon, title } = presentations[status];
	return (
		<span className="explorer-bee-status" data-bee-status={status} title={title}>
			<Icon aria-hidden="true" />
			{label}
		</span>
	);
}
