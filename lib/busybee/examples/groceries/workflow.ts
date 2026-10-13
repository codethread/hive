import { assign, setup } from "xstate";
import { z } from "zod";

const ONE = 1;
const ZERO = 0;
const mealInput = z.object({ meals: z.number().int().positive() });

const logic = setup({
	actions: {
		// The calendar observation arrives through choice --data.
		busy: assign({
			busyWeek: true,
			plannedMeals: ({ event }) => mealInput.parse(event.data).meals,
		}),
		flexible: assign({
			busyWeek: false,
			plannedMeals: ({ event }) => mealInput.parse(event.data).meals,
		}),
		substitute: assign({ substitutions: ({ context }) => context.substitutions + ONE }),
	},
	guards: { hasMeals: ({ context }) => context.plannedMeals > ZERO },
});

export const machine = logic.createMachine({
	context: {
		busyWeek: false,
		plannedMeals: 0,
		substitutions: 0,
	},
	id: "groceries",
	initial: "planning",
	states: {
		budget: {
			initial: "check",
			states: {
				check: {
					meta: {
						title: "Check the grocery budget",
						commands: {
							"over-budget": "CHOICE.over-budget",
							"within-budget": "CHOICE.within-budget",
						},
						task: () => ({
							instructions:
								"Estimate the basket total using the selected shops and quantities. " +
								"Compare with the household budget. Ask for the budget if it is " +
								"unknown; do not invent one.",
						}),
					},
					on: {
						"CHOICE.over-budget": "trim",
						"CHOICE.within-budget": "#groceries.outputs",
					},
				},
				trim: {
					meta: {
						title: "Revise the basket",
						commands: { next: "NEXT" },
						task: () => ({
							instructions:
								"Reduce cost using seasonal alternatives, shared ingredients or " +
								"existing pantry stock. Preserve the meal count and dietary " +
								"requirements. Record the revised recipe choices.",
						}),
					},
					on: {
						NEXT: "#groceries.dietary",
					},
				},
			},
		},
		dietary: {
			initial: "check",
			states: {
				check: {
					meta: {
						title: "Check dietary requirements",
						commands: { incompatible: "CHOICE.incompatible", safe: "CHOICE.safe" },
						task: () => ({
							instructions:
								"Check the chosen recipes against the household dietary requirements " +
								"and allergies. Inspect substitutions too. Resolve missing " +
								"requirements with the user before choosing safe.",
						}),
					},
					on: {
						"CHOICE.incompatible": "#groceries.recipes.replace",
						"CHOICE.safe": "#groceries.pantry",
					},
				},
			},
		},
		done: {
			meta: {
				title: "Meal planning complete",
				task: () => ({
					instructions:
						"The dated meal plan and grocery list are ready, with pantry " +
						"deductions and fallback choices recorded. Finish this workflow bead.",
				}),
			},
			type: "final",
		},
		outputs: {
			initial: "meal_plan",
			states: {
				confirm: {
					meta: {
						title: "Check the two outputs together",
						commands: { done: "CHOICE.done", revise: "CHOICE.revise" },
						task: () => ({
							instructions:
								"Verify that every planned meal has ingredients covered by pantry " +
								"stock or the shopping list, quantities match servings, and the plan " +
								"fits calendar, diet and budget. Choose revise if anything changed.",
						}),
					},
					on: {
						"CHOICE.done": {
							guard: "hasMeals",
							target: "#groceries.done",
						},
						"CHOICE.revise": "#groceries.planning",
					},
				},
				grocery_list: {
					meta: {
						title: "Write the final shopping list",
						commands: { next: "NEXT" },
						task: () => ({
							instructions:
								"Produce one consolidated shopping list grouped by shop and aisle, " +
								"with quantities and agreed substitutes. Include the estimated cost. " +
								"If nothing is needed, explicitly say so. This workflow does not " +
								"place an order.",
						}),
					},
					on: {
						NEXT: "confirm",
					},
				},
				meal_plan: {
					meta: {
						title: "Write the meal plan",
						commands: { next: "NEXT" },
						task: () => ({
							instructions:
								"Produce a dated meal plan with recipe links, servings, prep time and " +
								"leftovers. Align late evenings and guest meals with the calendar. " +
								"Include the agreed recipe fallbacks.",
						}),
					},
					on: {
						NEXT: "grocery_list",
					},
				},
			},
		},
		pantry: {
			initial: "count",
			states: {
				count: {
					meta: {
						title: "Check the pantry",
						commands: { next: "NEXT" },
						task: () => ({
							instructions:
								"Check fridge, freezer and cupboard stock against the recipes. Record " +
								"usable quantities and expiry dates. Subtract usable stock; do not " +
								"assume a staple is available.",
						}),
					},
					on: {
						NEXT: "#groceries.shopping",
					},
				},
			},
		},
		planning: {
			initial: "calendar",
			states: {
				calendar: {
					meta: {
						title: "Read the week ahead",
						commands: { busy: "CHOICE.busy", flexible: "CHOICE.flexible" },
						task: () => ({
							instructions:
								"Check the calendar for meals at home, late evenings, guests and " +
								"travel. Record the dates and number of servings. Choose busy for " +
								"limited cooking time or flexible when there is time to cook. " +
								"Discover the payload contract and supply the actual meal count.",
						}),
					},
					on: {
						"CHOICE.busy": {
							actions: "busy",
							target: "#groceries.recipes.quick",
						},
						"CHOICE.flexible": {
							actions: "flexible",
							target: "#groceries.recipes.seasonal",
						},
					},
				},
			},
		},
		recipes: {
			initial: "quick",
			states: {
				quick: {
					meta: {
						title: "Choose quick recipes",
						commands: { next: "NEXT" },
						task: () => ({
							instructions:
								"Read the saved recipes. Select quick dinners and one batch recipe " +
								"that fit the busy evenings. Reuse ingredients and schedule " +
								"leftovers. Record recipe links and servings.",
						}),
					},
					on: {
						NEXT: "#groceries.dietary",
					},
				},
				replace: {
					meta: {
						title: "Find a recipe fallback",
						commands: { next: "NEXT" },
						task: () => ({
							instructions:
								"Replace the recipe that conflicts with diet, budget or availability. " +
								"Prefer a saved recipe sharing ingredients already planned. Keep the " +
								"calendar and servings fixed unless the user asks otherwise.",
						}),
					},
					on: {
						NEXT: "#groceries.dietary",
					},
				},
				seasonal: {
					meta: {
						title: "Choose the weekly recipes",
						commands: { next: "NEXT" },
						task: () => ({
							instructions:
								"Read the saved recipes and choose a varied set of meals for the " +
								"calendar. Include preparation time, servings, guest meals and " +
								"leftovers. Record recipe links.",
						}),
					},
					on: {
						NEXT: "#groceries.dietary",
					},
				},
			},
		},
		shopping: {
			initial: "build",
			states: {
				availability: {
					meta: {
						title: "Check grocery availability",
						commands: {
							available: "CHOICE.available",
							replan: "CHOICE.replan",
							unavailable: "CHOICE.unavailable",
						},
						task: () => ({
							instructions:
								"Check availability of the remaining items at the preferred shop. " +
								"Choose available if all required items can be obtained, including " +
								"the case where the pantry already covers everything.",
						}),
					},
					on: {
						"CHOICE.available": "#groceries.budget",
						"CHOICE.replan": "#groceries.planning",
						"CHOICE.unavailable": "fallback",
					},
				},
				build: {
					meta: {
						title: "Build the candidate grocery list",
						commands: { next: "NEXT", replan: "CHOICE.replan" },
						task: () => ({
							instructions:
								"Scale recipe ingredients to servings, combine duplicates, normalize " +
								"compatible units and subtract pantry quantities. Group the remaining " +
								"items by shop section. Keep recipe links for substitutions.",
						}),
					},
					on: {
						"CHOICE.replan": "#groceries.planning",
						NEXT: "availability",
					},
				},
				fallback: {
					meta: {
						title: "Choose an unavailable-item fallback",
						commands: {
							"change-recipe": "CHOICE.change-recipe",
							"other-store": "CHOICE.other-store",
							replan: "CHOICE.replan",
							substitute: "CHOICE.substitute",
						},
						task: () => ({
							instructions:
								"For each unavailable item, compare a dietary-safe ingredient " +
								"substitute, another shop, or a replacement recipe. Record the choice " +
								"and quantities. Do not silently drop a meal.",
						}),
					},
					on: {
						"CHOICE.change-recipe": "#groceries.recipes.replace",
						"CHOICE.other-store": "other_store",
						"CHOICE.replan": "#groceries.planning",
						"CHOICE.substitute": {
							actions: "substitute",
							target: "availability",
						},
					},
				},
				other_store: {
					meta: {
						title: "Check another grocery shop",
						commands: { next: "NEXT", replan: "CHOICE.replan" },
						task: () => ({
							instructions:
								"Check the missing items at another suitable shop and record the " +
								"source and price. Recheck the consolidated list after changing " +
								"shops.",
						}),
					},
					on: {
						"CHOICE.replan": "#groceries.planning",
						NEXT: "availability",
					},
				},
			},
		},
	},
});

export const inputSchema = z.object({});
export const commandSchemas = {
	available: z.object({}),
	busy: mealInput,
	"change-recipe": z.object({}),
	done: z.object({}),
	flexible: mealInput,
	incompatible: z.object({}),
	next: z.object({}),
	"other-store": z.object({}),
	"over-budget": z.object({}),
	replan: z.object({}),
	revise: z.object({}),
	safe: z.object({}),
	substitute: z.object({}),
	unavailable: z.object({}),
	"within-budget": z.object({}),
};
export function runBrief() {
	return {
		description:
			"Prepare a meal plan and grocery list from the calendar, recipes, dietary needs, pantry and budget.",
		title: "Plan weekly groceries",
	};
}
