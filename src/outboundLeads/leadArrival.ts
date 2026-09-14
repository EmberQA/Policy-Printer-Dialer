import type {PendingLeadSummary} from '@/lib/api';

export type LeadArrival = {lead: PendingLeadSummary; count: number};
const listeners = new Set<(arrival: LeadArrival) => void>();

// The table publishes before acknowledgement, so it cannot race the pending poll
// and silently consume a newly arrived lead while the Leads page is open.
export function publishLeadArrival(arrival: LeadArrival) {
	listeners.forEach((listener) => listener(arrival));
}
export function subscribeLeadArrivals(
	listener: (arrival: LeadArrival) => void
) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function createLeadArrivalGate() {
	const seen = new Set<string>();
	return (arrival: LeadArrival) => {
		if (seen.has(arrival.lead.id)) return false;
		seen.add(arrival.lead.id);
		return true;
	};
}

export function createLeadNoticeSession(
	onNotice: (arrival: LeadArrival | null) => void,
	play: () => void,
	accept = createLeadArrivalGate()
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		receive(arrival: LeadArrival) {
			if (!accept(arrival)) return;
			onNotice(arrival);
			play();
			clearTimeout(timer);
			timer = setTimeout(() => onNotice(null), 10_000);
		},
		dispose() {
			clearTimeout(timer);
		}
	};
}
