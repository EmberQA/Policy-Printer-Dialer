import {describe, expect, it} from 'vitest';
import {hotStateFlames, hotStateTier} from './hotStateTier';

describe('hotStateTier', () => {
	it('gives the hottest state the top tier regardless of volume', () => {
		expect(hotStateTier(200, 200)).toBe(3);
		expect(hotStateTier(3, 3)).toBe(3);
	});

	it('scales the remaining states against the top state', () => {
		expect(hotStateTier(70, 100)).toBe(2);
		expect(hotStateTier(60, 100)).toBe(2);
		expect(hotStateTier(45, 100)).toBe(1);
		expect(hotStateTier(30, 100)).toBe(1);
		expect(hotStateTier(29, 100)).toBe(0);
	});

	it('never burns for missing or non-positive counts', () => {
		expect(hotStateTier(0, 10)).toBe(0);
		expect(hotStateTier(5, 0)).toBe(0);
		expect(hotStateTier(Number.NaN, 10)).toBe(0);
	});

	it('renders one flame per tier', () => {
		expect(hotStateFlames(3)).toBe('🔥🔥🔥');
		expect(hotStateFlames(1)).toBe('🔥');
		expect(hotStateFlames(0)).toBe('');
	});
});
