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

type Chart = Parameters<typeof logic.createMachine>[typeof ZERO];
type Node = NonNullable<Chart["states"]>[string];
function step(title: string, instructions: string, transitions: { on: NonNullable<Node["on"]> }) {
	return {
		meta: {
			commands: Object.fromEntries(
				Object.keys(transitions.on).map((event) => [commandName(event), event]),
			),
			instructions,
			title,
		},
		...transitions,
	};
}

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
				check: step(
					"Check the grocery budget",
					"Estimate the basket total using the selected shops and quantities. Compare with the household budget. Ask for the budget if it is unknown; do not invent one.",
					{
						on: {
							"CHOICE.over-budget": "trim",
							"CHOICE.within-budget": "#groceries.outputs",
						},
					},
				),
				trim: step(
					"Revise the basket",
					"Reduce cost using seasonal alternatives, shared ingredients or existing pantry stock. Preserve the meal count and dietary requirements. Record the revised recipe choices.",
					{
						on: {
							NEXT: "#groceries.dietary",
						},
					},
				),
			},
		},
		dietary: {
			initial: "check",
			states: {
				check: step(
					"Check dietary requirements",
					"Check the chosen recipes against the household dietary requirements and allergies. Inspect substitutions too. Resolve missing requirements with the user before choosing safe.",
					{
						on: {
							"CHOICE.incompatible": "#groceries.recipes.replace",
							"CHOICE.safe": "#groceries.pantry",
						},
					},
				),
			},
		},
		done: {
			meta: {
				instructions:
					"The dated meal plan and grocery list are ready, with pantry deductions and fallback choices recorded. Finish this workflow bead.",
				title: "Meal planning complete",
			},
			type: "final",
		},
		outputs: {
			initial: "meal_plan",
			states: {
				confirm: step(
					"Check the two outputs together",
					"Verify that every planned meal has ingredients covered by pantry stock or the shopping list, quantities match servings, and the plan fits calendar, diet and budget. Choose revise if anything changed.",
					{
						on: {
							"CHOICE.done": {
								guard: "hasMeals",
								target: "#groceries.done",
							},
							"CHOICE.revise": "#groceries.planning",
						},
					},
				),
				grocery_list: step(
					"Write the final shopping list",
					"Produce one consolidated shopping list grouped by shop and aisle, with quantities and agreed substitutes. Include the estimated cost. If nothing is needed, explicitly say so. This workflow does not place an order.",
					{
						on: {
							NEXT: "confirm",
						},
					},
				),
				meal_plan: step(
					"Write the meal plan",
					"Produce a dated meal plan with recipe links, servings, prep time and leftovers. Align late evenings and guest meals with the calendar. Include the agreed recipe fallbacks.",
					{
						on: {
							NEXT: "grocery_list",
						},
					},
				),
			},
		},
		pantry: {
			initial: "count",
			states: {
				count: step(
					"Check the pantry",
					"Check fridge, freezer and cupboard stock against the recipes. Record usable quantities and expiry dates. Subtract usable stock; do not assume a staple is available.",
					{
						on: {
							NEXT: "#groceries.shopping",
						},
					},
				),
			},
		},
		planning: {
			initial: "calendar",
			states: {
				calendar: step(
					"Read the week ahead",
					"Check the calendar for meals at home, late evenings, guests and travel. Record the dates and number of servings. Choose busy for limited cooking time or flexible when there is time to cook. Discover the payload contract and supply the actual meal count.",
					{
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
				),
			},
		},
		recipes: {
			initial: "quick",
			states: {
				quick: step(
					"Choose quick recipes",
					"Read the saved recipes. Select quick dinners and one batch recipe that fit the busy evenings. Reuse ingredients and schedule leftovers. Record recipe links and servings.",
					{
						on: {
							NEXT: "#groceries.dietary",
						},
					},
				),
				replace: step(
					"Find a recipe fallback",
					"Replace the recipe that conflicts with diet, budget or availability. Prefer a saved recipe sharing ingredients already planned. Keep the calendar and servings fixed unless the user asks otherwise.",
					{
						on: {
							NEXT: "#groceries.dietary",
						},
					},
				),
				seasonal: step(
					"Choose the weekly recipes",
					"Read the saved recipes and choose a varied set of meals for the calendar. Include preparation time, servings, guest meals and leftovers. Record recipe links.",
					{
						on: {
							NEXT: "#groceries.dietary",
						},
					},
				),
			},
		},
		shopping: {
			initial: "build",
			states: {
				availability: step(
					"Check grocery availability",
					"Check availability of the remaining items at the preferred shop. Choose available if all required items can be obtained, including the case where the pantry already covers everything.",
					{
						on: {
							"CHOICE.available": "#groceries.budget",
							"CHOICE.replan": "#groceries.planning",
							"CHOICE.unavailable": "fallback",
						},
					},
				),
				build: step(
					"Build the candidate grocery list",
					"Scale recipe ingredients to servings, combine duplicates, normalize compatible units and subtract pantry quantities. Group the remaining items by shop section. Keep recipe links for substitutions.",
					{
						on: {
							"CHOICE.replan": "#groceries.planning",
							NEXT: "availability",
						},
					},
				),
				fallback: step(
					"Choose an unavailable-item fallback",
					"For each unavailable item, compare a dietary-safe ingredient substitute, another shop, or a replacement recipe. Record the choice and quantities. Do not silently drop a meal.",
					{
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
				),
				other_store: step(
					"Check another grocery shop",
					"Check the missing items at another suitable shop and record the source and price. Recheck the consolidated list after changing shops.",
					{
						on: {
							"CHOICE.replan": "#groceries.planning",
							NEXT: "availability",
						},
					},
				),
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

function commandName(event: string): string {
	if (event === "NEXT") {
		return "next";
	}
	return event.slice("CHOICE.".length);
}
