import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router.tsx";

createRoot(document.querySelector("#root")!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
