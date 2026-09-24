/**
 * ENG-248: register / edit / verify the mobile number lead-won texts go to.
 *
 * Two steps in one dialog — `phone` (enter a number, "Send code") and `code`
 * (enter the 6 digits, "Verify"). It opens straight on the code step when the
 * summary says a code is still live, so an agent who closed the dialog to read
 * the text is not asked for their number again. "Use a different number" goes
 * back to the phone step; sending to a NEW number is the "edit": the backend
 * clears verification, lead texts stop and new orders are blocked until the new
 * number is confirmed. Built on radix-ui's Dialog inline like LeadOrderDialog.
 */

import {useEffect, useRef, useState} from 'react';
import {Loader2, X} from 'lucide-react';
import {Dialog as DialogPrimitive} from 'radix-ui';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
	startSmsVerification,
	verifySmsCode,
	type SmsContactSummary
} from '@/lib/api';
import {readError} from '@/lib/errors';
import {
	formatSmsPhone,
	hasLiveCode,
	validateCodeInputClient,
	validatePhoneInputClient
} from './smsContact';

type Step = 'phone' | 'code';

export function SmsContactDialog({
	open,
	contact,
	onClose,
	onVerified
}: {
	open: boolean;
	/** The summary's contact, so the dialog can resume on the code step. */
	contact: SmsContactSummary | null;
	onClose: () => void;
	/** Called once the number is verified; the parent reloads the summary. */
	onVerified: () => void;
}) {
	const [step, setStep] = useState<Step>('phone');
	const [phone, setPhone] = useState('');
	/** The number a code was sent to this session (E.164), shown on the code step. */
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	// Re-seed on OPEN only: resume on the code step when a code is still live.
	// `contact` is read through a ref because the parent's summary (and so this
	// object) is replaced by every background reload — the new-lead poll fires
	// one — and re-seeding on that would wipe whatever the agent is typing.
	const contactRef = useRef(contact);
	contactRef.current = contact;
	useEffect(() => {
		if (!open) return;
		const current = contactRef.current;
		setError(null);
		setNotice(null);
		setCode('');
		setBusy(false);
		if (hasLiveCode(current, Date.now())) {
			setSentTo(current!.phone_number);
			setPhone(current!.phone_number);
			setStep('code');
		} else {
			setSentTo(null);
			setPhone(current?.phone_number ?? '');
			setStep('phone');
		}
	}, [open]);

	const sendCode = async (raw: string) => {
		const parsed = validatePhoneInputClient(raw);
		if (!parsed.ok) {
			setError(parsed.message);
			return;
		}
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const res = await startSmsVerification(parsed.value);
			if (res.statusCode !== 'SP100') {
				setError(res.statusMessage || 'Could not send the code');
				// A carrier failure still leaves the number pending — let them retry
				// from the code step's Resend rather than retyping.
				if (res.sms_contact && !res.sms_contact.verified) {
					setSentTo(res.sms_contact.phone_number);
				}
				return;
			}
			setSentTo(parsed.value);
			setCode('');
			setStep('code');
			setNotice(`Code sent to ${formatSmsPhone(parsed.value)}`);
		} catch (err) {
			setError(readError(err, 'Could not send the code'));
		} finally {
			setBusy(false);
		}
	};

	const verify = async () => {
		const parsed = validateCodeInputClient(code);
		if (!parsed.ok) {
			setError(parsed.message);
			return;
		}
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const res = await verifySmsCode(parsed.value);
			if (res.statusCode !== 'SP100') {
				setError(res.statusMessage || 'Could not verify the code');
				return;
			}
			onVerified();
		} catch (err) {
			setError(readError(err, 'Could not verify the code'));
		} finally {
			setBusy(false);
		}
	};

	const clientPhoneProblem =
		step === 'phone' && phone.trim() ? validatePhoneInputClient(phone) : null;
	const clientCodeProblem =
		step === 'code' && code.trim() ? validateCodeInputClient(code) : null;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
					<div className="flex items-start justify-between gap-3">
						<div className="space-y-1">
							<DialogPrimitive.Title className="text-lg font-semibold">
								{step === 'phone' ? 'Lead alerts by text' : 'Enter your code'}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="text-sm text-muted-foreground">
								{step === 'phone'
									? "When you win a lead we'll text you their details so you can call right from your phone. We'll send a code to confirm the number."
									: `We texted a 6-digit code to ${sentTo ? formatSmsPhone(sentTo) : 'your phone'}. It expires in 10 minutes.`}
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-8 shrink-0"
								aria-label="Close"
							>
								<X className="size-4" />
							</Button>
						</DialogPrimitive.Close>
					</div>

					{step === 'phone' ? (
						<form
							className="space-y-1.5"
							onSubmit={(e) => {
								e.preventDefault();
								void sendCode(phone);
							}}
						>
							<Label htmlFor="sms-contact-phone">Mobile number</Label>
							<Input
								id="sms-contact-phone"
								type="tel"
								autoComplete="tel"
								inputMode="tel"
								placeholder="(972) 555-0123"
								value={phone}
								disabled={busy}
								autoFocus
								onChange={(e) => setPhone(e.target.value)}
							/>
							{contact?.verified && (
								<p className="text-xs text-muted-foreground">
									Sending a code to a different number replaces{' '}
									{formatSmsPhone(contact.phone_number)} — texts stop and new
									orders wait until the new number is verified.
								</p>
							)}
						</form>
					) : (
						<form
							className="space-y-1.5"
							onSubmit={(e) => {
								e.preventDefault();
								void verify();
							}}
						>
							<Label htmlFor="sms-contact-code">Code</Label>
							<Input
								id="sms-contact-code"
								type="text"
								inputMode="numeric"
								autoComplete="one-time-code"
								placeholder="123456"
								maxLength={7}
								className="font-mono text-lg tracking-[0.3em]"
								value={code}
								disabled={busy}
								autoFocus
								onChange={(e) => setCode(e.target.value)}
							/>
							<div className="flex flex-wrap gap-x-3 text-xs">
								<button
									type="button"
									className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
									disabled={busy || !sentTo}
									onClick={() => sentTo && void sendCode(sentTo)}
								>
									Resend code
								</button>
								<button
									type="button"
									className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
									disabled={busy}
									onClick={() => {
										setStep('phone');
										setError(null);
										setNotice(null);
									}}
								>
									Use a different number
								</button>
							</div>
						</form>
					)}

					<div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 text-sm text-muted-foreground">
							{error ? (
								<span className="text-destructive">{error}</span>
							) : notice ? (
								<span>{notice}</span>
							) : clientPhoneProblem && !clientPhoneProblem.ok ? (
								<span>{clientPhoneProblem.message}</span>
							) : clientCodeProblem && !clientCodeProblem.ok ? (
								<span>{clientCodeProblem.message}</span>
							) : null}
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Button type="button" variant="outline" disabled={busy} onClick={onClose}>
								Cancel
							</Button>
							{step === 'phone' ? (
								<Button
									type="button"
									variant="success"
									disabled={busy || !phone.trim() || (clientPhoneProblem !== null && !clientPhoneProblem.ok)}
									onClick={() => void sendCode(phone)}
								>
									{busy && <Loader2 className="size-4 animate-spin" />}
									{busy ? 'Sending…' : 'Send code'}
								</Button>
							) : (
								<Button
									type="button"
									variant="success"
									disabled={busy || !code.trim() || (clientCodeProblem !== null && !clientCodeProblem.ok)}
									onClick={() => void verify()}
								>
									{busy && <Loader2 className="size-4 animate-spin" />}
									{busy ? 'Verifying…' : 'Verify'}
								</Button>
							)}
						</div>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
