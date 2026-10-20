import {afterEach, expect, it, vi} from 'vitest';
import {CallAudioDiagnostics} from './callAudioDiagnostics';

afterEach(() => vi.useRealTimers());
it('bounds long calls to a first snapshot and 12 recent samples, retaining unknown audio as null', () => {
	vi.useFakeTimers();
	const diagnostics = new CallAudioDiagnostics();
	for (let i = 0; i < 1000; i++) {
		diagnostics.record(null, undefined, null, 'default');
		vi.advanceTimersByTime(5000);
	}
	const result = diagnostics.snapshot();
	expect(result.samples).toHaveLength(12);
	expect(result.first?.elapsed_ms).toBe(0);
	expect(result.samples[0].elapsed_ms).toBe(988 * 5000);
	expect(result.samples[0].inbound).toBeNull();
	expect(result.last_sample_age_ms).toBe(5000);
});
it('swallows observation errors and records no raw stats or device inventory', () => {
	const diagnostics = new CallAudioDiagnostics();
	const element = {get srcObject() {throw new Error('disposed');}} as unknown as HTMLAudioElement;
	expect(() => diagnostics.record(null, undefined, element, 'default')).not.toThrow();
	expect(diagnostics.snapshot()).toMatchObject({stats_errors: 1, samples: []});
});
