/**
 * Pull a user-facing message out of a thrown/axios error, falling back to `fallback`.
 * Prefers the API envelope's statusMessage, then the JS error message.
 */
export function readError(err: any, fallback: string): string {
	return err?.response?.data?.statusMessage || err?.message || fallback;
}
