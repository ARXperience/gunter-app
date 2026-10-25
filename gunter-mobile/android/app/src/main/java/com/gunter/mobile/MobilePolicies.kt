package com.gunter.mobile

import java.util.Locale

/** This native adapter supports SMS drafts only; other channels use their own integrations. */
internal fun requireSmsChannel(value: String): String {
    val channel = value.trim().lowercase(Locale.ROOT).ifEmpty { "sms" }
    if (channel != "sms") throw IllegalStateException("mobile_message_channel_not_supported")
    return channel
}

internal data class MobileMediaSnapshot(val state: Int?, val mediaId: String?, val title: String?, val artist: String?)

/** JSONObject.optLong coerces fractions and strings; concurrency revisions must be integers. */
internal fun requireReminderRevision(value: Any?): Long {
    val number = value as? Number ?: throw IllegalStateException("mobile_reminder_revision_required")
    val revision = number.toLong()
    if (!number.toDouble().isFinite() || revision !in 1..9007199254740991L || number.toDouble() != revision.toDouble()) {
        throw IllegalStateException("mobile_reminder_revision_required")
    }
    return revision
}

internal fun mediaEffectObserved(skill: String, before: MobileMediaSnapshot, after: MobileMediaSnapshot, requestedState: Int): Boolean = when (skill) {
    "mobile.media.play_pause" -> after.state == requestedState
    "mobile.media.next" ->
        (before.mediaId != null && after.mediaId != null && before.mediaId != after.mediaId) ||
        (before.title != null && after.title != null &&
            (before.title != after.title || (before.artist != null && after.artist != null && before.artist != after.artist)))
    else -> false
}
