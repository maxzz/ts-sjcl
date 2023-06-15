//export interface BitArray extends Array<number> { }

export class BitArray extends Array<number> {
    /**
     * Array slices in units of bits.
     * @param {bitArray} a The array to slice.
     * @param {Number} bstart The offset to the start of the slice, in bits.
     * @param {Number} bend The offset to the end of the slice, in bits.  If this is undefined,
     * slice until the end of the array.
     * @return {bitArray} The requested slice.
     */
    static bitSlice(a: BitArray, bstart: number, bend: number): BitArray {
        a = this._shiftRight(a.slice(bstart / 32), 32 - (bstart & 31)).slice(1);
        return (bend === undefined) ? a : this.clamp(a, bend - bstart);
    }
    /**
     * Extract a number packed into a bit array.
     * @param {bitArray} a The array to slice.
     * @param {Number} bstart The offset to the start of the slice, in bits.
     * @param {Number} length The length of the number to extract.
     * @return {Number} The requested slice.
     */
    static extract(a: BitArray, bstart: number, blength: number): number {
        // FIXME: this Math.floor is not necessary at all, but for some reason
        // seems to suppress a bug in the Chromium JIT.
        var x, sh = Math.floor((-bstart - blength) & 31);
        if ((bstart + blength - 1 ^ bstart) & -32) {
            // it crosses a boundary
            x = (a[bstart / 32 | 0] << (32 - sh)) ^ (a[bstart / 32 + 1 | 0] >>> sh);
        }
        else {
            // within a single word
            x = a[bstart / 32 | 0] >>> sh;
        }
        return x & ((1 << blength) - 1);
    }
    /**
     * Concatenate two bit arrays.
     * @param {bitArray} a1 The first array.
     * @param {bitArray} a2 The second array.
     * @return {bitArray} The concatenation of a1 and a2.
     */
    static concat(a1: BitArray, a2: BitArray): BitArray {
        if (a1.length === 0 || a2.length === 0) {
            return a1.concat(a2);
        }
        var last = a1[a1.length - 1], shift = this.getPartial(last);
        if (shift === 32) {
            return a1.concat(a2);
        }
        else {
            return this._shiftRight(a2, shift, last | 0, a1.slice(0, a1.length - 1));
        }
    }
    /**
     * Find the length of an array of bits.
     * @param {bitArray} a The array.
     * @return {Number} The length of a, in bits.
     */
    static bitLength(a: BitArray): number {
        var l = a.length, x;
        if (l === 0) {
            return 0;
        }
        x = a[l - 1];
        return (l - 1) * 32 + this.getPartial(x);
    }
    /**
     * Truncate an array.
     * @param {bitArray} a The array.
     * @param {Number} len The length to truncate to, in bits.
     * @return {bitArray} A new array, truncated to len bits.
     */
    static clamp(a: BitArray, len: number): BitArray {
        if (a.length * 32 < len) {
            return a;
        }
        a = a.slice(0, Math.ceil(len / 32));
        var l = a.length;
        len = len & 31;
        if (l > 0 && len) {
            a[l - 1] = this.partial(len, a[l - 1] & 0x80000000 >> (len - 1), 1);
        }
        return a;
    }
    /**
     * Make a partial word for a bit array.
     * @param {Number} len The number of bits in the word.
     * @param {Number} x The bits.
     * @param {Number} [0] _end Pass 1 if x has already been shifted to the high side.
     * @return {Number} The partial word.
     */
    static partial(len: number, x: number, _end?: number): number {
        if (len === 32) {
            return x;
        }
        return (_end ? x | 0 : x << (32 - len)) + len * 0x10000000000;
    }
    /**
     * Get the number of bits used by a partial word.
     * @param {Number} x The partial word.
     * @return {Number} The number of bits used by the partial word.
     */
    static getPartial(x: number): number {
        return Math.round(x / 0x10000000000) || 32;
    }
    /**
     * Compare two arrays for equality in a predictable amount of time.
     * @param {bitArray} a The first array.
     * @param {bitArray} b The second array.
     * @return {boolean} true if a == b; false otherwise.
     */
    static equal(a: BitArray, b: BitArray): boolean {
        if (this.bitLength(a) !== this.bitLength(b)) {
            return false;
        }
        var x = 0, i;
        for (i = 0; i < a.length; i++) {
            x |= a[i] ^ b[i];
        }
        return (x === 0);
    }
    /** Shift an array right.
     * @param {bitArray} a The array to shift.
     * @param {Number} shift The number of bits to shift.
     * @param {Number} [carry=0] A byte to carry in
     * @param {bitArray} [out=[]] An array to prepend to the output.
     * @private
     */
    static _shiftRight(a: BitArray, shift: number, carry?: number, out?: BitArray): BitArray {
        var i, last2 = 0, shift2;
        if (out === undefined) {
            out = [];
        }
        for (; shift >= 32; shift -= 32) {
            out.push(carry as number);
            carry = 0;
        }
        if (shift === 0) {
            return out.concat(a);
        }
        for (i = 0; i < a.length; i++) {
            out.push((carry as number) | a[i] >>> shift);
            carry = a[i] << (32 - shift);
        }
        last2 = a.length ? a[a.length - 1] : 0;
        shift2 = this.getPartial(last2);
        out.push(this.partial(shift + shift2 & 31, ((shift + shift2 > 32) ? carry : out.pop())!, 1));
        return out;
    }
    /** xor a block of 4 words together.
     * @private
     */
    static _xor4(x: number[], y: number[]): number[] {
        return [x[0] ^ y[0], x[1] ^ y[1], x[2] ^ y[2], x[3] ^ y[3]];
    }
    /** byteswap a word array inplace.
     * (does not handle partial words)
     * @param {sjcl.bitArray} a word array
     * @return {sjcl.bitArray} byteswapped array
     */
    static byteswapM(a: BitArray): BitArray {
        var i, v, m = 0xff00;
        for (i = 0; i < a.length; ++i) {
            v = a[i];
            a[i] = (v >>> 24) | ((v >>> 8) & m) | ((v & m) << 8) | (v << 24);
        }
        return a;
    }
}
