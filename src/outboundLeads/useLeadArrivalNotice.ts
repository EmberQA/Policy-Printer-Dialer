import {useEffect, useRef, useState} from 'react';
import type {PendingLeadSummary} from '@/lib/api';
import {InboundAnswerTone} from '@/twilio/inboundAnswerTone';
import {
	createLeadArrivalGate,
	createLeadNoticeSession,
	subscribeLeadArrivals,
	type LeadArrival
} from './leadArrival';

export function useLeadArrivalNotice(
	latest: PendingLeadSummary | null,
	count: number,
	enabled: boolean,
	outputDeviceId: string
) {
	const [notice, setNotice] = useState<LeadArrival | null>(null);
	const accept = useRef(createLeadArrivalGate());
	const receiveRef = useRef<(arrival: LeadArrival) => void>(() => undefined);
	const toneRef = useRef<InboundAnswerTone | null>(null);
	const outputRef = useRef(outputDeviceId);
	outputRef.current = outputDeviceId;

	useEffect(() => {
		if (!enabled) {
			setNotice(null);
			accept.current = createLeadArrivalGate();
			return;
		}
		// Separate graph: a lead chime cannot stop an incoming-call tone or touch call audio.
		const tone = new InboundAnswerTone();
		toneRef.current = tone;
		const arm = () => tone.arm(outputRef.current);
		arm();
		window.addEventListener('pointerdown', arm);
		window.addEventListener('keydown', arm);
		const session = createLeadNoticeSession(
			setNotice,
			() => {
				arm();
				tone.play();
			},
			accept.current
		);
		receiveRef.current = session.receive;
		const unsubscribe = subscribeLeadArrivals(session.receive);
		return () => {
			unsubscribe();
			session.dispose();
			receiveRef.current = () => undefined;
			window.removeEventListener('pointerdown', arm);
			window.removeEventListener('keydown', arm);
			tone.dispose();
			toneRef.current = null;
		};
	}, [enabled]);
	useEffect(() => {
		toneRef.current?.setOutputDevice(outputDeviceId);
	}, [outputDeviceId]);
	useEffect(() => {
		if (enabled && latest && count > 0)
			receiveRef.current({lead: latest, count});
	}, [enabled, latest, count]);
	return {notice, dismiss: () => setNotice(null)};
}
