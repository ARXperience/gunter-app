package com.gunter.mobile

import android.content.Context
import org.json.JSONObject
import java.time.Instant

internal data class ReminderRecord(
    val id: String,
    val title: String,
    val whenMillis: Long,
    val revision: Long = 1,
    val lastMutationId: String? = null
) {
    val runAt: String get() = Instant.ofEpochMilli(whenMillis).toString()
    fun status(nowMillis: Long): String = if (whenMillis <= nowMillis) "overdue" else "pending"
}

internal data class ReminderCancellation(val id: String, val alreadyAbsent: Boolean)

internal interface ReminderStorage {
    fun get(id: String): ReminderRecord?
    fun all(): List<ReminderRecord>
    fun put(record: ReminderRecord): Boolean
    fun remove(id: String): Boolean
}

/** App-private data only. A successful synchronous commit, not apply(), is required. */
internal class ReminderStore(context: Context) : ReminderStorage {
    private val prefs = context.getSharedPreferences("gunter_mobile_reminders", Context.MODE_PRIVATE)

    override fun get(id: String): ReminderRecord? = prefs.getString(key(id), null)?.let { decode(id, it) }

    override fun all(): List<ReminderRecord> = prefs.all.entries.mapNotNull { (key, value) ->
        if (!key.startsWith(PREFIX) || value !is String) null else decode(key.removePrefix(PREFIX), value)
    }

    override fun put(record: ReminderRecord): Boolean {
        val raw = JSONObject().put("title", record.title).put("whenMillis", record.whenMillis)
            .put("revision", record.revision).put("lastMutationId", record.lastMutationId).toString()
        return prefs.edit().putString(key(record.id), raw).commit()
    }

    override fun remove(id: String): Boolean = prefs.edit().remove(key(id)).commit()

    private fun decode(id: String, raw: String): ReminderRecord {
        try {
            val json = JSONObject(raw)
            // Read old rows without migrating/writing them. The first explicit update
            // adds a revision and its stable command ID to that one row only.
            val record = ReminderRecord(id, json.getString("title"), json.getLong("whenMillis"),
                if (json.has("revision")) json.getLong("revision") else 1,
                json.optString("lastMutationId", "").takeIf { it.isNotBlank() })
            if (!validReminderId(record.id) || record.title.isBlank() || record.title.length > 180 || record.whenMillis <= 0 ||
                record.revision !in 1..MAX_REMINDER_REVISION || record.lastMutationId?.let { !validReminderId(it) } == true) {
                throw IllegalStateException("mobile_reminder_store_invalid")
            }
            return record
        } catch (_: Exception) {
            // Fail closed on corruption; never silently replace or erase existing reminders.
            throw IllegalStateException("mobile_reminder_store_invalid")
        }
    }

    private fun key(id: String) = "$PREFIX$id"
    companion object { private const val PREFIX = "reminder." }
}

/** Pure coordination logic. Platform checks/side effects are injected for local JVM tests. */
internal class ReminderCoordinator(
    private val storage: ReminderStorage,
    private val scheduleAlarm: (ReminderRecord) -> Unit,
    private val requireNotifications: () -> Unit,
    private val postNotification: (ReminderRecord) -> Unit,
    private val cancelAlarm: (String) -> Unit = { throw IllegalStateException("mobile_reminder_cancel_unavailable") },
    private val now: () -> Long = System::currentTimeMillis
) {
    fun schedule(id: String, title: String, runAt: String): ReminderRecord = synchronized(lock) {
        if (!validReminderId(id)) throw IllegalStateException("mobile_command_id_required")
        val cleanTitle = title.trim()
        if (cleanTitle.isEmpty() || cleanTitle.length > 180) throw IllegalStateException("mobile_reminder_title_invalid")
        val at = try { Instant.parse(runAt).toEpochMilli() } catch (_: Exception) {
            throw IllegalStateException("mobile_reminder_date_invalid")
        }
        if (at <= now()) throw IllegalStateException("mobile_reminder_date_invalid")
        val record = ReminderRecord(id, cleanTitle, at)
        requireNotifications()
        val previous = storage.get(id)
        if (previous != null && previous != record) throw IllegalStateException("mobile_reminder_id_conflict")
        if (previous == null && storage.all().size >= MAX_REMINDERS) throw IllegalStateException("mobile_reminder_limit")

        // Persist first so a process death between persistence and AlarmManager can recover
        // on boot/app resume. Do not report success without a durable write and reconsult.
        if (!storage.put(record) || storage.get(id) != record) throw IllegalStateException("mobile_reminder_persist_failed")
        try {
            scheduleAlarm(record)
        } catch (error: Exception) {
            // On a new request, roll back our own record if scheduling failed. A failed
            // rollback stays recoverable, but is never reported as successful execution.
            if (previous == null) storage.remove(id)
            throw error
        }
        record
    }

    /** Saved local rows, not an assertion that Android will display their notifications. */
    fun list(id: String? = null): List<ReminderRecord> = synchronized(lock) {
        if (id != null) {
            if (!validReminderId(id)) throw IllegalStateException("mobile_reminder_id_required")
            listOfNotNull(storage.get(id))
        } else storage.all().sortedWith(compareBy<ReminderRecord> { it.whenMillis }.thenBy { it.id })
    }

    fun update(id: String, title: String, runAt: String, expectedRevision: Long, mutationId: String): ReminderRecord = synchronized(lock) {
        if (!validReminderId(id)) throw IllegalStateException("mobile_reminder_id_required")
        if (!validReminderId(mutationId)) throw IllegalStateException("mobile_command_id_required")
        if (expectedRevision !in 1 until MAX_REMINDER_REVISION) throw IllegalStateException("mobile_reminder_revision_required")
        val cleanTitle = title.trim()
        if (cleanTitle.isEmpty() || cleanTitle.length > 180) throw IllegalStateException("mobile_reminder_title_invalid")
        val at = try { Instant.parse(runAt).toEpochMilli() } catch (_: Exception) {
            throw IllegalStateException("mobile_reminder_date_invalid")
        }
        val previous = storage.get(id) ?: throw IllegalStateException("mobile_reminder_not_found")
        if (previous.lastMutationId == mutationId) {
            if (previous.title != cleanTitle || previous.whenMillis != at || previous.revision != expectedRevision + 1) {
                throw IllegalStateException("mobile_reminder_mutation_conflict")
            }
            requireNotifications()
            // The same immutable PendingIntent identity replaces its existing alarm; it
            // never creates a second reminder or sends a notification during a retry.
            scheduleAlarm(previous)
            return@synchronized previous
        }
        if (previous.revision != expectedRevision) throw IllegalStateException("mobile_reminder_revision_conflict")
        if (at <= now()) throw IllegalStateException("mobile_reminder_date_invalid")
        requireNotifications()
        val updated = previous.copy(title = cleanTitle, whenMillis = at, revision = expectedRevision + 1, lastMutationId = mutationId)
        if (!storage.put(updated) || storage.get(id) != updated) {
            runCatching { storage.put(previous) }
            throw IllegalStateException("mobile_reminder_persist_failed")
        }
        try {
            // AlarmManager replaces the old alarm for the same PendingIntent. Including
            // the revision in its extras prevents an already queued old broadcast from
            // delivering a title-only update early or delivering it twice.
            scheduleAlarm(updated)
        } catch (error: Exception) {
            val rolledBack = runCatching { storage.put(previous) && storage.get(id) == previous }.getOrDefault(false)
            if (rolledBack) runCatching { scheduleAlarm(previous) }
            // A failed rollback is recoverable from whichever durable row remains. Never
            // claim that either the update or rollback succeeded after an exception.
            throw error
        }
        updated
    }

    /** Durable absence suppresses a queued receiver even if platform cancellation fails. */
    fun cancel(id: String, expectedRevision: Long): ReminderCancellation = synchronized(lock) {
        if (!validReminderId(id)) throw IllegalStateException("mobile_reminder_id_required")
        if (expectedRevision !in 1..MAX_REMINDER_REVISION) throw IllegalStateException("mobile_reminder_revision_required")
        val previous = storage.get(id)
        if (previous != null && previous.revision != expectedRevision) throw IllegalStateException("mobile_reminder_revision_conflict")
        if (!storage.remove(id) || storage.get(id) != null) throw IllegalStateException("mobile_reminder_remove_failed")
        // Cancelling an already absent ID still clears any remaining PendingIntent and
        // visible notification. Absence is not labelled as historical proof of delivery.
        cancelAlarm(id)
        ReminderCancellation(id, previous == null)
    }

    /** Re-arm overdue entries too: they become visibly delayed reminders, not silent loss. */
    fun restore(): Int = synchronized(lock) {
        requireNotifications()
        var restored = 0
        for (record in storage.all().sortedBy { it.whenMillis }.take(MAX_REMINDERS)) {
            try { scheduleAlarm(record); restored += 1 } catch (_: Exception) {
                // Retain it for the next explicit app resume/reboot recovery attempt.
            }
        }
        restored
    }

    fun deliver(id: String, expectedAt: Long, expectedRevision: Long = 1): Boolean = synchronized(lock) {
        if (!validReminderId(id)) return@synchronized false
        val record = storage.get(id) ?: return@synchronized false
        if (record.whenMillis != expectedAt || record.revision != expectedRevision) return@synchronized false
        if (record.whenMillis > now()) {
            scheduleAlarm(record)
            return@synchronized false
        }
        requireNotifications()
        postNotification(record)
        if (!storage.remove(id) || storage.get(id) != null) throw IllegalStateException("mobile_reminder_remove_failed")
        true
    }

    companion object {
        const val MAX_REMINDERS = 250
        // All receiver/service instances share the same app process and must not race the
        // read/commit/reconsult/notify sequence. No multiprocess component is declared.
        private val lock = Any()
    }
}

private fun validReminderId(id: String) = id.isNotBlank() && id.length <= 240 && id.none { it.code < 32 || it.code == 127 }
private const val MAX_REMINDER_REVISION = 9007199254740991L
