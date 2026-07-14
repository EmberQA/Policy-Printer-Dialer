/**
 * Phone-number helpers shared across the dialer FE (dialpad + click-to-dial).
 */

/**
 * Normalize a typed/stored number to canonical NANP +1XXXXXXXXXX, or null if it
 * isn't a valid US/CA number. Mirrors the backend's normalizeToNanpE164 so a UI
 * gate (dialpad Call button, click-to-dial icon) matches what the server accepts
 * (the server re-validates — this is just UX). NANP: area-code + exchange leading
 * digits are both 2–9. `*`/`#` and other non-digits are stripped.
 */
export function normalizeDialInput(raw: string): string | null {
	let digits = raw.replace(/\D/g, '');
	if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
	if (digits.length !== 10) return null;
	if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
	return `+1${digits}`;
}

export interface UsPhoneState {
	code: string;
	name: string;
}

/**
 * Geographic US area codes currently in service, grouped by postal abbreviation.
 * Source: NANPA's public NPA report (US, geographic, in-service rows), 2026-07-13.
 * Non-geographic codes and Canadian NANP codes are intentionally absent.
 */
const AREA_CODES_BY_US_JURISDICTION: Readonly<Record<string, string>> = {
	AK: '907',
	AL: '205 251 256 334 483 659 938',
	AR: '327 479 501 870',
	AS: '684',
	AZ: '480 520 602 623 928',
	CA: '209 213 279 310 323 341 350 357 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 738 747 760 805 818 820 831 837 840 858 909 916 925 949 951',
	CO: '303 719 720 748 970 983',
	CT: '203 475 860 959',
	DC: '202 771',
	DE: '302',
	FL: '239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954',
	GA: '229 404 470 478 678 706 762 770 912 943',
	GU: '671',
	HI: '808',
	IA: '319 515 563 641 712',
	ID: '208 986',
	IL: '217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872',
	IN: '219 260 317 463 574 765 812 930',
	KS: '316 620 785 913',
	KY: '270 364 502 606 859',
	LA: '225 318 337 457 504 985',
	MA: '339 351 413 508 617 774 781 857 978',
	MD: '227 240 301 410 443 667',
	ME: '207',
	MI: '231 248 269 313 517 586 616 679 734 810 906 947 989',
	MN: '218 320 507 612 651 763 924 952',
	MO: '235 314 417 557 573 636 660 816 975',
	MP: '670',
	MS: '228 471 601 662 769',
	MT: '406',
	NC: '252 336 472 704 743 828 910 919 980 984',
	ND: '701',
	NE: '308 402 531',
	NH: '603',
	NJ: '201 551 609 640 732 848 856 862 908 973',
	NM: '505 575',
	NV: '702 725 775',
	NY: '212 315 329 332 347 363 465 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934',
	OH: '216 220 234 283 326 330 380 419 436 440 513 567 614 740 937',
	OK: '405 539 572 580 918',
	OR: '458 503 541 971',
	PA: '215 223 267 272 412 445 484 570 582 610 717 724 814 835 878',
	PR: '787 939',
	RI: '401',
	SC: '803 821 839 843 854 864',
	SD: '605',
	TN: '423 615 629 729 731 865 901 931',
	TX: '210 214 254 281 325 346 361 409 430 432 469 512 621 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979',
	UT: '385 435 801',
	VA: '276 434 540 571 686 703 757 804 826 948',
	VI: '340',
	VT: '802',
	WA: '206 253 360 425 509 564',
	WI: '262 274 353 414 534 608 715 920',
	WV: '304 681',
	WY: '307'
};

const US_JURISDICTION_NAMES: Readonly<Record<string, string>> = {
	AK: 'Alaska', AL: 'Alabama', AR: 'Arkansas', AS: 'American Samoa',
	AZ: 'Arizona', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
	DC: 'District of Columbia', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
	GU: 'Guam', HI: 'Hawaii', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois',
	IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
	MA: 'Massachusetts', MD: 'Maryland', ME: 'Maine', MI: 'Michigan',
	MN: 'Minnesota', MO: 'Missouri', MP: 'Northern Mariana Islands',
	MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota',
	NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
	NV: 'Nevada', NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
	PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
	SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
	UT: 'Utah', VA: 'Virginia', VI: 'U.S. Virgin Islands', VT: 'Vermont',
	WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming'
};

const AREA_CODE_TO_US_JURISDICTION = new Map<string, string>(
	Object.entries(AREA_CODES_BY_US_JURISDICTION).flatMap(([stateCode, codes]) =>
		codes.split(' ').map((areaCode) => [areaCode, stateCode] as const)
	)
);

/** Infer the number's assigned US state/jurisdiction from its geographic area code. */
export function inferUsStateFromPhone(raw: string): UsPhoneState | null {
	const normalized = normalizeDialInput(raw);
	if (!normalized) return null;
	const stateCode = AREA_CODE_TO_US_JURISDICTION.get(normalized.slice(2, 5));
	if (!stateCode) return null;
	return {code: stateCode, name: US_JURISDICTION_NAMES[stateCode]};
}

/**
 * Produce a form-safe state value. Text-like fields receive `State Name (CODE)`;
 * option fields receive the configured value whose value or label matches either
 * the postal code or full state name. An incompatible option list is left blank.
 */
export function stateFormValueFromPhone(
	raw: string,
	options?: ReadonlyArray<{value: string; label: string}>
): string | null {
	const state = inferUsStateFromPhone(raw);
	if (!state) return null;
	if (!options?.length) return `${state.name} (${state.code})`;

	const matches = new Set([state.code.toLowerCase(), state.name.toLowerCase()]);
	const option = options.find(
		(candidate) =>
			matches.has(candidate.value.trim().toLowerCase()) ||
			matches.has(candidate.label.trim().toLowerCase())
	);
	return option?.value ?? null;
}
