/**
 * A lead form `date` answer is stored as "YYYY-MM-DD" (what the backend
 * validates). Show it the way agents read and say dates: "MM/DD/YYYY".
 * Anything else (free text, timestamps) is returned unchanged.
 */
export const isoDateToUs = (value: string): string => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	return m ? `${m[2]}/${m[3]}/${m[1]}` : value;
};
