/**
 * useReturningCaller — prior-history pull-up for agent-originated outbound calls.
 * The dial page deliberately does not invoke this hook for inbound calls.
 *
 * Fire-and-forget by design: it never throws and never blocks the blank New-Lead
 * form — if it errors or the caller has no history, the caller experience is
 * unchanged. Keyed to callSid so it re-runs per call and a stale in-flight response
 * (fast call → hangup → new call) can't render against the wrong caller.
 */

import {useEffect, useState} from 'react';
import {lookupReturningCaller, type ReturningCallerResponse} from '@/lib/api';

export interface UseReturningCallerResult {
	data: ReturningCallerResponse | null;
	loading: boolean;
	error: string | null;
}

export function useReturningCaller(
	callerPhone: string | null,
	callSid: string | null
): UseReturningCallerResult {
	const [data, setData] = useState<ReturningCallerResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		// No live call / no caller number → nothing to look up; clear any prior result.
		if (!callerPhone || !callSid) {
			setData(null);
			setLoading(false);
			setError(null);
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError(null);
		setData(null);

		lookupReturningCaller(callerPhone)
			.then((res) => {
				if (cancelled) return;
				if (res.statusCode !== 'SP100') {
					setError(res.statusMessage || 'Could not check returning caller');
					return;
				}
				setData(res);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(
					err?.response?.data?.statusMessage ||
						err?.message ||
						'Could not check returning caller'
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [callerPhone, callSid]);

	return {data, loading, error};
}
