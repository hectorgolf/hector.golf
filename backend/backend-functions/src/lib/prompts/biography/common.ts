export type EventNameAndYear = {
    name: string;
    year: number;
};

export type NextEvent = EventNameAndYear & {
    participates: boolean;
};

export type PlayerBiographyInput = {
    name: string;
    gender: "male" | "female";
    homeClub: string;
    miscellaneousDetails: string[];
    previousAppearances: EventNameAndYear[];
    hectorWins: EventNameAndYear[];
    victorWins: EventNameAndYear[];
    allPastEvents: EventNameAndYear[];
    nextEvent: NextEvent | undefined;
    retired: boolean;
};

export function describeEvent(event: EventNameAndYear): string {
    return `${event.name} (${event.year})`;
}

export function nth(n: number, short: boolean = false): string {
    if (!short) {
        if (n === 1) {
            return "first";
        } else if (n === 2) {
            return "second";
        } else if (n === 3) {
            return "third";
        } else if (n === 4) {
            return "fourth";
        } else if (n === 5) {
            return "fifth";
        } else if (n === 6) {
            return "sixth";
        } else if (n === 7) {
            return "seventh";
        } else if (n === 8) {
            return "eighth";
        } else if (n === 9) {
            return "ninth";
        } else if (n === 10) {
            return "tenth";
        }
    }
    const lastDigit = n.toString().slice(-1);
    if (lastDigit === "1") {
        return `${n}st`;
    } else if (lastDigit === "2") {
        return `${n}nd`;
    } else if (lastDigit === "3") {
        return `${n}rd`;
    } else {
        return `${n}th`;
    }
}
