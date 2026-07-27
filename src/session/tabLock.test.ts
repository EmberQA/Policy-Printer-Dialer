import {describe, expect, it} from 'vitest';
import {
	acquireTabLock,
	tabLockName,
	type TabLockManager,
	type TabLockState,
	type TabVisibility
} from './tabLock';

/**
 * Minimal stand-in for navigator.locks: exclusive, FIFO, and the lock is held for
 * exactly as long as the granted callback's promise is pending — the three
 * behaviours the guard depends on.
 */
class FakeLockManager implements TabLockManager {
	private held = new Set<string>();
	private waiters = new Map<string, Array<() => void>>();

	request(
		name: string,
		options: {mode: 'exclusive'; signal?: AbortSignal},
		callback: () => Promise<void> | void
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const grant = () => {
				this.held.add(name);
				void Promise.resolve(callback()).then(() => {
					this.held.delete(name);
					const next = this.waiters.get(name)?.shift();
					if (next) next();
					resolve(undefined);
				});
			};

			if (!this.held.has(name)) {
				grant();
				return;
			}

			const queue = this.waiters.get(name) ?? [];
			queue.push(grant);
			this.waiters.set(name, queue);
			options.signal?.addEventListener('abort', () => {
				const pending = this.waiters.get(name) ?? [];
				const index = pending.indexOf(grant);
				if (index >= 0) pending.splice(index, 1);
				reject(new DOMException('Aborted', 'AbortError'));
			});
		});
	}

	isHeld(name: string): boolean {
		return this.held.has(name);
	}
}

/** Let queued microtasks and the zero-delay blocked timer run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const track = () => {
	const states: TabLockState[] = [];
	return {states, onState: (state: TabLockState) => states.push(state)};
};

/** Controllable page visibility, matching the document-backed implementation. */
const fakeVisibility = (hidden = false) => {
	const listeners = new Set<() => void>();
	let isHidden = hidden;
	const visibility: TabVisibility = {
		isHidden: () => isHidden,
		subscribe: (onChange) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		}
	};
	return {
		visibility,
		set: (next: boolean) => {
			isHidden = next;
			listeners.forEach((listener) => listener());
		}
	};
};

const NAME = tabLockName('user-1');

describe('dialer tab lock', () => {
	it('names the lock per user so two accounts on one profile do not collide', () => {
		expect(tabLockName('user-1')).not.toBe(tabLockName('user-2'));
	});

	it('makes the first tab the owner', async () => {
		const locks = new FakeLockManager();
		const first = track();

		acquireTabLock({
			name: NAME,
			onState: first.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();

		expect(first.states.at(-1)).toBe('owner');
		expect(locks.isHeld(NAME)).toBe(true);
	});

	it('blocks a second tab and promotes it when the owner releases', async () => {
		const locks = new FakeLockManager();
		const first = track();
		const second = track();

		const owner = acquireTabLock({
			name: NAME,
			onState: first.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();
		acquireTabLock({
			name: NAME,
			onState: second.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();

		expect(second.states.at(-1)).toBe('blocked');

		// Closing the owning tab hands the lock to the tab still queued behind it.
		owner.release();
		await settle();

		expect(second.states.at(-1)).toBe('owner');
		expect(locks.isHeld(NAME)).toBe(true);
	});

	it('does not promote a blocked tab that was released while queued', async () => {
		const locks = new FakeLockManager();
		const first = track();
		const second = track();

		const owner = acquireTabLock({
			name: NAME,
			onState: first.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();
		const blocked = acquireTabLock({
			name: NAME,
			onState: second.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();

		// e.g. the duplicate tab is closed, or React unmounts it, before promotion.
		blocked.release();
		owner.release();
		await settle();

		expect(second.states).not.toContain('owner');
		expect(locks.isHeld(NAME)).toBe(false);
	});

	it('does not let a hidden duplicate tab inherit the lock when the owner reloads', async () => {
		const locks = new FakeLockManager();
		const owner = track();
		const duplicate = track();
		const hiddenDuplicate = fakeVisibility(true);

		const working = acquireTabLock({
			name: NAME,
			onState: owner.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();
		acquireTabLock({
			name: NAME,
			onState: duplicate.onState,
			locks,
			visibility: hiddenDuplicate.visibility,
			blockedAfterMs: 0
		});
		await settle();
		expect(duplicate.states.at(-1)).toBe('blocked');

		// The agent reloads the tab they are working in: it drops its lock, and the
		// background duplicate must NOT be promoted into owning the Twilio device.
		working.release();
		await settle();
		expect(duplicate.states).not.toContain('owner');
		expect(locks.isHeld(NAME)).toBe(false);

		// The reloaded tab takes its lock straight back.
		const reloaded = track();
		acquireTabLock({
			name: NAME,
			onState: reloaded.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();
		expect(reloaded.states.at(-1)).toBe('owner');
	});

	it('leaves the queue when the agent switches away from a blocked tab', async () => {
		const locks = new FakeLockManager();
		const owner = track();
		const duplicate = track();
		// The duplicate is focused when it opens — the usual case, since it was just
		// opened by the main app's Open Dialer button — and only goes to the
		// background once the agent switches back to the tab they were working in.
		const duplicateVisibility = fakeVisibility(false);

		const working = acquireTabLock({
			name: NAME,
			onState: owner.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();
		acquireTabLock({
			name: NAME,
			onState: duplicate.onState,
			locks,
			visibility: duplicateVisibility.visibility,
			blockedAfterMs: 0
		});
		await settle();
		expect(duplicate.states.at(-1)).toBe('blocked');

		duplicateVisibility.set(true);
		await settle();
		working.release();
		await settle();

		expect(duplicate.states).not.toContain('owner');
		expect(locks.isHeld(NAME)).toBe(false);
	});

	it('rejoins the queue when the agent returns to a hidden blocked tab', async () => {
		const locks = new FakeLockManager();
		const owner = track();
		const duplicate = track();
		const hiddenDuplicate = fakeVisibility(true);

		const working = acquireTabLock({
			name: NAME,
			onState: owner.onState,
			locks,
			blockedAfterMs: 0
		});
		await settle();
		acquireTabLock({
			name: NAME,
			onState: duplicate.onState,
			locks,
			visibility: hiddenDuplicate.visibility,
			blockedAfterMs: 0
		});
		await settle();

		hiddenDuplicate.set(false);
		await settle();
		working.release();
		await settle();

		expect(duplicate.states.at(-1)).toBe('owner');
	});

	it('keeps the lock while the owning tab is hidden', async () => {
		const locks = new FakeLockManager();
		const owner = track();
		const hiddenOwner = fakeVisibility(false);

		acquireTabLock({
			name: NAME,
			onState: owner.onState,
			locks,
			visibility: hiddenOwner.visibility,
			blockedAfterMs: 0
		});
		await settle();

		// A backgrounded dialer must stay registered and keep taking calls.
		hiddenOwner.set(true);
		await settle();

		expect(owner.states.at(-1)).toBe('owner');
		expect(locks.isHeld(NAME)).toBe(true);
	});

	it('fails open when the browser has no Web Locks support', async () => {
		const {states, onState} = track();

		acquireTabLock({name: NAME, onState, locks: null, blockedAfterMs: 0});
		await settle();

		expect(states).toEqual(['owner']);
	});

	it('fails open when the lock request itself rejects', async () => {
		const {states, onState} = track();
		const brokenLocks: TabLockManager = {
			request: () => Promise.reject(new Error('lock manager unavailable'))
		};

		acquireTabLock({
			name: NAME,
			onState,
			locks: brokenLocks,
			blockedAfterMs: 0
		});
		await settle();

		expect(states.at(-1)).toBe('owner');
	});
});
