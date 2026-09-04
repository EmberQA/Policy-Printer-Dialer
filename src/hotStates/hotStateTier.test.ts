import {describe, expect, it} from 'vitest';
import {hotStateFlames, hotStateTier} from './hotStateTier';

describe('hotStateTier', () => {
	it('gives the top three states three flames', () => {
		expect(hotStateTier(1)).toBe(3);
		expect(hotStateTier(3)).toBe(3);
	});

	it('gives ranks four through six two flames', () => {
		expect(hotStateTier(4)).toBe(2);
		expect(hotStateTier(6)).toBe(2);
	});

	it('gives ranks seven through ten one flame', () => {
		expect(hotStateTier(7)).toBe(1);
		expect(hotStateTier(10)).toBe(1);
	});

	it('does not burn outside the top ten', () => {
		expect(hotStateTier(0)).toBe(0);
		expect(hotStateTier(11)).toBe(0);
		expect(hotStateTier(Number.NaN)).toBe(0);
	});

	it('renders one flame per tier', () => {
		expect(hotStateFlames(3)).toBe('🔥🔥🔥');
		expect(hotStateFlames(1)).toBe('🔥');
		expect(hotStateFlames(0)).toBe('');
	});
});
