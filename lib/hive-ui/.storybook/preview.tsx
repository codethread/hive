/* eslint-disable import/no-unassigned-import -- The workshop uses the production stylesheet. */
import "../src/styles.css";
import {
	StoryEnvironment,
	resetStoryState,
	storyNavigationSchema,
} from "../src/stories/environment.tsx";
import type { Preview } from "@storybook/react-vite";
import { handlers } from "../src/stories/handlers.ts";
import { mswLoader } from "msw-storybook-addon/csf3";
import { setupWorker } from "msw/browser";
import { workshopTheme } from "./theme.ts";
import { z } from "zod";

const preview: Preview = {
	tags: ["autodocs"],
	loaders: [mswLoader(startFixtureWorker)],
	initialGlobals: { theme: "moss", backgrounds: { value: "dark" } },
	globalTypes: {
		theme: {
			description: "Hive palette",
			toolbar: {
				icon: "paintbrush",
				items: [
					{ value: "moss", title: "Moss (dark)" },
					{ value: "paper", title: "Paper (light)" },
				],
				dynamicTitle: true,
			},
		},
	},
	parameters: {
		layout: "fullscreen",
		backgrounds: {
			options: {
				dark: { name: "Dark", value: workshopTheme.appPreviewBg },
			},
		},
		docs: { theme: workshopTheme, story: { inline: false, height: "640px" } },
		controls: { expanded: true },
		options: { storySort: { order: ["Bees", "Beads", "Workspace", "Foundations"] } },
	},
	beforeEach: resetStoryState,
	decorators: [
		(Story, context) => (
			<StoryEnvironment
				key={context.id}
				theme={z.enum(["moss", "paper"]).parse(context.globals["theme"])}
				navigation={storyNavigationSchema.parse(context.parameters["navigation"] ?? {})}
				shell={context.parameters["shell"] === true}
			>
				<Story />
			</StoryEnvironment>
		),
	],
};

export default preview;

// Initial handlers survive MSW's per-story reset, including Autodocs iframe teardown.
async function startFixtureWorker() {
	const worker = setupWorker(...handlers);
	await worker.start({ quiet: true, onUnhandledRequest: "bypass" });
	return worker;
}
