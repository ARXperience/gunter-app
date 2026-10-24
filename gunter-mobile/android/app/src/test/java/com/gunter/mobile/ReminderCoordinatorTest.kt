package com.gunter.mobile

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

/** No AlarmManager/notification/device assumptions: exercise the real coordinator with fakes. */
class ReminderCoordinatorTest {
    private val now = Instant.parse("2026-10-23T12:00:00Z").toEpochMilli()
    private val future = "2026-10-23T13:00:00Z"

    private class MemoryStore : ReminderStorage {
        val records = linkedMapOf<String, ReminderRecord>()
        val events = mutableListOf<String>()
        var putSucceeds = true
        var removeSucceeds = true
        var incorrectReadback = false
        override fun get(id: String): ReminderRecord? {
            events += "get:$id"
            val item = records[id]
            return if (incorrectReadback && item != null) item.copy(title = "different") else item
        }
        override fun all(): List<ReminderRecord> = records.values.toList()
        override fun put(record: ReminderRecord): Boolean {
            events += "put:${record.id}"
            if (putSucceeds) records[record.id] = record
            return putSucceeds
        }
        override fun remove(id: String): Boolean {
            events += "remove:$id"
            if (removeSucceeds) records.remove(id)
            return removeSucceeds
        }
    }

    private fun coordinator(
        store: MemoryStore,
        at: Long = now,
        alarm: (ReminderRecord) -> Unit = { store.events += "alarm:${it.id}" },
        permission: () -> Unit = { store.events += "permission" },
        post: (ReminderRecord) -> Unit = { store.events += "notify:${it.id}" }
    ) = ReminderCoordinator(store, alarm, permission, post) { at }

    private fun fails(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (error: IllegalStateException) { assertEquals(code, error.message) }
    }

    @Test fun durableCommitAndReconsultPrecedeAlarmScheduling() {
        val store = MemoryStore()
        val record = coordinator(store).schedule("command-1", "  Tomar agua  ", future)
        assertEquals("Tomar agua", record.title)
        assertEquals(future, record.runAt)
        assertEquals(record, store.records["command-1"])
        assertEquals(listOf("permission", "get:command-1", "put:command-1", "get:command-1", "alarm:command-1"), store.events)
    }

    @Test fun deniedPermissionNeverPersistsOrSchedules() {
        val store = MemoryStore()
        fails("mobile_reminder_notification_permission_required") {
            coordinator(store, permission = { throw IllegalStateException("mobile_reminder_notification_permission_required") })
                .schedule("one", "Agua", future)
        }
        assertTrue(store.records.isEmpty())
        assertTrue(store.events.isEmpty())
    }

    @Test fun unsuccessfulCommitDoesNotClaimScheduling() {
        val store = MemoryStore().apply { putSucceeds = false }
        fails("mobile_reminder_persist_failed") { coordinator(store).schedule("one", "Agua", future) }
        assertFalse(store.events.any { it.startsWith("alarm:") })
        assertTrue(store.records.isEmpty())
    }

    @Test fun incorrectReadbackDoesNotScheduleAnAlarm() {
        val store = MemoryStore().apply { incorrectReadback = true }
        fails("mobile_reminder_persist_failed") { coordinator(store).schedule("one", "Agua", future) }
        assertFalse(store.events.any { it.startsWith("alarm:") })
    }

    @Test fun failedAlarmRollsBackOnlyTheNewRecord() {
        val store = MemoryStore()
        val runtime = coordinator(store, alarm = { throw IllegalStateException("alarm_failed") })
        fails("alarm_failed") { runtime.schedule("new", "Agua", future) }
        assertTrue(store.records.isEmpty())
        val previous = ReminderRecord("old", "Comida", Instant.parse(future).toEpochMilli())
        store.records[previous.id] = previous
        fails("alarm_failed") { runtime.schedule(previous.id, previous.title, previous.runAt) }
        assertEquals(previous, store.records[previous.id])
    }

    @Test fun failedAlarmAndRollbackStillNeverReturnSuccess() {
        val store = MemoryStore().apply { removeSucceeds = false }
        fails("alarm_failed") {
            coordinator(store, alarm = { throw IllegalStateException("alarm_failed") }).schedule("one", "Agua", future)
        }
        // If disk rollback fails, the authorized request remains recoverable; no false ACK.
        assertNotNull(store.records["one"])
    }

    @Test fun stableIdsAreIdempotentButCannotOverwriteAnotherPayload() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        val first = runtime.schedule("one", "Agua", future)
        assertEquals(first, runtime.schedule("one", "Agua", future))
        assertEquals(1, store.records.size)
        fails("mobile_reminder_id_conflict") { runtime.schedule("one", "Otra tarea", future) }
        assertEquals(first, store.records["one"])
    }

    @Test fun malformedOrPastDatesAreRejectedBeforeAnySideEffect() {
        for (date in listOf("", "tomorrow", "2026-10-23T11:59:59Z", "2026-10-23T12:00:00Z", "2026-10-24T00:00:00", "+999999999-12-31T23:59:59Z")) {
            val store = MemoryStore()
            fails("mobile_reminder_date_invalid") { coordinator(store).schedule("one", "Agua", date) }
            assertTrue(date, store.events.isEmpty())
        }
    }

    @Test fun idsAndTitlesAreBoundedWithoutTruncatingTheirMeaning() {
        for (id in listOf("", "   ", "a\nb", "x".repeat(241))) {
            val store = MemoryStore()
            fails("mobile_command_id_required") { coordinator(store).schedule(id, "Agua", future) }
            assertTrue(store.events.isEmpty())
        }
        for (title in listOf("", "   ", "x".repeat(181))) {
            val store = MemoryStore()
            fails("mobile_reminder_title_invalid") { coordinator(store).schedule("one", title, future) }
            assertTrue(store.events.isEmpty())
        }
    }

    @Test fun pendingLimitDoesNotBreakExistingIdempotentRequests() {
        val store = MemoryStore()
        val at = Instant.parse(future).toEpochMilli()
        repeat(ReminderCoordinator.MAX_REMINDERS) { index ->
            val id = "id-$index"
            store.records[id] = ReminderRecord(id, "Recordatorio", at)
        }
        val runtime = coordinator(store)
        fails("mobile_reminder_limit") { runtime.schedule("new", "Agua", future) }
        assertEquals("id-0", runtime.schedule("id-0", "Recordatorio", future).id)
        assertEquals(ReminderCoordinator.MAX_REMINDERS, store.records.size)
    }

    @Test fun bootRecoveryRearmsFutureAndOverdueRecordsWithoutDeletingThem() {
        val store = MemoryStore()
        coordinator(store).schedule("one", "Agua", future)
        store.records["late"] = ReminderRecord("late", "Comida", now - 60000)
        store.events.clear()
        // A new coordinator with the same durable repository models receiver recreation.
        assertEquals(2, coordinator(store).restore())
        assertEquals(listOf("permission", "alarm:late", "alarm:one"), store.events)
        assertEquals(2, store.records.size)
    }

    @Test fun recoveryFailureForOneAlarmKeepsItAndStillRestoresOthers() {
        val store = MemoryStore()
        store.records["bad"] = ReminderRecord("bad", "Agua", now - 1)
        store.records["good"] = ReminderRecord("good", "Comida", now + 1)
        val alarms = mutableListOf<String>()
        assertEquals(1, coordinator(store, alarm = {
            if (it.id == "bad") throw IllegalStateException("alarm_failed")
            alarms += it.id
        }).restore())
        assertEquals(listOf("good"), alarms)
        assertEquals(2, store.records.size)
    }

    @Test fun permissionRevocationDuringRecoveryKeepsDurableData() {
        val store = MemoryStore()
        store.records["one"] = ReminderRecord("one", "Agua", now - 1)
        fails("blocked") { coordinator(store, permission = { throw IllegalStateException("blocked") }).restore() }
        assertEquals(1, store.records.size)
        assertTrue(store.events.isEmpty())
    }

    @Test fun matchingDueDeliveryNotifiesThenRemovesAndDuplicateDeliveryDoesNothing() {
        val store = MemoryStore()
        val record = ReminderRecord("one", "Agua", now - 1)
        store.records[record.id] = record
        val runtime = coordinator(store)
        assertTrue(runtime.deliver(record.id, record.whenMillis))
        assertEquals(listOf("get:one", "permission", "notify:one", "remove:one", "get:one"), store.events)
        assertFalse(runtime.deliver(record.id, record.whenMillis))
        assertTrue(store.records.isEmpty())
    }

    @Test fun staleMissingAndEarlyDeliveriesDoNotNotifyOrRemove() {
        val store = MemoryStore()
        val record = ReminderRecord("one", "Agua", now + 10000)
        store.records[record.id] = record
        val runtime = coordinator(store)
        assertFalse(runtime.deliver("missing", now - 1))
        assertFalse(runtime.deliver(record.id, record.whenMillis - 1))
        assertFalse(runtime.deliver(record.id, record.whenMillis))
        assertTrue(store.events.contains("alarm:one"))
        assertFalse(store.events.any { it.startsWith("notify:") || it.startsWith("remove:") })
        assertEquals(record, store.records[record.id])
    }

    @Test fun blockedOrFailedNotificationLeavesReminderRecoverable() {
        val store = MemoryStore()
        val record = ReminderRecord("one", "Agua", now - 1)
        store.records[record.id] = record
        fails("blocked") { coordinator(store, permission = { throw IllegalStateException("blocked") }).deliver(record.id, record.whenMillis) }
        assertFalse(store.events.any { it.startsWith("notify:") })
        fails("notify_failed") { coordinator(store, post = { throw IllegalStateException("notify_failed") }).deliver(record.id, record.whenMillis) }
        assertEquals(record, store.records[record.id])
    }

    @Test fun failedRemovalDoesNotPretendDeliveryCleanupSucceeded() {
        val store = MemoryStore().apply { removeSucceeds = false }
        val record = ReminderRecord("one", "Agua", now - 1)
        store.records[record.id] = record
        fails("mobile_reminder_remove_failed") { coordinator(store).deliver(record.id, record.whenMillis) }
        assertEquals(record, store.records[record.id])
    }

    @Test fun differentIdsWithTheSameJavaHashStayDistinct() {
        assertEquals("FB".hashCode(), "Ea".hashCode())
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("FB", "Agua", future)
        runtime.schedule("Ea", "Comida", future)
        assertEquals(2, store.records.size)
        assertEquals("Agua", store.records["FB"]?.title)
        assertEquals("Comida", store.records["Ea"]?.title)
    }
}
