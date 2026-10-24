package com.gunter.mobile

import android.content.Context
import org.json.JSONObject
import java.time.Instant

internal data class ReminderRecord(val id: String, val title: String, val whenMillis: Long) {
    val runAt: String get() = Instant.ofEpochMilli(whenMillis).toString()
}

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
        val raw = JSONObject().put("title", record.title).put("whenMillis", record.whenMillis).toString()
        return prefs.edit().putString(key(record.id), raw).commit()
    }

    override fun remove(id: String): Boolean = prefs.edit().remove(key(id)).commit()

    private fun decode(id: String, raw: String): ReminderRecord {
        try {
            val json = JSONObject(raw)
            val record = ReminderRecord(id, json.getString("title"), json.getLong("whenMillis"))
            if (!validReminderId(record.id) || record.title.isBlank() || record.title.length > 180 || record.whenMillis <= 0) {
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

    fun deliver(id: String, expectedAt: Long): Boolean = synchronized(lock) {
        if (!validReminderId(id)) return@synchronized false
        val record = storage.get(id) ?: return@synchronized false
        if (record.whenMillis != expectedAt) return@synchronized false
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
