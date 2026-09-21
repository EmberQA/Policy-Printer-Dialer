import {useEffect, useState} from 'react';
import {CalendarDays, RefreshCw} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Button} from '@/components/ui/button';
import {CALENDLY_URL, isBookingConfirmation} from './coaching';

type CalendlyApi = {
	initInlineWidget: (options: {url: string; parentElement: HTMLElement; prefill: {name: string}}) => void;
};
const calendlyWindow = () => window as Window & {Calendly?: CalendlyApi};
let widgetScript: Promise<CalendlyApi> | null = null;

function loadCalendly(): Promise<CalendlyApi> {
	const existing = calendlyWindow().Calendly;
	if (existing) return Promise.resolve(existing);
	if (widgetScript) return widgetScript;
	widgetScript = new Promise<CalendlyApi>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = 'https://assets.calendly.com/assets/external/widget.js';
		script.async = true;
		const fail = () => {
			clearTimeout(timeout);
			script.remove();
			reject(new Error('Calendly could not load'));
		};
		const timeout = setTimeout(fail, 20_000);
		script.onerror = fail;
		script.onload = () => {
			clearTimeout(timeout);
			const api = calendlyWindow().Calendly;
			if (api) resolve(api);
			else fail();
		};
		document.head.appendChild(script);
	}).catch((error) => { widgetScript = null; throw error; });
	return widgetScript;
}

/** Completion is the only dismissal path, except in the dev-only preview. */
export function CoachingBookingDialog({userName, onBooked, onPreviewClose}: {
	userName: string;
	onBooked: () => void;
	onPreviewClose?: () => void;
}) {
	const closePreview = import.meta.env.DEV ? onPreviewClose : undefined;
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [failed, setFailed] = useState(false);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		if (!container) return;
		let cancelled = false;
		setFailed(false);
		setLoaded(false);
		const timer = setTimeout(() => { if (!cancelled) setFailed(true); }, 25_000);
		const onMessage = (event: MessageEvent) => {
			const frame = container.querySelector('iframe');
			if (!frame || event.source !== frame.contentWindow || event.origin !== 'https://calendly.com') return;
			if (typeof event.data?.event === 'string' && event.data.event.startsWith('calendly.')) {
				clearTimeout(timer);
				setLoaded(true);
				setFailed(false);
			}
			if (isBookingConfirmation(event, frame.contentWindow)) onBooked();
		};
		window.addEventListener('message', onMessage);
		void loadCalendly().then((api) => {
			if (!cancelled) api.initInlineWidget({url: CALENDLY_URL, parentElement: container, prefill: {name: userName}});
		}).catch(() => { if (!cancelled) setFailed(true); });
		return () => {
			cancelled = true;
			clearTimeout(timer);
			window.removeEventListener('message', onMessage);
			container.replaceChildren();
		};
	}, [container, attempt, userName, onBooked]);

	return (
		<DialogPrimitive.Root open onOpenChange={(open) => { if (!open) closePreview?.(); }}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
				<DialogPrimitive.Content
					onEscapeKeyDown={(event) => { if (!closePreview) event.preventDefault(); }}
					onInteractOutside={(event) => event.preventDefault()}
					className="fixed left-1/2 top-1/2 z-50 flex max-h-[94dvh] w-[calc(100%-1rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-2xl sm:w-[calc(100%-3rem)] lg:flex-row"
				>
					<div className="shrink-0 border-b bg-muted/40 p-5 sm:p-7 lg:w-80 lg:border-r lg:border-b-0">
						<div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="size-6" /></div>
						{closePreview && (
							<Button variant="outline" size="sm" className="mb-4" onClick={closePreview}>
								Close preview
							</Button>
						)}
						<p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Your next step</p>
						<DialogPrimitive.Title className="text-2xl font-semibold tracking-tight">Let’s build your success</DialogPrimitive.Title>
						<DialogPrimitive.Description className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground" asChild>
							<div>
								<p>Please book a call with <strong className="font-semibold text-foreground">Chris George</strong>, your Client Success Manager, who is here to help you improve and succeed through call listening, personalized coaching, and ongoing development.</p>
								<p>The goal is to help you strengthen your approach, overcome challenges, and get the most out of your experience with Policy Printer.</p>
							</div>
						</DialogPrimitive.Description>
						<p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">Choose a time and confirm your booking to continue using the dialer.</p>
					</div>
					<div className="min-w-0 flex-1 bg-white">
						{(!loaded || failed) && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted p-4 text-sm text-foreground">
							<span>{failed ? 'The booking calendar is taking longer to load. Please retry.' : 'Loading your booking calendar…'}</span>
							{failed && <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="size-4" /> Retry calendar</Button>}
						</div>}
						<div ref={setContainer} className="h-[700px] min-w-[300px]" />
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
