import { expect, test } from "bun:test";
import { generateChangelogs } from "./release-changelog.ts";

test("every public tool gets an explicit empty release when the range has no declarations #test-485", () => {
	expect(generateChangelogs("0.7.0", [])).toMatchInlineSnapshot(`
	  [
	    {
	      "file": "lib/beeswax/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/honeycomb/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/busybee/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/colony/bee-changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/colony/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/qlock/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/hive-ui/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/waggle/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	    {
	      "file": "lib/scent/changelog.json",
	      "release": {
	        "changes": [],
	        "version": "0.7.0",
	      },
	    },
	  ]
	`);
});
