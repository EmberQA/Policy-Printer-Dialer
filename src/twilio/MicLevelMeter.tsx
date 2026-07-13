import {useEffect, useState} from 'react';
import {cn} from '@/lib/utils';

export const MIC_METER_SEGMENTS = 8;
const MIC_METER_UPDATE_MS = 100;

export function MicLevelMeter({
	segments,
	className
}: {
	segments: number;
	className?: string;
}) {
	return (
		<div
			className={cn('grid h-3 grid-cols-8 gap-1', className)}
			role="meter"
			aria-label="Microphone input level"
			aria-valuemin={0}
			aria-valuemax={MIC_METER_SEGMENTS}
			aria-valuenow={segments}
			aria-valuetext={`${segments} of ${MIC_METER_SEGMENTS} segments`}
		>
			{Array.from({length: MIC_METER_SEGMENTS}, (_, index) => (
				<span
					key={index}
					className={`rounded-sm ${
						index < segments ? 'bg-success' : 'bg-muted'
					}`}
					aria-hidden="true"
				/>
			))}
		</div>
	);
}

export function readMicSegments(level: number, current: number) {
	const segmentSize = 100 / MIC_METER_SEGMENTS;
	const hysteresis = 2;
	let next = current;

	if (level <= 1) return 0;
	while (
		next < MIC_METER_SEGMENTS &&
		level >= next * segmentSize + hysteresis
	) {
		next += 1;
	}
	while (next > 1 && level < (next - 1) * segmentSize - hysteresis) {
		next -= 1;
	}

	return next;
}

export function useMicLevelMeter({
	enabled,
	deviceId = 'default'
}: {
	enabled: boolean;
	deviceId?: string;
}) {
	const [segments, setSegments] = useState(0);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) {
			setSegments(0);
			return;
		}

		let cancelled = false;
		let meterInterval: number | null = null;
		let stream: MediaStream | null = null;
		let audioContext: AudioContext | null = null;

		const start = async () => {
			try {
				setError(null);
				stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						...(deviceId === 'default'
							? {}
							: {deviceId: {exact: deviceId}}),
						autoGainControl: false,
						echoCancellation: false,
						noiseSuppression: false
					}
				});
				if (cancelled) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}

				const AudioContextCtor =
					window.AudioContext ||
					(window as typeof window & {
						webkitAudioContext?: typeof AudioContext;
					}).webkitAudioContext;
				if (!AudioContextCtor) throw new Error('Audio input is not supported.');

				audioContext = new AudioContextCtor();
				const analyser = audioContext.createAnalyser();
				analyser.fftSize = 1024;
				audioContext.createMediaStreamSource(stream).connect(analyser);
				const data = new Float32Array(analyser.fftSize);
				const sample = () => {
					analyser.getFloatTimeDomainData(data);
					const level = readMicLevel(data);
					setSegments((current) => readMicSegments(level, current));
				};

				sample();
				meterInterval = window.setInterval(sample, MIC_METER_UPDATE_MS);
			} catch (err) {
				if (cancelled) return;
				setSegments(0);
				setError(
					(err as {message?: string} | null)?.message ||
						'Could not access the microphone.'
				);
			}
		};

		void start();
		return () => {
			cancelled = true;
			if (meterInterval !== null) window.clearInterval(meterInterval);
			stream?.getTracks().forEach((track) => track.stop());
			void audioContext?.close().catch(() => undefined);
			setSegments(0);
		};
	}, [deviceId, enabled]);

	return {segments, error};
}

function readMicLevel(data: Float32Array) {
	let sumSquares = 0;
	for (const value of data) sumSquares += value * value;

	const rms = Math.sqrt(sumSquares / data.length);
	const decibels = 20 * Math.log10(Math.max(rms, 0.00001));
	const normalized = ((decibels + 60) / 48) * 100;
	return Math.max(0, Math.min(100, Math.round(normalized)));
}
