/**
 * Single-tab guard for the dialer.
 *
 * Twilio routes an inbound invite to ONE of the registrations under an agent's
 * identity. With two dialer tabs open, both register, and the tab that wins the
 * invite is not necessarily the tab the agent is looking at — the other one shows
 * an idle screen with no lead form while the call is live next door. The fix is to
 * stop the duplicate tab from ever creating a Twilio Device (see App.tsx, which
 * withholds <DialerSessionProvider> from a blocked tab).
 *
 * Ownership uses the Web Locks API rather than a localStorage heartbeat/lease:
 *   - the browser releases the lock when the tab closes OR crashes — nothing to
 *     expire, no stale-lock cleanup, no lease duration to tune;
 *   - a losing tab stays QUEUED on the same lock, so closing the owner promotes it
 *     automatically with no refresh and no polling;
 *   - it is immune to background-tab timer throttling. A lease renewed on a timer
 *     is not: Chrome throttles hidden tabs to ~1 wake/minute, so a backgrounded
 *     owner would look dead and get falsely evicted by a second tab.
 *
 * Scope is origin + storage partition, i.e. one browser profile. Two profiles, a
 * private window, or two different browsers each get their own lock and are NOT
 * covered — an accepted gap, since only backend session ownership could close it.
 *
 * Every failure path FAILS OPEN (state 'owner'). A guard bug must never be able to
 * lock an agent out of the dialer entirely.
 */

export type TabLockState = 'acquiring' | 'owner' | 'blocked';

/** Per-user so two accounts sharing a browser profile don't block each other. */
export const tabLockName = (userId: string): string =>
	`pp_dialer_tab:${userId}`;

/**
 * How long to wait for the lock before telling the user another tab owns it. An
 * uncontended lock is granted almost immediately; this only avoids flashing the
 * blocked screen on the way to a normal grant.
 */
const BLOCKED_AFTER_MS = 200;

/** The slice of `navigator.locks` this module uses (kept narrow so tests can fake it). */
export interface TabLockManager {
	request(
		name: string,
		options: {mode: 'exclusive'; signal?: AbortSignal},
		callback: () => Promise<void> | void
	): Promise<unknown>;
}

/** Injectable page-visibility source (absent in the node test environment). */
export interface TabVisibility {
	isHidden: () => boolean;
	subscribe: (onChange: () => void) => () => void;
}

export interface AcquireTabLockOptions {
	/** Lock name — use tabLockName(userId). */
	name: string;
	/** Called on every state transition. */
	onState: (state: TabLockState) => void;
	/** Defaults to navigator.locks; undefined/null on unsupported browsers. */
	locks?: TabLockManager | null;
	/** Defaults to the document. Null disables the visible-waiter rule below. */
	visibility?: TabVisibility | null;
	blockedAfterMs?: number;
}

export interface TabLockHandle {
	/** Release the held lock, or cancel the queued request. Idempotent. */
	release: () => void;
}

const defaultLocks = (): TabLockManager | null => {
	// Missing on pre-2022 browsers and in insecure contexts (plain-HTTP staging).
	const locks = (globalThis.navigator as Navigator | undefined)?.locks;
	return (locks as TabLockManager | undefined) ?? null;
};

const defaultVisibility = (): TabVisibility | null => {
	if (typeof document === 'undefined') return null;
	return {
		isHidden: () => document.visibilityState === 'hidden',
		subscribe: (onChange) => {
			document.addEventListener('visibilitychange', onChange);
			return () => document.removeEventListener('visibilitychange', onChange);
		}
	};
};

const isAbortError = (err: unknown): boolean =>
	typeof err === 'object' &&
	err !== null &&
	(err as {name?: string}).name === 'AbortError';

/**
 * Take exclusive ownership of the dialer for this tab, holding the lock for as long
 * as the tab lives. A tab that loses reports 'blocked' but STAYS QUEUED, so it is
 * promoted to 'owner' as soon as the winner closes or releases.
 *
 * Waiting is restricted to VISIBLE tabs; holding is not. Web Locks hand a released
 * lock to the next waiter in line, and a reload releases — so without this rule,
 * reloading the working tab hands the dialer to a duplicate sitting hidden in the
 * background, which is precisely the "the call rang in the tab I wasn't looking at"
 * failure this guard exists to prevent. A hidden waiter therefore drops out of the
 * queue and rejoins when the agent looks at it. An owner keeps its lock while
 * hidden, because a backgrounded dialer must stay registered and take calls.
 */
export const acquireTabLock = ({
	name,
	onState,
	locks = defaultLocks(),
	visibility = defaultVisibility(),
	blockedAfterMs = BLOCKED_AFTER_MS
}: AcquireTabLockOptions): TabLockHandle => {
	if (!locks) {
		onState('owner');
		return {release: () => undefined};
	}

	let disposed = false;
	let holding = false;
	/** Resolving this ends our lock callback, which is what releases the lock. */
	let releaseHeld: (() => void) | null = null;
	/** Aborts the in-flight (queued) request; null once granted or dropped. */
	let pending: AbortController | null = null;

	/** Give up our place in line (queued waiters only — never a held lock). */
	const leaveQueue = () => {
		if (!pending) return;
		const controller = pending;
		// Cleared synchronously rather than in the async rejection so a
		// visibilitychange arriving in between can still rejoin the queue.
		pending = null;
		controller.abort();
	};

	const requestLock = () => {
		if (disposed || holding || pending) return;
		const controller = new AbortController();
		pending = controller;

		const blockedTimer = setTimeout(() => {
			if (disposed || holding) return;
			onState('blocked');
			// Queued in a tab that was already hidden on load — no visibilitychange
			// will ever fire to tell us, so check once here.
			if (visibility?.isHidden()) leaveQueue();
		}, blockedAfterMs);

		void locks
			.request(name, {mode: 'exclusive', signal: controller.signal}, () => {
				clearTimeout(blockedTimer);
				// Released before the grant landed (unmount, or a queue exit we no
				// longer want): return so the lock passes straight to the next waiter.
				if (disposed) return;
				pending = null;
				holding = true;
				onState('owner');
				return new Promise<void>((resolve) => {
					releaseHeld = resolve;
				});
			})
			.catch((err) => {
				clearTimeout(blockedTimer);
				if (pending === controller) pending = null;
				if (disposed || holding) return;
				// Our own abort — either release() or the hidden-waiter rule.
				if (isAbortError(err)) return;
				// Anything else is an unexpected browser-side failure. Fail open rather
				// than stranding the agent on the blocked screen.
				disposed = true;
				onState('owner');
			});
	};

	requestLock();

	// Leave the queue whenever the agent switches away from a blocked tab, and
	// rejoin when they come back. An owner is exempt: `holding` short-circuits, so
	// backgrounding the working tab never gives up the dialer.
	const unsubscribe = visibility?.subscribe(() => {
		if (disposed || holding) return;
		if (visibility.isHidden()) leaveQueue();
		else requestLock();
	});

	return {
		release: () => {
			if (disposed) return;
			disposed = true;
			unsubscribe?.();
			if (releaseHeld) releaseHeld();
			pending?.abort();
		}
	};
};
