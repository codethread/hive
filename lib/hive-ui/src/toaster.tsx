// Adapted from shadcn/ui Sonner to Hive's theme tokens.
// https://ui.shadcn.com/docs/components/radix/sonner — MIT; see ../SHADCN_LICENSE.
import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Toaster as Sonner } from "sonner";
import { createPortal } from "react-dom";
import { preferences } from "./data.ts";
import { useStore } from "zustand";

const LAST_MODAL = -1;

export function Toaster() {
	const mount = useRef<HTMLDivElement>(null);
	const theme = useStore(preferences, (state) => state.theme);
	// eslint-disable-next-line react/hook-use-state -- Keep one toast host while moving it into the active native modal.
	const [host] = useState(() => document.createElement("div"));
	useLayoutEffect(() => {
		const sync = () => {
			const target =
				[...document.querySelectorAll('dialog:modal, [role="dialog"][data-state="open"]')].at(
					LAST_MODAL,
				) ?? mount.current!;
			if (host.parentElement !== target) {
				target.append(host);
			}
		};
		const observer = new MutationObserver(sync);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["open", "data-state"],
			childList: true,
			subtree: true,
		});
		sync();
		return () => {
			observer.disconnect();
			host.remove();
		};
	}, [host]);
	return (
		<>
			<div ref={mount} />
			{createPortal(
				<div data-theme={theme} className="toast-host">
					<Sonner
						theme={theme === "paper" ? "light" : "dark"}
						position="bottom-right"
						closeButton
						duration={8000}
						icons={{
							success: <CircleCheck className="size-4" />,
							info: <Info className="size-4" />,
							warning: <TriangleAlert className="size-4" />,
							error: <CircleX className="size-4" />,
							loading: <LoaderCircle className="size-4 refresh-rotating" />,
						}}
					/>
				</div>,
				host,
			)}
		</>
	);
}
