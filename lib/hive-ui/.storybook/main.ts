import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
	framework: "@storybook/react-vite",
	core: { allowedHosts: ["localhost"] },
	stories: ["../src/stories/**/*.stories.tsx"],
	addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "msw-storybook-addon"],
	staticDirs: ["./public"],
	viteFinal(viteConfig) {
		return mergeConfig(viteConfig, { plugins: [tailwindcss()] });
	},
};

// Storybook loads its configuration through a default export.
export default config;
