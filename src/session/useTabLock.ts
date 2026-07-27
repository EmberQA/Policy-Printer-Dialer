/**
 * React binding for the single-tab guard (see tabLock.ts for why Web Locks).
 *
 * Mounted once at the App root, ABOVE <DialerSessionProvider>: a tab that does not
 * own the lock never mounts the provider, so it never creates a Twilio Device and
 * can never be handed an inbound invite. The blocked screen is only the UX around
 * that; withholding the Device is the actual guard.
 */

import {useEffect, useState} from 'react';
import {acquireTabLock, tabLockName, type TabLockState} from './tabLock';

/**
 * Own the dialer for this tab. Returns 'acquiring' for the first instant, then
 * 'owner' or 'blocked' — and flips 'blocked' → 'owner' by itself when the tab that
 * held the lock closes.
 */
export function useTabLock(userId: string): TabLockState {
	const [state, setState] = useState<TabLockState>('acquiring');

	useEffect(() => {
		const handle = acquireTabLock({
			name: tabLockName(userId),
			onState: setState
		});
		return () => handle.release();
	}, [userId]);

	return state;
}
