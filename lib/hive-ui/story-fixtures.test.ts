import { expect, test } from "bun:test";
import { fixtureOutline } from "./src/stories/fixtures.ts";

test.each([
	["hv-ui", ["hv-ui", "hv-ui.1", "hv-ui.2", "hv-ui.3", "hv-ui.4"]],
	["hv-ui.1", ["hv-ui.1"]],
	["hv-rails", ["hv-rails", "hv-rails.1", "hv-rails.2"]],
])("outline fixture for %s contains only its descendants", (id, ids) => {
	expect(fixtureOutline(id).nodes.map((node) => node.id)).toEqual(ids);
});
