/** Admission and fresh clearance share this short daemon-local critical section. */
export type WithAdmission = <Result>(operation: () => Promise<Result>) => Promise<Result>;

/** Waiting readers observe any earlier claim/reservation/supervisor handoff before returning. */
export function createAdmissionGate(): WithAdmission {
	let previous = Promise.resolve();
	return async function withAdmission<Result>(operation: () => Promise<Result>): Promise<Result> {
		const before = previous;
		const release = Promise.withResolvers<void>();
		previous = release.promise;
		await before;
		try {
			return await operation();
		} finally {
			release.resolve();
		}
	};
}
