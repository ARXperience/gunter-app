/* Deployment readiness check. It never prints environment values or secrets. */
require('dotenv').config();
const production = process.env.NODE_ENV === 'production';
const configured = key => Boolean(String(process.env[key] || '').trim());
const aiProvider = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'MISTRAL_API_KEY'].some(configured);
const errors = [];
const warnings = [];

if (!production) warnings.push('NODE_ENV no es production; verificación informativa.');
if (production && !configured('ALLOWED_ORIGINS')) errors.push('ALLOWED_ORIGINS debe declarar el origen HTTPS público.');
if (production && process.env.AUTH_COOKIE_SECURE !== 'true') errors.push('AUTH_COOKIE_SECURE debe ser true en producción.');
const replicas = Number(process.env.GUNTER_REPLICAS || 1);
if (production && (!Number.isInteger(replicas) || replicas < 1)) errors.push('GUNTER_REPLICAS debe ser un entero mayor o igual a 1.');
if (production && replicas > 1) errors.push('El almacenamiento JSON actual solo admite una instancia; reduce GUNTER_REPLICAS a 1 hasta completar el adaptador de base de datos compartida.');
if (!aiProvider) errors.push('Configura al menos un proveedor de IA.');
if (production && (!configured('VAPID_PUBLIC_KEY') || !configured('VAPID_PRIVATE_KEY'))) {
    warnings.push('Las claves VAPID se generarán en el almacenamiento local; configura ambas para despliegues con más de una instancia.');
}
if (production && !configured('VAPID_SUBJECT')) warnings.push('Configura VAPID_SUBJECT con un correo o URL de contacto.');
if (production && process.env.TRUST_PROXY !== 'true') warnings.push('Activa TRUST_PROXY solo si el despliegue termina TLS en un proxy inverso.');
if (production && configured('FCM_SERVICE_ACCOUNT_JSON') && !require('../server/push/mobile').isConfigured('fcm')) errors.push('FCM_SERVICE_ACCOUNT_JSON no contiene una cuenta de servicio válida para FCM HTTP v1.');
const apnsPartiallyConfigured = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY'].some(configured);
if (production && apnsPartiallyConfigured && !require('../server/push/mobile').isConfigured('apns')) errors.push('La configuración APNs está incompleta o inválida; revisa APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY y APNS_ENVIRONMENT.');
if (production && (configured('FCM_SERVICE_ACCOUNT_JSON') || apnsPartiallyConfigured) && !configured('MOBILE_PUSH_ENCRYPTION_KEY')) warnings.push('Define MOBILE_PUSH_ENCRYPTION_KEY como secreto independiente para cifrar tokens de push en reposo.');
if (production && configured('MOBILE_PUSH_ENCRYPTION_KEY') && Buffer.from(process.env.MOBILE_PUSH_ENCRYPTION_KEY, 'base64url').length !== 32) errors.push('MOBILE_PUSH_ENCRYPTION_KEY debe decodificar a exactamente 32 bytes.');

for (const warning of warnings) console.warn(`AVISO: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exitCode = 1;
else console.log('Preflight de Gunter superado.');
