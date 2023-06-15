/** @constructor Ciphertext is corrupt. */
export class corrupt {
    constructor(public message: string) {
    }
    toString() { return `CORRUPT: ${this.message}`; }
}

/** @constructor Invalid parameter. */
export class invalid {
    constructor(public message: string) {
    }
    toString() { return `INVALID: ${this.message}`; }
}

/** @constructor Bug or missing feature in SJCL. @constructor */
export class bug {
    constructor(public message: string) {
    }
    toString() { return "BUG: " + this.message; }
}

/** @constructor Something isn't ready. */
export class notReady {
    constructor(public message: string) {
    }
    toString() { return "NOT READY: " + this.message; }
}
