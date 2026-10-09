/* =============================================
   GUNTER ACTIONS — Dispatcher (v1)
   -------------------------------------------------
   Único punto de entrada. Recibe:
     { text?, command?, channel, identifier, ownerPhone? }
   Devuelve respuesta canónica:
     { success, action, feature?, value?, reply, requiresConfirmation?, ... }

   Consumido por:
     - POST /api/actions (desde browser widget)
     - handler.js de WhatsApp

   NOTA: este dispatcher NO invoca al LLM. Solo mueve
   estado local. Si el intent no matchea un action
   registrado, devuelve { success:false, intent:null }
   para que el caller intente responder con LLM.
   ============================================= */

const vocabulary = require('./vocabulary');
const guardrails = require('./guardrails');
const state = require('./state');

let mirror = null;
try { mirror = require('../whatsapp/state-mirror'); } catch { /* opcional */ }

let waStore = null;
try { waStore = require('../whatsapp/message-log'); } catch { /* opcional */ }

/**
 * Procesa un texto libre. Es la entrada principal.
 */
async function dispatch({ text, channel = 'browser', identifier = 'anon', ownerPhone = null }) {
  // 1. ¿Es respuesta a una pending?
  if (guardrails.hasPending({ channel, identifier })) {
    const result = guardrails.consumePending({ channel, identifier, replyText: text });
    if (result?.cancelled) {
      return ok({ intent: 'cancelled', reply: 'Perfecto, no hice nada. ¿Otra cosa?' });
    }
    if (result?.confirmed) {
      // Ejecutar la acción pendiente
      return await executeConfirmedAction(result.action, { channel, identifier });
    }
    // No respondió confirmando ni cancelando → esperamos
    return ok({
      intent: 'pending',
      requiresConfirmation: true,
      reply: `Aún espero tu confirmación (SÍ / NO). O dime otra cosa y cancelo lo anterior.`
    });
  }

  // 2. Clasificar intent
  const classification = vocabulary.classifyActionIntent(text || '');
  if (!classification) {
    return { success: false, intent: null, reply: null };
  }

  const { intent, feature, value } = classification;

  // 3. LIST
  if (intent === 'list') {
    return await handleList();
  }

  // 4. QUERY: ¿qué es X?
  if (intent === 'query') {
    return handleQuery(feature);
  }

  // 5. TOGGLE / SET
  return await handleMutation({ intent, feature, value, channel, identifier, ownerPhone });
}

// ============================================
// Handlers específicos
// ============================================

async function handleList() {
  const allState = state.getAll();
  const entries = [];
  for (const feat of vocabulary.FEATURES) {
    if (feat.kind !== 'boolean') continue;
    const value = allState[feat.flag];
    if (value === true) entries.push(feat.aliases[0]);
  }
  if (entries.length === 0) {
    return ok({
      intent: 'list',
      reply: 'No tienes ninguna función premium activa. Puedes activar cosas como memoria, forecast o pulso proactivo cuando quieras.'
    });
  }
  const preview = entries.slice(0, 8).map(e => `• ${e}`).join('\n');
  const more = entries.length > 8 ? `\n... y ${entries.length - 8} más` : '';
  return ok({
    intent: 'list',
    reply: `Tienes ${entries.length} funciones activas:\n${preview}${more}`,
    data: { flags: entries }
  });
}

function handleQuery(feature) {
  const current = state.get(feature.flag);
  const isOn = current === true;
  const status = isOn ? '✅ está activa' : '⚪ está inactiva';
  const explain = feature.longDesc || feature.shortDesc || feature.aliases[0];
  return ok({
    intent: 'query',
    feature: feature.flag,
    reply: `${explain}\n\nAhora mismo: ${status}.${!isOn ? ' Dime "activa ' + feature.aliases[0] + '" si la quieres encender.' : ''}`,
    data: { flag: feature.flag, currentValue: current }
  });
}

async function handleMutation({ intent, feature, value, channel, identifier, ownerPhone }) {
  // Autorización
  if (!guardrails.isAllowed({ feature, channel, identifier, ownerPhone })) {
    return ok({
      intent: 'rejected',
      reply: guardrails.ownerOnlyRejection(feature.aliases[0])
    });
  }

  // Riesgo: si requiere confirmación, poner pending
  if (feature.risk === 'confirm' || feature.risk === 'destructive') {
    const humanMessage = guardrails.confirmationMessage({ feature, intent, value });
    guardrails.requestConfirmation({
      channel,
      identifier,
      action: { intent, feature, value },
      humanMessage
    });
    return ok({
      intent: 'awaiting_confirmation',
      feature: feature.flag,
      requiresConfirmation: true,
      reply: humanMessage
    });
  }

  // Ejecutar directo (safe)
  return applyAction({ intent, feature, value, channel, identifier });
}

async function executeConfirmedAction(action, { channel, identifier }) {
  return applyAction({ ...action, channel, identifier });
}

/**
 * Aplica el cambio de estado + notifica canales.
 */
async function applyAction({ intent, feature, value, channel, identifier }) {
  let newValue;
  if (intent === 'toggle_on')  newValue = true;
  if (intent === 'toggle_off') newValue = false;
  if (intent === 'set_enum')   newValue = value;
  if (intent === 'set_text' || intent === 'set_number') newValue = value;

  state.set(feature.flag, newValue, { source: channel, reason: 'action:' + intent });

  // Encolar en sync-queue para que browser lo aplique al abrir la app.
  if (waStore?.enqueueSync) {
    try {
      waStore.enqueueSync({
        kind: 'feature_toggle',
        flag: feature.flag,
        value: newValue,
        source: channel,
        at: new Date().toISOString()
      });
    } catch { /* noop */ }
  }

  // Reply humano con personalidad Gunter AT (rotación de tono)
  // El humor seco/negro aparece 1 de cada 4 veces aprox. (rotación por hash del flag+ts).
  const spicy = ((Date.now() >>> 0) + (feature.flag.length * 7)) % 4 === 0;
  const label = cap(feature.aliases[0]);
  const waHint = channel === 'whatsapp' ? ' Al abrir tu app se reflejará.' : '';
  let reply;
  if (intent === 'toggle_on') {
    const spice = spicy
      ? [
          ' Que no diga después que no te avisé.',
          ' Ojalá esta vez sí la uses.',
          ' Bienvenida al club de las funciones que activás y olvidás.',
          ' Otro juguete nuevo. Vamos a ver cuánto dura.'
        ][(feature.flag.length + spicy) % 4]
      : '';
    reply = `✅ ${label} activada.${feature.longDesc ? ' ' + feature.longDesc : ''}${spice}${waHint}`.trim();
  } else if (intent === 'toggle_off') {
    const spice = spicy
      ? [
          ' Silencio. Divino.',
          ' Menos ruido, más productividad. Eso dicen.',
          ' Apagada. Ya volverá cuando te aburra la paz.',
          ' Off. El planeta lo agradece — bueno, no, pero suena bien.'
        ][(feature.flag.length + 3) % 4]
      : '';
    reply = `⚪ ${label} desactivada.${spice}${waHint}`.trim();
  } else {
    reply = `✅ ${label} ahora es "${newValue}".${spicy ? ' Elección interesante.' : ''}${waHint}`.trim();
  }

  return ok({
    intent: 'applied',
    feature: feature.flag,
    value: newValue,
    reply
  });
}

// ============================================
// Utils
// ============================================
function ok(payload) { return { success: true, ...payload }; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

module.exports = {
  dispatch,
  applyAction,
  handleQuery,
  handleList,
  // Direct calls (para el endpoint HTTP)
  getState: state.getAll,
  setDirect: (flag, value, meta) => state.set(flag, value, meta),
  syncFromBrowser: state.syncFromBrowser,
  vocabulary
};
