import {afterEach, describe, expect, it, vi} from 'vitest';
import {
	READY_UNAVAILABLE_ALERT_DELAY_MS,
	createReadyUnavailableAlertTimer,
	isReadyUnavailable
} from './readyUnavailableAlert';

afterEach(() => vi.useRealTimers());

describe('ready unavailable alert', () => {
	it('matches only the connected Ready + Unavailable state outside a call', () => {
		const readyUnavailable = {
			available: 0 as const,
			connected: true,
			onCall: false,
			presence: {status: 'ready' as const, on_call: false}
		};

		expect(isReadyUnavailable(readyUnavailable)).toBe(true);
		expect(
			isReadyUnavailable({...readyUnavailable, available: 1})
		).toBe(false);
		expect(
			isReadyUnavailable({...readyUnavailable, connected: false})
		).toBe(false);
		expect(
			isReadyUnavailable({...readyUnavailable, onCall: true})
		).toBe(false);
		expect(
			isReadyUnavailable({
				...readyUnavailable,
				presence: {...readyUnavailable.presence, status: 'paused'}
			})
		).toBe(false);
	});

	it('alerts only after one continuous unavailable interval', () => {
		vi.useFakeTimers();
		const onVisibilityChange = vi.fn();
		const timer = createReadyUnavailableAlertTimer(onVisibilityChange);

		timer.update(true);
		vi.advanceTimersByTime(READY_UNAVAILABLE_ALERT_DELAY_MS - 1);
		expect(onVisibilityChange).not.toHaveBeenCalled();

		timer.update(false);
		vi.advanceTimersByTime(1);
		expect(onVisibilityChange).not.toHaveBeenCalled();

		timer.update(true);
		vi.advanceTimersByTime(READY_UNAVAILABLE_ALERT_DELAY_MS);
		expect(onVisibilityChange).toHaveBeenLastCalledWith(true);

		timer.update(false);
		expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
		timer.dispose();
	});

	it('does not start duplicate timers for repeated heartbeat updates', () => {
		vi.useFakeTimers();
		const onVisibilityChange = vi.fn();
		const timer = createReadyUnavailableAlertTimer(onVisibilityChange);

		timer.update(true);
		vi.advanceTimersByTime(READY_UNAVAILABLE_ALERT_DELAY_MS / 2);
		timer.update(true);
		vi.advanceTimersByTime(READY_UNAVAILABLE_ALERT_DELAY_MS / 2);

		expect(onVisibilityChange).toHaveBeenCalledOnce();
		expect(onVisibilityChange).toHaveBeenCalledWith(true);
		timer.dispose();
	});
});
