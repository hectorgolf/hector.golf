/**
 * Gets the given date in ISO format (yyyy-mm-dd).
 *
 * @param date The `Date` object to convert to an ISO format `string`.
 * @returns The date in ISO format (yyyy-mm-dd) or an empty string if the provided date was `undefined`.
 */
export const isoDate = (date: Date|undefined): string => date?.toISOString()?.slice(0, 10) || '';

/**
 * Get the current date in ISO format (yyyy-mm-dd)
 * @returns the current date in ISO format (yyyy-mm-dd)
 */
export const isoDateToday = (): string => {
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    return isoDate(now)
}

export function parseEventDateRange(dateRange: string): { startDate: Date; endDate: Date } | null {
	const months = [
		"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December"
	];

	// Regex to match patterns like "2024" (e.g. for a matchplay event with no specific dates – at least until the winner is known)
	const singleYearRegex = /^(\d{4})$/;
	// Regex to match patterns like "July 28, 2024"
	const singleDateRegex = /^(\w+)\s(\d+),\s(\d{4})$/;
	// Regex to match patterns like "September 25-28, 2024"
	const singleMonthRegex = /^(\w+)\s(\d+)\s*-\s*(\d+),\s(\d{4})$/;
	// Regex to match patterns like "September 30 - October 2, 2024"
	const twoMonthRegex = /^(\w+)\s(\d+)\s*-\s*(\w+)\s(\d+),\s(\d{4})$/;

	let match;

	if ((match = dateRange.match(singleMonthRegex))) {
		// "September 25-28, 2024"
		const [, month, startDay, endDay, year] = match;
		const monthIndex = months.indexOf(month);

		if (monthIndex === -1) return null;

		const startDate = new Date(parseInt(year), monthIndex, parseInt(startDay), 12, 0, 0);
		const endDate = new Date(parseInt(year), monthIndex, parseInt(endDay), 12, 0, 0);

		return { startDate, endDate };
	} else if ((match = dateRange.match(twoMonthRegex))) {
		// "September 30 - October 2, 2024"
		const [, startMonth, startDay, endMonth, endDay, year] = match;
		const startMonthIndex = months.indexOf(startMonth);
		const endMonthIndex = months.indexOf(endMonth);

		if (startMonthIndex === -1 || endMonthIndex === -1) return null;

		const startDate = new Date(parseInt(year), startMonthIndex, parseInt(startDay), 12, 0, 0);
		const endDate = new Date(parseInt(year), endMonthIndex, parseInt(endDay), 12, 0, 0);

		return { startDate, endDate };
	} else if ((match = dateRange.match(singleDateRegex))) {
		// "September 30, 2024"
		const [, month, day, year] = match;
		const monthIndex = months.indexOf(month);
		if (monthIndex === -1) return null;
		const startDate = new Date(parseInt(year), monthIndex, parseInt(day), 12, 0, 0);
		return { startDate, endDate: startDate };
	} else if ((match = dateRange.match(singleYearRegex))) {
		// "2024"
		const [, year] = match;
		const startDate = new Date(parseInt(year), 0, 1, 12, 12, 0, 0);
		const endDate = new Date(parseInt(year), 11, 31, 12, 12, 0, 0);
		return { startDate, endDate };
	}

	// If the format does not match, return null
	return null;
}
