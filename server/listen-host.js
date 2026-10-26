/* Optional binding; leave the existing deployment default unchanged. */
function configuredHost(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(value)) throw new Error('GUNTER_LISTEN_HOST_INVALID');
    return value;
}
module.exports = { configuredHost };
