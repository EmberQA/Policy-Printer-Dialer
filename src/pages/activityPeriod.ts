export type ActivitySummaryPeriod = 'day' | 'week' | 'month';

export interface ActivityPeriodBounds {
	startedAt: string;
	endedAt: string;
	label: string;
}

const shortDate = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric'
});
const monthDate = new Intl.DateTimeFormat(undefined, {
	month: 'long',
	year: 'numeric'
});

/**
 * Local calendar boundaries serialized as absolute instants. This intentionally
 * produces 23/25-hour days across DST rather than forcing a rolling 24 hours.
 */
export function getActivityPeriodBounds(
	period: ActivitySummaryPeriod,
	now = new Date()
): ActivityPeriodBounds {
	let start: Date;
	let end: Date;
	let label: string;

	if (period === 'day') {
		start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
		label = `Today · ${shortDate.format(start)}`;
	} else if (period === 'week') {
		const daysSinceMonday = (now.getDay() + 6) % 7;
		start = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() - daysSinceMonday
		);
		end = new Date(
			start.getFullYear(),
			start.getMonth(),
			start.getDate() + 7
		);
		const lastDay = new Date(
			end.getFullYear(),
			end.getMonth(),
			end.getDate() - 1
		);
		label = `This week · ${shortDate.format(start)}–${shortDate.format(lastDay)}`;
	} else {
		start = new Date(now.getFullYear(), now.getMonth(), 1);
		end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
		label = `This month · ${monthDate.format(start)}`;
	}

	return {
		startedAt: start.toISOString(),
		endedAt: end.toISOString(),
		label
	};
}
