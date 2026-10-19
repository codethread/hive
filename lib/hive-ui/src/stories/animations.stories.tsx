import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../primitives.tsx";
import { RefreshCw } from "lucide-react";

const meta = {
	title: "Foundations/Animations",
	render: () => (
		<section className="mx-auto max-w-3xl space-y-8 p-8" aria-label="Animations">
			<header className="space-y-2">
				<h1 className="text-2xl font-medium">Animations</h1>
				<p className="text-sm text-muted">Shared motion classes used by production components.</p>
			</header>
			<article className="space-y-5 rounded-lg border border-line bg-panel p-6">
				<div className="flex items-center justify-between gap-6">
					<div className="space-y-2">
						<h2 className="font-medium">Refresh rotation</h2>
						<code className="text-xs text-accent">refresh-rotating</code>
					</div>
					<RefreshCw className="refresh-rotating size-6 text-muted" aria-hidden="true" />
				</div>
				<p className="text-sm text-muted">
					One turn every 2 seconds at a constant speed while fetching.
				</p>
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon" aria-label="Fetching example" aria-busy disabled>
						<RefreshCw className="refresh-rotating" aria-hidden="true" />
					</Button>
					<span className="text-xs text-muted">The same motion on refresh controls.</span>
				</div>
				<p className="text-xs text-muted">
					Rotation continues even when the system&apos;s reduced-motion setting is enabled.
				</p>
			</article>
			<article className="space-y-4 rounded-lg border border-line bg-panel p-6">
				<h2 className="font-medium">Interaction colors</h2>
				<code className="text-xs text-accent">transition-colors</code>
				<div>
					<Button variant="outline">Hover or focus</Button>
				</div>
				<p className="text-sm text-muted">
					Buttons, badges and tabs use the same color transition.
				</p>
			</article>
		</section>
	),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const All: Story = {};
