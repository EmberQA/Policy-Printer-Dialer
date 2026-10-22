/** Read-only database verification: 2026-10-21. These are identity pins, not credentials. */
export const DEMO_ORG_ID = '3d5abeaf-38af-4660-89db-c72d1528bd3e';
export const DEMO_AGENT = {
	org_id: DEMO_ORG_ID,
	user_id: 'c633eea3-e02d-4f05-8c7a-69b1574e195c',
	qs_agent_id: 'af91217b-d916-4442-9b3d-605f033b545c',
	dialer_agent_id: 'cd23966f-a0e7-4aba-936c-69616c19445c',
	role: 'agent'
} as const;
export const DEMO_OWNER = {
	org_id: DEMO_ORG_ID,
	user_id: '9e28a884-2e30-4097-bebc-163352cbdeac',
	qs_agent_id: '68d8dbb3-4696-4ce7-97fe-0b738520c027',
	dialer_agent_id: 'ce03aa9a-6eff-459c-8eab-195b90a1e5d1',
	role: 'owner'
} as const;
export type DemoIdentity = typeof DEMO_AGENT | typeof DEMO_OWNER;
export const DEMO_HOST = 'pp-recording.localhost';
export function assertDemoIdentity(
	identity: unknown
): asserts identity is DemoIdentity {
	if (!identity || typeof identity !== 'object')
		throw new Error('Verified demo identity required');
	const value = identity as Record<string, unknown>;
	const expected = value.role === 'owner' ? DEMO_OWNER : DEMO_AGENT;
	if (Object.entries(expected).some(([key, v]) => value[key] !== v))
		throw new Error('Verified demo identity required');
}
export function assertLocalRecording(host: string, development: boolean) {
	if (!development || host !== DEMO_HOST)
		throw new Error(
			'Recording fixtures run only on the dedicated local demo host'
		);
}

/** NANP's reserved fictional line range; the simulator never accepts real destinations. */
export function assertSyntheticPhone(phone: string) {
	if (!/^\+120255501\d{2}$/.test(phone))
		throw new Error('Use a synthetic 202-555-01xx demo number');
}

export function isVerifiedDemoUser(
	user: {org_id?: string; user_id?: string} | null
): boolean {
	return (
		user?.org_id === DEMO_ORG_ID &&
		(user.user_id === DEMO_AGENT.user_id || user.user_id === DEMO_OWNER.user_id)
	);
}
