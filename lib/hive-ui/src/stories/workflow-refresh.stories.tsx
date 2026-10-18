import {
	ActorRetirement as ActorRetirementCase,
	LivePolling as LivePollingCase,
	RefreshRecovery as RefreshRecoveryCase,
	workflowPreviewMeta,
} from "./workflow-preview-cases.tsx";
import type { Meta } from "@storybook/react-vite";
import type { PreviewArgs } from "./workflow-preview-cases.tsx";

const meta = {
	...workflowPreviewMeta,
	title: "Workflow preview/Refresh",
} satisfies Meta<PreviewArgs>;
export default meta;

export const LivePolling = { ...LivePollingCase, name: "Saved progress during simulation" };
export const RefreshRecovery = { ...RefreshRecoveryCase, name: "Refresh recovery" };
export const ActorRetirement = { ...ActorRetirementCase, name: "Retired actor during simulation" };
