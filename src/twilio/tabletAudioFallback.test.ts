import {describe, expect, it} from 'vitest';
import {
	canUseTabletAudioFallback,
	hasSpeechLevelMicActivity,
	INITIAL_TABLET_AUDIO_EVIDENCE,
	isTabletBrowser,
	tabletAudioEvidenceReducer,
	type TabletAudioEvidence
} from './tabletAudioFallback';

describe('isTabletBrowser', () => {
	it.each([
		[
			'iPad',
			'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
			5,
			true
		],
		[
			'iPadOS desktop user agent',
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
			5,
			true
		],
		[
			'Android tablet',
			'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
			5,
			true
		],
		[
			'Android phone',
			'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36',
			5,
			false
		],
		[
			'desktop Chrome',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
			0,
			false
		],
		[
			'touch laptop',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Touch) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
			10,
			false
		]
	])('detects %s correctly', (_name, userAgent, maxTouchPoints, expected) => {
		expect(isTabletBrowser(userAgent, maxTouchPoints)).toBe(expected);
	});
});

describe('tablet microphone evidence', () => {
	it.each([
		[0, false],
		[1, false],
		[2, false],
		[3, true],
		[8, true]
	])('requires speech-level meter movement for %i segments', (segments, expected) => {
		expect(hasSpeechLevelMicActivity(segments)).toBe(expected);
	});
});

describe('tablet audio fallback eligibility', () => {
	const completeEvidence: TabletAudioEvidence = {
		microphoneActivityDetected: true,
		speakerTestCompleted: true
	};

	it.each([
		['no echo failure', true, false, completeEvidence, false],
		[
			'neither check',
			true,
			true,
			INITIAL_TABLET_AUDIO_EVIDENCE,
			false
		],
		[
			'microphone only',
			true,
			true,
			{microphoneActivityDetected: true, speakerTestCompleted: false},
			false
		],
		[
			'speaker only',
			true,
			true,
			{microphoneActivityDetected: false, speakerTestCompleted: true},
			false
		],
		['both checks on a tablet', true, true, completeEvidence, true],
		['both checks on a non-tablet', false, true, completeEvidence, false]
	])(
		'returns the expected result for %s',
		(_name, isTablet, echoFailed, evidence, expected) => {
			expect(
				canUseTabletAudioFallback({isTablet, echoFailed, evidence})
			).toBe(expected);
		}
	);

	it('resets only microphone evidence when the input changes', () => {
		expect(
			tabletAudioEvidenceReducer(completeEvidence, {
				type: 'inputDeviceChanged'
			})
		).toEqual({
			microphoneActivityDetected: false,
			speakerTestCompleted: true
		});
	});

	it('resets only speaker evidence when the output changes', () => {
		expect(
			tabletAudioEvidenceReducer(completeEvidence, {
				type: 'outputDeviceChanged'
			})
		).toEqual({
			microphoneActivityDetected: true,
			speakerTestCompleted: false
		});
	});

	it('resets both checks for a new dialog session', () => {
		expect(
			tabletAudioEvidenceReducer(completeEvidence, {type: 'sessionReset'})
		).toEqual(INITIAL_TABLET_AUDIO_EVIDENCE);
	});
});
