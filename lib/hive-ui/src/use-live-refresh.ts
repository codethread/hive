import { useEffect, useEffectEvent } from "react";
import { createActor } from "xstate";
import { createRefreshMachine } from "./refresh.ts";

export function useLiveRefresh(refresh: () => Promise<void>): void {
	const refreshCurrent = useEffectEvent(refresh);
	useEffect(() => {
		const actor = createActor(
			createRefreshMachine(() => refreshCurrent()),
			{
				input: { visible: !document.hidden },
			},
		).start();
		const visibility = () => {
			actor.send({ type: document.hidden ? "HIDE" : "SHOW" });
		};
		document.addEventListener("visibilitychange", visibility);
		return () => {
			document.removeEventListener("visibilitychange", visibility);
			actor.stop();
		};
	}, []);
}
