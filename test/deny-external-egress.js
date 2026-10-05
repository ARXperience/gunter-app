/* Test-only preload. Denies HTTP(S) destinations outside IPv4 loopback in this process. */
const http = require('node:http');
const https = require('node:https');
const nativeFetch = global.fetch;
const nativeHttpRequest = http.request;
const nativeHttpGet = http.get;
function allowed(input) {
    try {
        const target = typeof input === 'string' || input instanceof URL ? input : input?.href ||
            `${input?.protocol || 'http:'}//${input?.hostname || input?.host || ''}${input?.path || '/'}`;
        return new URL(target).hostname === '127.0.0.1';
    } catch { return false; }
}
global.fetch = (input, init) => allowed(input) ? nativeFetch(input, init) : Promise.reject(new Error('EGRESS_BLOCKED'));
http.request = function (input, ...rest) {
    if (!allowed(input)) throw new Error('EGRESS_BLOCKED');
    return nativeHttpRequest.call(this, input, ...rest);
};
http.get = function (input, ...rest) {
    if (!allowed(input)) throw new Error('EGRESS_BLOCKED');
    return nativeHttpGet.call(this, input, ...rest);
};
https.request = () => { throw new Error('EGRESS_BLOCKED'); };
https.get = () => { throw new Error('EGRESS_BLOCKED'); };
