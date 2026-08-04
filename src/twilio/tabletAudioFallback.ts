export interface TabletAudioEvidence {
	microphoneActivityDetected: boolean;
	speakerTestCompleted: boolean;
}

export const TABLET_MIC_ACTIVITY_MIN_SEGMENTS = 3;

export function hasSpeechLevelMicActivity(segments: number): boolean {
	return segments >= TABLET_MIC_ACTIVITY_MIN_SEGMENTS;
}

export const INITIAL_TABLET_AUDIO_EVIDENCE: TabletAudioEvidence = {
	microphoneActivityDetected: false,
	speakerTestCompleted: false
};

export type TabletAudioEvidenceAction =
	| {type: 'microphoneActivityDetected'}
	| {type: 'speakerTestCompleted'}
	| {type: 'speakerTestStarted'}
	| {type: 'inputDeviceChanged'}
	| {type: 'outputDeviceChanged'}
	| {type: 'sessionReset'};

export function tabletAudioEvidenceReducer(
	state: TabletAudioEvidence,
	action: TabletAudioEvidenceAction
): TabletAudioEvidence {
	switch (action.type) {
		case 'microphoneActivityDetected':
			return state.microphoneActivityDetected
				? state
				: {...state, microphoneActivityDetected: true};
		case 'speakerTestCompleted':
			return state.speakerTestCompleted
				? state
				: {...state, speakerTestCompleted: true};
		case 'speakerTestStarted':
		case 'outputDeviceChanged':
			return {...state, speakerTestCompleted: false};
		case 'inputDeviceChanged':
			return {...state, microphoneActivityDetected: false};
		case 'sessionReset':
			return INITIAL_TABLET_AUDIO_EVIDENCE;
	}
}

export function isTabletBrowser(
	userAgent: string,
	maxTouchPoints: number
): boolean {
	if (/iPad/i.test(userAgent)) return true;
	if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return true;
	return /Android/i.test(userAgent) && !/Mobile/i.test(userAgent);
}

export function canUseTabletAudioFallback({
	isTablet,
	echoFailed,
	evidence
}: {
	isTablet: boolean;
	echoFailed: boolean;
	evidence: TabletAudioEvidence;
}): boolean {
	return (
		isTablet &&
		echoFailed &&
		evidence.microphoneActivityDetected &&
		evidence.speakerTestCompleted
	);
}
