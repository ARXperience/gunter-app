/* =============================================
   GUNTER ACTIONS — Guardrails (v1)
   -------------------------------------------------
   Verifica que una acción se pueda ejecutar de forma
   segura. Aplica reglas de:
     - risk: safe | confirm | destructive
     - owner_only: acciones administrativas por WA
     - pending confirmations: multi-turno para WA

   Pending confirmations: se almacenan en memoria por
   contacto (WA) o por sesión (browser). TTL 5 min.
   ============================================= */

const PENDING = new Map();     // key: `${channel}:${identifier}` → { action, expiresAt }
const PENDING_TTL_MS = 5 * 60 * 1000;

function _prune() {
  const now = Date.now();
  for (const [key, val] of PENDING.entries()) {
    if (val.expiresAt < now) PENDING.delete(key);
  }
}

/**
 * Verifica si el usuario tiene autorización para tocar la feature vía este canal.
 */
function isAllowed({ feature, channel, identifier, ownerPhone }) {
  if (channel === 'browser') return true;           // browser siempre autorizado
  if (channel === 'system') return true;
  if (channel === 'whatsapp') {
    if (!ownerPhone) return true;                    // sin owner configurado → todos pueden (dev)
    return identifier === ownerPhone;
  }
  return false;
}

/**
 * Registra una acción como pendiente de confirmación.
 * Devuelve un token/reply humano.
 */
function requestConfirmation({ channel, identifier, action, humanMessage }) {
  _prune();
  const key = `${channel}:${identifier}`;
  PENDING.set(key, {
    action,
    expiresAt: Date.now() + PENDING_TTL_MS,
    createdAt: Date.now()
  });
  return {
    pending: true,
    message: humanMessage,
    expiresIn: PENDING_TTL_MS / 1000
  };
}

/**
 * Consume una pendiente si el user dijo la palabra mágica.
 */
function consumePending({ channel, identifier, replyText }) {
  _prune();
  const key = `${channel}:${identifier}`;
  const pending = PENDING.get(key);
  if (!pending) return null;

  const norm = String(replyText || '').toLowerCase().trim();
  // Palabras que confirman
  const confirms = /^(confirmar|confirmo|si|sí|dale|adelante|hazlo|ok|ejecutar)/;
  // Palabras que cancelan
  const cancels = /^(cancelar|cancela|no|para|detente|espera|nada)/;

  if (cancels.test(norm)) {
    PENDING.delete(key);
    return { cancelled: true };
  }
  if (confirms.test(norm)) {
    PENDING.delete(key);
    return { confirmed: true, action: pending.action };
  }
  return null;
}

function hasPending({ channel, identifier }) {
  _prune();
  return PENDING.has(`${channel}:${identifier}`);
}

function clearPending({ channel, identifier }) {
  const key = `${channel}:${identifier}`;
  return PENDING.delete(key);
}

/**
 * Genera un mensaje humano de confirmación según el riesgo.
 */
function confirmationMessage({ feature, intent, value }) {
  if (intent === 'toggle_off' && feature.risk === 'destructive') {
    return `⚠️ Desactivar "${feature.aliases[0]}" es destructivo. Perderás datos asociados. Responde CONFIRMAR para continuar o CANCELAR.`;
  }
  if (feature.risk === 'confirm') {
    const action = intent === 'toggle_on' ? 'activar' : intent === 'toggle_off' ? 'desactivar' : 'cambiar';
    return `Voy a ${action} "${feature.aliases[0]}". ${feature.longDesc || ''} ¿Confirmas? (responde SÍ o NO)`;
  }
  if (intent === 'set_enum') {
    return `Voy a cambiar ${feature.aliases[0]} a "${value}". ¿Confirmas?`;
  }
  return `Voy a ejecutar. ¿Confirmas?`;
}

/**
 * Rechazo cortés cuando un no-owner intenta un comando administrativo por WA.
 */
function ownerOnlyRejection(featureAlias) {
  return `Esa opción (${featureAlias}) la administra el dueño de esta cuenta. ¿Puedo ayudarte con algo de tu proyecto?`;
}

module.exports = {
  isAllowed,
  requestConfirmation,
  consumePending,
  hasPending,
  clearPending,
  confirmationMessage,
  ownerOnlyRejection
};
