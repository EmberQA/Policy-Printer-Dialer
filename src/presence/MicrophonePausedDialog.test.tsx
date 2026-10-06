import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MicrophonePausedDialog, type MicrophonePauseNotice} from './MicrophonePausedDialog';

const renderActive = (notice: MicrophonePauseNotice | null) => renderToStaticMarkup(
	<MicrophonePausedDialog notice={notice} callInProgress onDismiss={() => {}} onRetry={() => {}} />
);

describe('microphone notice during a call', () => {
	it.each(['pausing', 'paused', 'failed'] as const)('keeps controls accessible while %s', state => {
		const html = renderActive({reason: 'disconnected', state});
		expect(html).toContain('role="alert"');
		expect(html).toContain('Microphone disconnected.');
		expect(html).toContain('Audio Setup');
		expect(html).not.toContain('role="dialog"');
		expect(html).not.toContain('fixed');
		expect(html).not.toContain('Got it');
		if (state === 'paused') expect(html).toContain('New calls are paused.');
		else expect(html).not.toContain('New calls are paused.');
		if (state === 'failed') expect(html).toContain('Retry pause');
	});
	it('does not warn during a healthy call', () => {
		expect(renderActive(null)).toBe('');
	});
});
