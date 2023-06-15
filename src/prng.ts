import * as hash from './hash';
import * as exception from './exception';
import * as cipher from './cipher';

/** @fileOverview Random number generator.
 *
 * @author Emily Stark
 * @author Mike Hamburg
 * @author Dan Boneh
 * @author Michael Brooks
 */

/** @constructor
 * @class Random number generator
 * @description
 * <b>Use sjcl.random as a singleton for this class!</b>
 * <p>
 * This random number generator is a derivative of Ferguson and Schneier's
 * generator Fortuna.  It collects entropy from various events into several
 * pools, implemented by streaming SHA-256 instances.  It differs from
 * ordinary Fortuna in a few ways, though.
 * </p>
 *
 * <p>
 * Most importantly, it has an entropy estimator.  This is present because
 * there is a strong conflict here between making the generator available
 * as soon as possible, and making sure that it doesn't "run on empty".
 * In Fortuna, there is a saved state file, and the system is likely to have
 * time to warm up.
 * </p>
 *
 * <p>
 * Second, because users are unlikely to stay on the page for very long,
 * and to speed startup time, the number of pools increases logarithmically:
 * a new pool is created when the previous one is actually used for a reseed.
 * This gives the same asymptotic guarantees as Fortuna, but gives more
 * entropy to early reseeds.
 * </p>
 *
 * <p>
 * The entire mechanism here feels pretty klunky.  Furthermore, there are
 * several improvements that should be made, including support for
 * dedicated cryptographic functions that may be present in some browsers;
 * state files in local storage; cookies containing randomness; etc.  So
 * look for improvements in future versions.
 * </p>
 */

export class prng {
    /* private */
    private _pools = [new hash.sha256()];
    private _poolEntropy = [0];
    private _reseedCount = 0;
    private _robins: Record<string, number> = {};
    private _eventId = 0;

    private _collectorIds: Record<string, number> = {};
    private _collectorIdNext = 0;

    private _strength = 0;
    private _poolStrength = 0;
    private _nextReseed = 0;
    private _key = [0, 0, 0, 0, 0, 0, 0, 0];
    private _counter = [0, 0, 0, 0];
    private _cipher: cipher.SjclCipher | undefined = undefined;
    //private _defaultParanoia = defaultParanoia;

    /* event listener stuff */
    private _collectorsStarted = false;
    protected _callbacks: Record<string, Record<number, Function>> = { progress: {}, seeded: {} };
    private _callbackI = 0;

    /* constants */
    private _NOT_READY = 0;
    private _READY = 1;
    private _REQUIRES_RESEED = 2;

    private _MAX_WORDS_PER_BURST = 65536;
    private _PARANOIA_LEVELS = [0, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024];
    private _MILLISECONDS_PER_RESEED = 30000;
    private _BITS_PER_RESEED = 80;

    private _eventListener: Record<string, EventListenerOrEventListenerObject> = {};

    constructor(private _defaultParanoia: number) {
    }

    /** Generate several random words, and return them in an array.
     * A word consists of 32 bits (4 bytes)
     * @param {Number} nwords The number of words to generate.
     */
    randomWords(nwords: number, paranoia: number): any[] {
        var out = [], i, readiness = this.isReady(paranoia), g;

        if (readiness === this._NOT_READY) {
            throw new exception.notReady("generator isn't seeded");
        } else if (readiness & this._REQUIRES_RESEED) {
            this._reseedFromPools(!(readiness & this._READY));
        }

        for (i = 0; i < nwords; i += 4) {
            if ((i + 1) % this._MAX_WORDS_PER_BURST === 0) {
                this._gate();
            }

            g = this._gen4words();
            out.push(g[0], g[1], g[2], g[3]);
        }
        this._gate();

        return out.slice(0, nwords);
    }

    setDefaultParanoia(paranoia: number, allowZeroParanoia: string) {
        if (paranoia === 0 && allowZeroParanoia !== "Setting paranoia=0 will ruin your security; use it only for testing") {
            throw "Setting paranoia=0 will ruin your security; use it only for testing";
        }
        this._defaultParanoia = paranoia;
    }

    /**
     * Add entropy to the pools.
     * @param data The entropic value.  Should be a 32-bit integer, array of 32-bit integers, or string
     * @param {Number} estimatedEntropy The estimated entropy of data, in bits
     * @param {String} source The source of the entropy, eg "mouse"
     */
    addEntropy(data: number | number[] | string, estimatedEntropy: number, source: string) {
        source = source || "user";

        var id,
            i, tmp,
            t = (new Date()).valueOf(),
            robin = this._robins[source],
            oldReady = this.isReady(), err = 0, objName;

        id = this._collectorIds[source];
        if (id === undefined) {
            id = this._collectorIds[source] = this._collectorIdNext++;
        }

        if (robin === undefined) {
            robin = this._robins[source] = 0;
        }
        this._robins[source] = (this._robins[source] + 1) % this._pools.length;

        switch (typeof (data)) {
            case "number":
                if (estimatedEntropy === undefined) {
                    estimatedEntropy = 1;
                }
                this._pools[robin].update([id, this._eventId++, 1, estimatedEntropy, t, 1, data | 0]);
                break;

            case "object":
                objName = Object.prototype.toString.call(data);
                if (objName === "[object Uint32Array]") {
                    tmp = [];
                    for (i = 0; i < data.length; i++) {
                        tmp.push(data[i]);
                    }
                    data = tmp;
                } else {
                    if (objName !== "[object Array]") {
                        err = 1;
                    }
                    for (i = 0; i < data.length && !err; i++) {
                        if (typeof (data[i]) !== "number") {
                            err = 1;
                        }
                    }
                }
                if (!err) {
                    if (estimatedEntropy === undefined) {
                        /* horrible entropy estimator */
                        estimatedEntropy = 0;
                        for (i = 0; i < data.length; i++) {
                            tmp = data[i];
                            while (tmp > 0) {
                                estimatedEntropy++;
                                tmp = tmp >>> 1;
                            }
                        }
                    }
                    this._pools[robin].update([id, this._eventId++, 2, estimatedEntropy, t, data.length].concat(data));
                }
                break;

            case "string":
                if (estimatedEntropy === undefined) {
                    /* English text has just over 1 bit per character of entropy.
                     * But this might be HTML or something, and have far less
                     * entropy than English...  Oh well, let's just say one bit.
                     */
                    estimatedEntropy = data.length;
                }
                this._pools[robin].update([id, this._eventId++, 3, estimatedEntropy, t, data.length]);
                this._pools[robin].update(data);
                break;

            default:
                err = 1;
        }
        if (err) {
            throw new exception.bug("random: addEntropy only supports number, array of numbers or string");
        }

        /* record the new strength */
        this._poolEntropy[robin] += estimatedEntropy;
        this._poolStrength += estimatedEntropy;

        /* fire off events */
        if (oldReady === this._NOT_READY) {
            if (this.isReady() !== this._NOT_READY) {
                this._fireEvent("seeded", Math.max(this._strength, this._poolStrength));
            }
            this._fireEvent("progress", this.getProgress());
        }
    }

    /** Is the generator ready? */
    isReady(paranoia?: number) {
        var entropyRequired = this._PARANOIA_LEVELS[(paranoia !== undefined) ? paranoia : this._defaultParanoia];

        if (this._strength && this._strength >= entropyRequired) {
            return (this._poolEntropy[0] > this._BITS_PER_RESEED && (new Date()).valueOf() > this._nextReseed) ?
                this._REQUIRES_RESEED | this._READY :
                this._READY;
        } else {
            return (this._poolStrength >= entropyRequired) ?
                this._REQUIRES_RESEED | this._NOT_READY :
                this._NOT_READY;
        }
    }

    /** Get the generator's progress toward readiness, as a fraction */
    getProgress(paranoia?: number) {
        var entropyRequired = this._PARANOIA_LEVELS[paranoia ? paranoia : this._defaultParanoia];

        if (this._strength >= entropyRequired) {
            return 1.0;
        } else {
            return (this._poolStrength > entropyRequired) ?
                1.0 :
                this._poolStrength / entropyRequired;
        }
    }

    /** start the built-in entropy collectors */
    startCollectors() {
        if (this._collectorsStarted) {
            return;
        }

        if (typeof window !== 'undefined') {
            this._eventListener = {
                loadTimeCollector: this._bind(this._loadTimeCollector),
                mouseCollector: this._bind(this._mouseCollector),
                keyboardCollector: this._bind(this._keyboardCollector),
                accelerometerCollector: this._bind(this._accelerometerCollector),
                touchCollector: this._bind(this._touchCollector)
            };

            if (window.addEventListener) {
                window.addEventListener("load", this._eventListener.loadTimeCollector, false);
                window.addEventListener("keypress", this._eventListener.keyboardCollector, false);
            } else {
                throw new exception.bug("can't attach event");
            }
        }

        this._collectorsStarted = true;
    }

    /** stop the built-in entropy collectors */
    stopCollectors() {
        if (!this._collectorsStarted) {
            return;
        }

        if (typeof window !== 'undefined') {
            if (window.removeEventListener) {
                window.removeEventListener("load", this._eventListener.loadTimeCollector, false);
                window.removeEventListener("keypress", this._eventListener.keyboardCollector, false);
            }
        }

        this._collectorsStarted = false;
    }

    /* use a cookie to store entropy.
    useCookie(all_cookies) {
        throw new exception.bug("random: useCookie is unimplemented");
    }*/

    /** add an event listener for progress or seeded-ness. */
    addEventListener(name: string, callback: Function) {
        this._callbacks[name][this._callbackI++] = callback;
    }

    /** remove an event listener for progress or seeded-ness */
    removeEventListener(name: string, cb: Function) {
        var i, j, cbs = this._callbacks[name], jsTemp: any = [];

        //TODO: tm: do it in the js way. later

        /* I'm not sure if this is necessary; in C++, iterating over a
         * collection and modifying it at the same time is a no-no.
         */

        for (j in cbs) {
            if (cbs.hasOwnProperty(j) && cbs[j] === cb) {
                jsTemp.push(j);
            }
        }

        for (i = 0; i < jsTemp.length; i++) {
            j = jsTemp[i];
            delete cbs[j];
        }
    }

    _bind(func: Function) {
        var that = this;
        return function () {
            func.apply(that, arguments);
        };
    }

    /** Generate 4 random words, no reseed, no gate.
     * @private
     */
    _gen4words(): number[] {
        for (var i = 0; i < 4; i++) {
            this._counter[i] = this._counter[i] + 1 | 0;
            if (this._counter[i]) {
                break;
            }
        }
        return this._cipher?.encrypt(this._counter) || [];
    }

    /** Rekey the AES instance with itself after a request, or every _MAX_WORDS_PER_BURST words.
     * @private
     */
    _gate(): void {
        this._key = this._gen4words().concat(this._gen4words());
        this._cipher = new cipher.aes(this._key);
    }

    /** Reseed the generator with the given words
     * @private
     */
    _reseed(seedWords: number[]): void {
        this._key = hash.sha256.hash(this._key.concat(seedWords));
        this._cipher = new cipher.aes(this._key);
        for (var i = 0; i < 4; i++) {
            this._counter[i] = this._counter[i] + 1 | 0;
            if (this._counter[i]) { break; }
        }
    }

    /** reseed the data from the entropy pools
     * @param full If set, use all the entropy pools in the reseed.
     */
    _reseedFromPools(full: boolean): void {
        var reseedData = [], strength = 0, i;

        this._nextReseed = reseedData[0] =
            (new Date()).valueOf() + this._MILLISECONDS_PER_RESEED;

        for (i = 0; i < 16; i++) {
            /* On some browsers, this is cryptographically random.  So we might
             * as well toss it in the pot and stir...
             */
            reseedData.push(Math.random() * 0x100000000 | 0);
        }

        for (i = 0; i < this._pools.length; i++) {
            reseedData = reseedData.concat(this._pools[i].finalize());
            strength += this._poolEntropy[i];
            this._poolEntropy[i] = 0;

            if (!full && (this._reseedCount & (1 << i))) {
                break;
            }
        }

        /* if we used the last pool, push a new one onto the stack */
        if (this._reseedCount >= 1 << this._pools.length) {
            this._pools.push(new hash.sha256());
            this._poolEntropy.push(0);
        }

        /* how strong was this reseed? */
        this._poolStrength -= strength;
        if (strength > this._strength) {
            this._strength = strength;
        }

        this._reseedCount++;
        this._reseed(reseedData);
    }

    _keyboardCollector() {
        this._addCurrentTimeToEntropy(1);
    }

    _mouseCollector(ev: MouseEvent) {
        var x, y;

        try {
            x = ev.x || ev.clientX || ev.offsetX || 0;
            y = ev.y || ev.clientY || ev.offsetY || 0;
        } catch (err) {
            // Event originated from a secure element. No mouse position available.
            x = 0;
            y = 0;
        }

        if (x != 0 && y != 0) {
            random.addEntropy([x, y], 2, "mouse");
        }

        this._addCurrentTimeToEntropy(0);
    }

    _touchCollector(ev: TouchEvent) {
        var touch = ev.touches[0] || ev.changedTouches[0];
        var x = touch.pageX || touch.clientX,
            y = touch.pageY || touch.clientY;

        random.addEntropy([x, y], 1, "touch");

        this._addCurrentTimeToEntropy(0);
    }

    _loadTimeCollector() {
        this._addCurrentTimeToEntropy(2);
    }

    _addCurrentTimeToEntropy(estimatedEntropy: number) {
        if (typeof window !== 'undefined' && typeof window.performance?.now === "function") {
            //how much entropy do we want to add here?
            random.addEntropy(window.performance.now(), estimatedEntropy, "loadtime");
        } else {
            random.addEntropy((new Date()).valueOf(), estimatedEntropy, "loadtime");
        }
    }
    _accelerometerCollector(ev: DeviceMotionEvent) {
        var ac = ev.accelerationIncludingGravity?.x || ev.accelerationIncludingGravity?.y || ev.accelerationIncludingGravity?.z;
        if (typeof window !== 'undefined') {
            if (window.orientation) {
                var or = window.orientation;
                if (typeof or === "number") {
                    random.addEntropy(or, 1, "accelerometer");
                }
            }
        }
        if (ac) {
            random.addEntropy(ac, 2, "accelerometer");
        }
        this._addCurrentTimeToEntropy(0);
    }

    _fireEvent(name: string, arg: number): void {
        var j, cbs = random._callbacks[name], cbsTemp = [];
        /* TODO: there is a race condition between removing collectors and firing them */

        /* I'm not sure if this is necessary; in C++, iterating over a
         * collection and modifying it at the same time is a no-no.
         */

        for (j in cbs) {
            if (cbs.hasOwnProperty(j)) {
                cbsTemp.push(cbs[j]);
            }
        }

        for (j = 0; j < cbsTemp.length; j++) {
            cbsTemp[j](arg);
        }
    }

} //class prng

export const random: prng = new prng(6);

