/* Reverse geocoding: return only city; never persist coordinates or addresses. */
const cache = new Map();
let nextRequestAt = 0;
let queue = Promise.resolve();
let queued = 0;
async function reverse(value, fetcher = fetch) {
    const { latitude, longitude } = value || {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw Object.assign(new Error('invalid_coordinates'), { status: 400 });
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 86400000) return cached.value;
    if (queued >= 2) throw Object.assign(new Error('location_provider_busy'), { status: 429 });
    queued += 1;
    const task = queue.catch(() => {}).then(async () => {
        const cachedAgain = cache.get(key);
        if (cachedAgain && Date.now() - cachedAgain.at < 86400000) return cachedAgain.value;
        await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())));
        nextRequestAt = Date.now() + 1100;
        const endpoint = new URL('/reverse', process.env.GUNTER_GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org');
        endpoint.search = new URLSearchParams({ format: 'jsonv2', lat: latitude.toFixed(3), lon: longitude.toFixed(3), zoom: '10', addressdetails: '1' }).toString();
        const response = await fetcher(endpoint, { headers: { 'User-Agent': 'GunterPersonalAssistant/1.0 (city greeting)', 'Accept-Language': 'es' }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw Object.assign(new Error('location_provider_unavailable'), { status: 503 });
        const data = await response.json();
        const address = data.address || {};
        const city = address.city || address.town || address.village || address.municipality;
        if (!city) throw Object.assign(new Error('city_not_found'), { status: 404 });
        const result = { city: String(city).slice(0, 100), source: 'OpenStreetMap / Nominatim' };
        if (cache.size >= 500) cache.delete(cache.keys().next().value);
        cache.set(key, { value: result, at: Date.now() });
        return result;
    });
    queue = task;
    task.finally(() => { queued -= 1; }).catch(() => {});
    return task;
}
module.exports = { reverse };
