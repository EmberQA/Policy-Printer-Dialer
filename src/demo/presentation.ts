import {getUser} from '@/auth/session';
import {isPlainBranding} from '@/branding';
import {isVerifiedDemoUser} from './scope';

export const neutralDemo = () =>
	typeof window !== 'undefined' &&
	isVerifiedDemoUser(getUser()) &&
	isPlainBranding();
export const demoCopy = (text: string) =>
	neutralDemo()
		? text
				.replace(/Policy Printer/g, 'Top Rank')
				.replace(/Printer Points/g, 'Points')
		: text;
