import {useEffect, useMemo, useRef, useState} from 'react';
import {
	AudioLines,
	Headphones,
	Loader2,
	Mic,
	Play,
	RefreshCw,
	X
} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {cn} from '@/lib/utils';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select';
import {MicLevelMeter, useMicLevelMeter} from './MicLevelMeter';

const DEFAULT_DEVICE_ID = 'default';

type ApplyingState = 'input' | 'output' | 'speaker' | 'echo' | 'refresh' | null;

interface EchoPlayback {
	stream: MediaStream;
	destinationStream?: MediaStream;
	audio?: HTMLAudioElement;
	audioContext: AudioContext;
}

interface AudioSetupDialogProps {
	onInputDeviceChange: (deviceId: string) => Promise<void>;
	onOutputDeviceChange: (deviceId: string) => Promise<void>;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	required?: boolean;
	showTrigger?: boolean;
	onRequiredComplete?: () => void;
}

export function AudioSetupDialog({
	onInputDeviceChange,
	onOutputDeviceChange,
	open: controlledOpen,
	onOpenChange,
	required = false,
	showTrigger = true,
	onRequiredComplete
}: AudioSetupDialogProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [selectedInputId, setSelectedInputId] = useState(DEFAULT_DEVICE_ID);
	const [selectedOutputId, setSelectedOutputId] = useState(DEFAULT_DEVICE_ID);
	const [speakerStatus, setSpeakerStatus] = useState('Speaker idle');
	const [echoStatus, setEchoStatus] = useState(
		'Hear yourself with a short delay to test your microphone.'
	);
	const [echoActive, setEchoActive] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [applying, setApplying] = useState<ApplyingState>(null);
	const [echoStarted, setEchoStarted] = useState(false);
	const [echoConfirmationReady, setEchoConfirmationReady] = useState(false);
	const echoPlaybackRef = useRef<EchoPlayback | null>(null);
	const echoConfirmationTimerRef = useRef<number | null>(null);
	const open = controlledOpen ?? internalOpen;
	const micMeter = useMicLevelMeter({
		enabled: open,
		deviceId: selectedInputId
	});
	const micStatus = !open
		? 'Microphone idle'
		: micMeter.error
			? 'Microphone unavailable'
			: 'Listening';

	const inputOptions = useMemo(
		() => deviceOptions(devices, 'audioinput', 'microphone'),
		[devices]
	);
	const outputOptions = useMemo(
		() => deviceOptions(devices, 'audiooutput', 'speaker'),
		[devices]
	);

	useEffect(
		() => () => {
			const playback = echoPlaybackRef.current;
			echoPlaybackRef.current = null;
			if (playback) void stopEchoPlayback(playback);
			if (echoConfirmationTimerRef.current !== null) {
				window.clearTimeout(echoConfirmationTimerRef.current);
			}
		},
		[]
	);

	useEffect(() => {
		if (micMeter.error) setError(micMeter.error);
	}, [micMeter.error]);

	useEffect(() => {
		if (!open) return;

		let cancelled = false;
		const refresh = async () => {
			const nextDevices = await enumerateAudioDevices();
			if (cancelled) return;
			setDevices(nextDevices);
			setSelectedInputId((current) =>
				containsDevice(nextDevices, 'audioinput', current)
					? current
					: DEFAULT_DEVICE_ID
			);
			setSelectedOutputId((current) =>
				containsDevice(nextDevices, 'audiooutput', current)
					? current
					: DEFAULT_DEVICE_ID
			);
		};

		void refresh();
		navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
		return () => {
			cancelled = true;
			navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
		};
	}, [open]);

	const refreshDevices = async () => {
		setApplying('refresh');
		setError(null);
		try {
			await navigator.mediaDevices
				.getUserMedia({audio: true})
				.then((stream) => {
					stream.getTracks().forEach((track) => track.stop());
				});
			setDevices(await enumerateAudioDevices());
		} catch (err) {
			setError(readMediaError(err, 'Could not refresh audio devices.'));
		} finally {
			setApplying(null);
		}
	};

	const changeInputDevice = async (deviceId: string) => {
		setSelectedInputId(deviceId);
		setApplying('input');
		setError(null);
		try {
			await onInputDeviceChange(deviceId);
		} catch (err) {
			setError(readMediaError(err, 'Could not switch microphone.'));
		} finally {
			setApplying(null);
		}
	};

	const changeOutputDevice = async (deviceId: string) => {
		setSelectedOutputId(deviceId);
		setApplying('output');
		setError(null);
		try {
			await onOutputDeviceChange(deviceId);
			setSpeakerStatus('Speaker selected');
		} catch (err) {
			setError(readMediaError(err, 'Could not switch speaker.'));
		} finally {
			setApplying(null);
		}
	};

	const testSpeaker = async () => {
		setApplying('speaker');
		setError(null);
		setSpeakerStatus('Playing');
		try {
			await playTestTone(selectedOutputId);
			setSpeakerStatus('Test complete');
		} catch (err) {
			setSpeakerStatus('Speaker unavailable');
			setError(readMediaError(err, 'Could not play speaker test.'));
		} finally {
			setApplying(null);
		}
	};

	const stopEchoTest = () => {
		const playback = echoPlaybackRef.current;
		echoPlaybackRef.current = null;
		if (playback) void stopEchoPlayback(playback);
		if (echoConfirmationTimerRef.current !== null) {
			window.clearTimeout(echoConfirmationTimerRef.current);
			echoConfirmationTimerRef.current = null;
			setEchoConfirmationReady(false);
		}
		setEchoActive(false);
		setEchoStatus('Hear yourself with a short delay.');
	};

	const startEchoTest = async () => {
		setApplying('echo');
		setError(null);
		setEchoStatus('Starting delayed playback…');
		try {
			const playback = await startEchoPlayback(
				selectedInputId,
				selectedOutputId
			);
			echoPlaybackRef.current = playback;
			setEchoStarted(true);
			setEchoConfirmationReady(false);
			setEchoActive(true);
			setEchoStatus('Playing your voice with a short delay.');
			echoConfirmationTimerRef.current = window.setTimeout(() => {
				echoConfirmationTimerRef.current = null;
				setEchoConfirmationReady(true);
			}, 1_000);
		} catch (err) {
			setEchoStatus('Echo test unavailable.');
			setError(readMediaError(err, 'Could not start the echo test.'));
		} finally {
			setApplying(null);
		}
	};

	const setOpen = (nextOpen: boolean) => {
		if (!nextOpen && required) return;
		if (!nextOpen) stopEchoTest();
		if (controlledOpen === undefined) setInternalOpen(nextOpen);
		onOpenChange?.(nextOpen);
	};

	const completeRequiredTest = () => {
		stopEchoTest();
		onRequiredComplete?.();
		if (controlledOpen === undefined) setInternalOpen(false);
		onOpenChange?.(false);
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
			{showTrigger && (
				<DialogPrimitive.Trigger asChild>
					<Button variant="outline" className="w-full justify-start">
						<Headphones className="size-4" />
						Audio Setup
					</Button>
				</DialogPrimitive.Trigger>
			)}
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content
					className={cn(
						'fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
						required
							? 'max-h-[calc(100vh-2rem)] max-w-2xl gap-6 overflow-y-auto p-7 sm:p-8'
							: 'max-w-lg gap-4 p-5'
					)}
					onEscapeKeyDown={
						required ? (event) => event.preventDefault() : undefined
					}
					onPointerDownOutside={
						required ? (event) => event.preventDefault() : undefined
					}
				>
					<div className="flex items-start justify-between gap-3">
						<div className="space-y-1">
							<DialogPrimitive.Title
								className={cn(
									'font-semibold',
									required ? 'text-2xl' : 'text-lg'
								)}
							>
								{required ? 'Audio check required' : 'Audio Setup'}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description
								className={cn(
									'text-muted-foreground',
									required ? 'text-base leading-7' : 'text-sm'
								)}
							>
								{required
									? 'Start the echo test, say a few words, then confirm you can hear yourself.'
									: 'Test microphone and speaker devices.'}
							</DialogPrimitive.Description>
						</div>
						{required ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={refreshDevices}
								disabled={applying !== null || echoActive}
								className="shrink-0"
							>
								{applying === 'refresh' ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RefreshCw className="size-4" />
								)}
								Refresh
							</Button>
						) : (
							<DialogPrimitive.Close asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-8 shrink-0"
									aria-label="Close audio setup"
								>
									<X className="size-4" />
								</Button>
							</DialogPrimitive.Close>
						)}
					</div>

					{error && (
						<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}

					<div className={cn('space-y-4', required && 'space-y-5')}>
						<section
							className={cn(
								'min-w-0 space-y-3 rounded-md border p-3',
								required && 'space-y-4 p-4'
							)}
						>
							<div className="flex min-w-0 items-center gap-2">
								<Mic className="size-4 text-muted-foreground" />
								<Label htmlFor="audio-input-device">Microphone</Label>
								<DeviceStatus
									status={micStatus}
									loading={applying === 'input'}
								/>
							</div>
							<Select value={selectedInputId} onValueChange={changeInputDevice}>
								<SelectTrigger
									id="audio-input-device"
									className="w-full"
									disabled={applying !== null || echoActive}
								>
									<SelectValue placeholder="Select microphone" />
								</SelectTrigger>
								<SelectContent>
									{inputOptions.map((device) => (
										<SelectItem key={device.deviceId} value={device.deviceId}>
											{device.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<MicLevelMeter
								segments={micMeter.segments}
								className="mx-auto w-64 max-w-full"
							/>
						</section>

						<section
							className={cn(
								'space-y-3 rounded-md border p-3',
								required && 'space-y-4 p-4'
							)}
						>
							<div className="flex items-center gap-2">
								<Headphones className="size-4 text-muted-foreground" />
								<Label htmlFor="audio-output-device">Speaker</Label>
								<DeviceStatus
									status={speakerStatus}
									loading={applying === 'output' || applying === 'speaker'}
								/>
							</div>
							<div className="flex flex-col gap-2 sm:flex-row">
								<Select
									value={selectedOutputId}
									onValueChange={changeOutputDevice}
								>
									<SelectTrigger
										id="audio-output-device"
										className="w-full"
										disabled={applying !== null || echoActive}
									>
										<SelectValue placeholder="Select speaker" />
									</SelectTrigger>
									<SelectContent>
										{outputOptions.map((device) => (
											<SelectItem key={device.deviceId} value={device.deviceId}>
												{device.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									type="button"
									variant="secondary"
									onClick={testSpeaker}
									disabled={applying !== null || echoActive}
									className="sm:w-32"
								>
									{applying === 'speaker' ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Play className="size-4" />
									)}
									Test
								</Button>
							</div>
						</section>

						<section
							className={cn(
								'space-y-3 rounded-md border p-3',
								required && 'space-y-4 p-4'
							)}
						>
							<div className="flex min-w-0 items-center gap-2">
								<AudioLines className="size-4 text-muted-foreground" />
								<p className="text-sm font-medium">Echo Test</p>
								<DeviceStatus
									status={echoActive ? 'Active' : 'Idle'}
									loading={applying === 'echo'}
								/>
							</div>
							<div className="flex items-center justify-between gap-3">
								<p className="min-w-0 text-xs text-muted-foreground">
									{echoStatus}
								</p>
								<Button
									type="button"
									variant="outline"
									onClick={echoActive ? stopEchoTest : startEchoTest}
									disabled={applying !== null}
									className="shrink-0"
								>
									{applying === 'echo' ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Mic className="size-4" />
									)}
									{echoActive ? 'Stop' : 'Start'}
								</Button>
							</div>
						</section>
					</div>

					{required ? (
						<div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
							<p
								className="text-center text-sm font-semibold leading-6"
								aria-live="polite"
							>
								{echoStarted
									? echoConfirmationReady
										? 'If you heard your voice, click below to enter the dialer.'
										: 'Keep the Echo Test running briefly. The button will unlock after one second.'
									: 'Start the Echo Test above. Once you hear yourself, click below to continue.'}
							</p>
							<Button
								type="button"
								onClick={completeRequiredTest}
								disabled={!echoConfirmationReady || applying !== null}
								className="h-12 w-full text-base"
							>
								I can hear my voice
							</Button>
						</div>
					) : (
						<div className="flex justify-between gap-2">
							<Button
								type="button"
								variant="ghost"
								onClick={refreshDevices}
								disabled={applying !== null || echoActive}
							>
								{applying === 'refresh' ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RefreshCw className="size-4" />
								)}
								Refresh
							</Button>
							<DialogPrimitive.Close asChild>
								<Button type="button">Done</Button>
							</DialogPrimitive.Close>
						</div>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function DeviceStatus({status, loading}: {status: string; loading: boolean}) {
	return (
		<span className="ml-auto inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
			{loading && <Loader2 className="size-3 animate-spin" />}
			<span className="truncate">{status}</span>
		</span>
	);
}

function deviceOptions(
	devices: MediaDeviceInfo[],
	kind: MediaDeviceKind,
	label: 'microphone' | 'speaker'
) {
	const options = devices.filter((device) => device.kind === kind);
	const seen = new Set<string>();
	const mapped = options
		.filter((device) => {
			if (!device.deviceId || seen.has(device.deviceId)) return false;
			seen.add(device.deviceId);
			return true;
		})
		.map((device, index) => ({
			deviceId: device.deviceId,
			label: deviceName(device, index, label)
		}));

	if (!seen.has(DEFAULT_DEVICE_ID)) {
		mapped.unshift({
			deviceId: DEFAULT_DEVICE_ID,
			label: `Default ${label}`
		});
	}

	return mapped;
}

function deviceName(
	device: MediaDeviceInfo,
	index: number,
	label: 'microphone' | 'speaker'
) {
	if (device.label) return device.label;
	if (device.deviceId === DEFAULT_DEVICE_ID) return `Default ${label}`;
	if (device.deviceId === 'communications') return `Communications ${label}`;
	return `${capitalize(label)} ${index + 1}`;
}

function containsDevice(
	devices: MediaDeviceInfo[],
	kind: MediaDeviceKind,
	deviceId: string
) {
	return (
		deviceId === DEFAULT_DEVICE_ID ||
		devices.some(
			(device) => device.kind === kind && device.deviceId === deviceId
		)
	);
}

async function enumerateAudioDevices() {
	if (!navigator.mediaDevices?.enumerateDevices) return [];
	try {
		await navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
			stream.getTracks().forEach((track) => track.stop());
		});
	} catch {
		/* Labels may be hidden until permission is granted. Enumerate anyway. */
	}
	return navigator.mediaDevices.enumerateDevices();
}

async function playTestTone(outputDeviceId: string) {
	const AudioContextCtor =
		window.AudioContext ||
		(
			window as typeof window & {
				webkitAudioContext?: typeof AudioContext;
			}
		).webkitAudioContext;
	if (!AudioContextCtor) {
		throw new Error('Audio playback is not supported in this browser.');
	}

	const audioContext = new AudioContextCtor();
	const destination = audioContext.createMediaStreamDestination();
	const oscillator = audioContext.createOscillator();
	const gain = audioContext.createGain();
	const audio = new Audio();
	const output = audio as HTMLAudioElement & {
		setSinkId?: (sinkId: string) => Promise<void>;
	};

	oscillator.type = 'sine';
	oscillator.frequency.value = 760;
	gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.04);
	gain.gain.exponentialRampToValueAtTime(
		0.0001,
		audioContext.currentTime + 0.7
	);
	oscillator.connect(gain);
	gain.connect(destination);
	audio.srcObject = destination.stream;

	if (outputDeviceId !== DEFAULT_DEVICE_ID) {
		if (!output.setSinkId) {
			throw new Error('This browser cannot test a selected speaker.');
		}
		await output.setSinkId(outputDeviceId);
	}

	await audio.play();
	oscillator.start();
	await new Promise((resolve) => setTimeout(resolve, 760));
	oscillator.stop();
	audio.pause();
	destination.stream.getTracks().forEach((track) => track.stop());
	await audioContext.close();
}

async function startEchoPlayback(
	inputDeviceId: string,
	outputDeviceId: string
): Promise<EchoPlayback> {
	const AudioContextCtor =
		window.AudioContext ||
		(
			window as typeof window & {
				webkitAudioContext?: typeof AudioContext;
			}
		).webkitAudioContext;
	if (!AudioContextCtor) {
		throw new Error('Echo testing is not supported in this browser.');
	}

	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			...(inputDeviceId === DEFAULT_DEVICE_ID
				? {}
				: {deviceId: {exact: inputDeviceId}}),
			autoGainControl: false,
			echoCancellation: false,
			noiseSuppression: false
		}
	});
	const audioContext = new AudioContextCtor();
	const source = audioContext.createMediaStreamSource(stream);
	const delay = audioContext.createDelay(2);
	let destinationStream: MediaStream | undefined;
	delay.delayTime.value = 0.5;

	try {
		const sinkContext = audioContext as AudioContext & {
			setSinkId?: (sinkId: string) => Promise<void>;
		};
		if (
			outputDeviceId === DEFAULT_DEVICE_ID ||
			typeof sinkContext.setSinkId === 'function'
		) {
			if (outputDeviceId !== DEFAULT_DEVICE_ID) {
				await sinkContext.setSinkId?.(outputDeviceId);
			}
			source.connect(delay).connect(audioContext.destination);
			await audioContext.resume();
			return {stream, audioContext};
		}

		// Older browsers need an audio element to target a selected speaker.
		const destination = audioContext.createMediaStreamDestination();
		destinationStream = destination.stream;
		const audio = new Audio() as HTMLAudioElement & {
			setSinkId?: (sinkId: string) => Promise<void>;
		};
		if (!audio.setSinkId) {
			throw new Error('This browser cannot test a selected speaker.');
		}

		source.connect(delay).connect(destination);
		audio.srcObject = destination.stream;
		await audio.setSinkId(outputDeviceId);
		await audio.play();
		return {
			stream,
			destinationStream: destination.stream,
			audio,
			audioContext
		};
	} catch (err) {
		stream.getTracks().forEach((track) => track.stop());
		destinationStream?.getTracks().forEach((track) => track.stop());
		void audioContext.close().catch(() => undefined);
		throw err;
	}
}

async function stopEchoPlayback(playback: EchoPlayback) {
	playback.audio?.pause();
	if (playback.audio) playback.audio.srcObject = null;
	playback.stream.getTracks().forEach((track) => track.stop());
	playback.destinationStream
		?.getTracks()
		.forEach((track) => track.stop());
	await playback.audioContext.close().catch(() => undefined);
}

function readMediaError(err: unknown, fallback: string) {
	return (err as {message?: string} | null)?.message || fallback;
}

function capitalize(value: string) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
