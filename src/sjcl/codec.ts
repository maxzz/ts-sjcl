import { BitArray } from "./bitarray";
import * as exception from "./exception";

export interface SjclCodec<T> {
    fromBits(bits: BitArray): T;
    toBits(value: T): BitArray;
}

/** @fileOverview Bit array codec implementations.
 *
 * @author Emily Stark
 * @author Mike Hamburg
 * @author Dan Boneh
 */

/** @namespace Hexadecimal */
export class hex {
    /** Convert from a bitArray to a hex string. */
    static fromBits(arr: BitArray): string {
        var out = "", i;
        for (i = 0; i < arr.length; i++) {
            out += ((arr[i] | 0) + 0xF00000000000).toString(16).substr(4);
        }
        return out.substring(0, BitArray.bitLength(arr) / 4);//.replace(/(.{8})/g, "$1 ");
    }
    /** Convert from a hex string to a bitArray. */
    static toBits(str: string): BitArray {
        var i, out = [], len;
        str = str.replace(/\s|0x/g, "");
        len = str.length;
        str = str + "00000000";
        for (i = 0; i < str.length; i += 8) {
            out.push(parseInt(str.substr(i, 8), 16) ^ 0);
        }
        return BitArray.clamp(out, len * 4);
    }
}

/** @fileOverview Bit array codec implementations.
 *
 * @author Emily Stark
 * @author Mike Hamburg
 * @author Dan Boneh
 */

/**
 * UTF-8 strings
 * @namespace
 */
export class utf8String {
    /** Convert from a bitArray to a UTF-8 string. */
    static fromBits(arr: BitArray): string {
        var out = "", bl = BitArray.bitLength(arr), i, tmp = 0;
        for (i = 0; i < bl / 8; i++) {
            if ((i & 3) === 0) {
                tmp = arr[i / 4];
            }
            out += String.fromCharCode(tmp >>> 24);
            tmp <<= 8;
        }
        return decodeURIComponent(escape(out));
    }

    /** Convert from a UTF-8 string to a bitArray. */
    static toBits(str: string): BitArray {
        str = unescape(encodeURIComponent(str));
        var out = [], i, tmp = 0;
        for (i = 0; i < str.length; i++) {
            tmp = tmp << 8 | str.charCodeAt(i);
            if ((i & 3) === 3) {
                out.push(tmp);
                tmp = 0;
            }
        }
        if (i & 3) {
            out.push(BitArray.partial(8 * (i & 3), tmp));
        }
        return out;
    }
}

/** @fileOverview Bit array codec implementations.
 *
 * @author Emily Stark
 * @author Mike Hamburg
 * @author Dan Boneh
 */

/**
 * Base64 encoding/decoding 
 * @namespace
 */
export class base64 {
    /** The base64 alphabet.
     * @private
     */
    static _chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /** Convert from a bitArray to a base64 string. */
    static fromBits(arr: BitArray, _noEquals: boolean | number, _url?: boolean | number): string {
        var out = "", i, bits = 0, c = this._chars, ta = 0, bl = BitArray.bitLength(arr);
        if (_url) {
            c = c.substr(0, 62) + '-_';
        }
        for (i = 0; out.length * 6 < bl;) {
            out += c.charAt((ta ^ arr[i] >>> bits) >>> 26);
            if (bits < 6) {
                ta = arr[i] << (6 - bits);
                bits += 26;
                i++;
            } else {
                ta <<= 6;
                bits -= 6;
            }
        }
        while ((out.length & 3) && !_noEquals) {
            out += "=";
        }
        return out;
    }

    /** Convert from a base64 string to a bitArray */
    static toBits(str: string, _url?: boolean | number): BitArray {
        str = str.replace(/\s|=/g, '');
        var out = [], i, bits = 0, c = this._chars, ta = 0, x;
        if (_url) {
            c = c.substr(0, 62) + '-_';
        }
        for (i = 0; i < str.length; i++) {
            x = c.indexOf(str.charAt(i));
            if (x < 0) {
                throw new exception.invalid("this isn't base64!");
            }
            if (bits > 26) {
                bits -= 26;
                out.push(ta ^ x >>> bits);
                ta = x << (32 - bits);
            } else {
                bits += 6;
                ta ^= x << (32 - bits);
            }
        }
        if (bits & 56) {
            out.push(BitArray.partial(bits & 56, ta, 1));
        }
        return out;
    }
}

export class base64url {
    static fromBits(arr: BitArray): string {
        return base64.fromBits(arr, 1, 1);
    }
    static toBits(str: string): BitArray {
        return base64.toBits(str, 1);
    }
}
