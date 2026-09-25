import {useEffect, useRef, useState} from 'react';
import {CircleAlert} from 'lucide-react';
import {useDialerSession} from '@/session/DialerSessionProvider';
import {
	createReadyUnavailableAlertTimer,
	isReadyUnavailable
} from './readyUnavailableAlert';

export function ReadyUnavailableBanner() {
	const {audioCheckComplete, bookingRequired, heartbeat, onCall, presence} =
		useDialerSession();
	const [visible, setVisible] = useState(false);
	const timerRef = useRef<ReturnType<
		typeof createReadyUnavailableAlertTimer
	> | null>(null);

	useEffect(() => {
		const timer = createReadyUnavailableAlertTimer(setVisible);
		timerRef.current = timer;
		return () => {
			timer.dispose();
			timerRef.current = null;
		};
	}, []);

	const readyUnavailable =
		audioCheckComplete &&
		!bookingRequired &&
		isReadyUnavailable({
			available: heartbeat.available,
			connected: heartbeat.connected,
			onCall,
			presence
		});

	useEffect(() => {
		timerRef.current?.update(readyUnavailable);
	}, [readyUnavailable]);

	if (!visible) return null;

	return (
		<div
			role="alert"
			aria-live="assertive"
			className="flex items-center justify-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
		>
			<CircleAlert className="size-4 shrink-0" aria-hidden="true" />
			<p>Something went wrong, please log out and log back in</p>
		</div>
	);
}
