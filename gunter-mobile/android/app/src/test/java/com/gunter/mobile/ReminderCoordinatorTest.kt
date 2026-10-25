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
        var ignoreRemove = false
        var getCalls = 0
        var putCalls = 0
        val failedPuts = mutableSetOf<Int>()
        val incorrectReads = mutableSetOf<Int>()
        override fun get(id: String): ReminderRecord? {
            getCalls += 1
            events += "get:$id"
            val item = records[id]
            return if ((incorrectReadback || getCalls in incorrectReads) && item != null) item.copy(title = "different") else item
        }
        override fun all(): List<ReminderRecord> = records.values.toList()
        override fun put(record: ReminderRecord): Boolean {
            putCalls += 1
            events += "put:${record.id}"
            val succeeded = putSucceeds && putCalls !in failedPuts
            if (succeeded) records[record.id] = record
            return succeeded
        }
        override fun remove(id: String): Boolean {
            events += "remove:$id"
            if (removeSucceeds && !ignoreRemove) records.remove(id)
            return removeSucceeds
        }
    }

    private fun coordinator(
        store: MemoryStore,
        at: Long = now,
        alarm: (ReminderRecord) -> Unit = { store.events += "alarm:${it.id}" },
        permission: () -> Unit = { store.events += "permission" },
        post: (ReminderRecord) -> Unit = { store.events += "notify:${it.id}" },
        cancelAlarm: (String) -> Unit = { store.events += "cancelAlarm:$it" }
    ) = ReminderCoordinator(store, alarm, permission, post, cancelAlarm) { at }

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

    @Test fun listAndReadAreReadOnlyAndDoNotRequireNotificationPermission() {
        val store = MemoryStore()
        val later = ReminderRecord("later", "Comida", now + 10000)
        val overdue = ReminderRecord("overdue", "Agua", now - 10000)
        store.records[later.id] = later
        store.records[overdue.id] = overdue
        val runtime = coordinator(store, permission = { throw AssertionError("Listing must not require notifications") })
        assertEquals(listOf(overdue, later), runtime.list())
        assertEquals(listOf(later), runtime.list("later"))
        assertTrue(runtime.list("absent").isEmpty())
        assertEquals("pending", later.status(now))
        assertEquals("overdue", overdue.status(now))
        assertFalse(store.events.any { it.startsWith("put:") || it.startsWith("remove:") || it.startsWith("alarm:") })
    }

    @Test fun updateKeepsStableIdPersistsReconsultsAndReplacesAlarm() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("one", "Agua", future)
        store.events.clear()
        val updated = runtime.update("one", " Comida ", "2026-10-23T14:00:00Z", 1, "update-1")
        assertEquals("one", updated.id)
        assertEquals(2L, updated.revision)
        assertEquals("update-1", updated.lastMutationId)
        assertEquals("Comida", updated.title)
        assertEquals(updated, store.records["one"])
        assertEquals(listOf("get:one", "permission", "put:one", "get:one", "alarm:one"), store.events)
        assertEquals(1, store.records.size)
    }

    @Test fun retryOfSameUpdateDoesNotIncrementRevisionOrCreateAnotherRowOrNotify() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("one", "Agua", future)
        val updated = runtime.update("one", "Comida", future, 1, "update-1")
        store.events.clear()
        assertEquals(updated, runtime.update("one", "Comida", future, 1, "update-1"))
        assertEquals(listOf("get:one", "permission", "alarm:one"), store.events)
        assertEquals(1, store.records.size)
    }

    @Test fun retryOfSameMutationWithDifferentContentFailsBeforeAnySideEffect() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("one", "Agua", future)
        val updated = runtime.update("one", "Comida", future, 1, "update-1")
        store.events.clear()
        fails("mobile_reminder_mutation_conflict") { runtime.update("one", "Trabajo", future, 1, "update-1") }
        assertEquals(listOf("get:one"), store.events)
        assertEquals(updated, store.records["one"])
    }

    @Test fun staleUpdateOrCancelCannotOverwriteANewerRevision() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("one", "Agua", future)
        val updated = runtime.update("one", "Comida", future, 1, "update-1")
        store.events.clear()
        fails("mobile_reminder_revision_conflict") { runtime.update("one", "Trabajo", future, 1, "update-2") }
        fails("mobile_reminder_revision_conflict") { runtime.cancel("one", 1) }
        assertEquals(listOf("get:one", "get:one"), store.events)
        assertEquals(updated, store.records["one"])
    }

    @Test fun oldMutationRetriedAfterAnotherUpdateCannotReapplyOldValues() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("one", "Agua", future)
        runtime.update("one", "Comida", future, 1, "update-1")
        val latest = runtime.update("one", "Trabajo", future, 2, "update-2")
        store.events.clear()
        fails("mobile_reminder_revision_conflict") { runtime.update("one", "Comida", future, 1, "update-1") }
        assertEquals(listOf("get:one"), store.events)
        assertEquals(latest, store.records["one"])
    }

    @Test fun updateOfMissingRecordDoesNotImplicitlyCreateOne() {
        val store = MemoryStore()
        fails("mobile_reminder_not_found") { coordinator(store).update("missing", "Agua", future, 1, "update-1") }
        assertEquals(listOf("get:missing"), store.events)
        assertTrue(store.records.isEmpty())
    }

    @Test fun deniedUpdatePermissionPreservesOriginalRowAndAlarm() {
        val store = MemoryStore()
        val previous = coordinator(store).schedule("one", "Agua", future)
        store.events.clear()
        fails("blocked") {
            coordinator(store, permission = { throw IllegalStateException("blocked") }).update("one", "Comida", future, 1, "update-1")
        }
        assertEquals(previous, store.records["one"])
        assertEquals(listOf("get:one"), store.events)
    }

    @Test fun failedUpdatePersistenceRestoresPreviousRowWithoutReplacingAlarm() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        val previous = runtime.schedule("one", "Agua", future)
        store.failedPuts += store.putCalls + 1
        store.events.clear()
        fails("mobile_reminder_persist_failed") { runtime.update("one", "Comida", future, 1, "update-1") }
        assertEquals(previous, store.records["one"])
        assertFalse(store.events.any { it.startsWith("alarm:") })
    }

    @Test fun mismatchedUpdateReadbackRestoresPreviousRowWithoutClaimingSuccess() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        val previous = runtime.schedule("one", "Agua", future)
        store.incorrectReads += store.getCalls + 2 // after reading previous and writing updated
        store.events.clear()
        fails("mobile_reminder_persist_failed") { runtime.update("one", "Comida", future, 1, "update-1") }
        assertEquals(previous, store.records["one"])
        assertFalse(store.events.any { it.startsWith("alarm:") })
    }

    @Test fun failedUpdateAlarmRollsBackAndRearmsPreviousRevision() {
        val store = MemoryStore()
        val previous = coordinator(store).schedule("one", "Agua", future)
        val scheduled = mutableListOf<ReminderRecord>()
        val runtime = coordinator(store, alarm = {
            if (it.revision == 2L) throw IllegalStateException("alarm_failed")
            scheduled += it
        })
        fails("alarm_failed") { runtime.update("one", "Comida", future, 1, "update-1") }
        assertEquals(previous, store.records["one"])
        assertEquals(listOf(previous), scheduled)
    }

    @Test fun failedUpdateRollbackDoesNotReturnSuccessAndLeavesRecoverableRow() {
        val store = MemoryStore()
        coordinator(store).schedule("one", "Agua", future)
        store.failedPuts += store.putCalls + 2 // updated write succeeds, rollback fails
        val runtime = coordinator(store, alarm = { throw IllegalStateException("alarm_failed") })
        fails("alarm_failed") { runtime.update("one", "Comida", future, 1, "update-1") }
        assertEquals(2L, store.records["one"]?.revision)
        assertEquals("Comida", store.records["one"]?.title)
    }

    @Test fun oldBroadcastRevisionCannotDeliverATitleOnlyUpdate() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("one", "Agua", future)
        val updated = runtime.update("one", "Comida", future, 1, "update-1")
        val due = coordinator(store, at = updated.whenMillis)
        store.events.clear()
        assertFalse(due.deliver("one", updated.whenMillis, 1))
        assertEquals(listOf("get:one"), store.events)
        assertTrue(due.deliver("one", updated.whenMillis, 2))
        assertTrue(store.records.isEmpty())
    }

    @Test fun cancelPersistsAndReconsultsAbsenceBeforePlatformCancellation() {
        val store = MemoryStore()
        coordinator(store).schedule("one", "Agua", future)
        store.events.clear()
        val runtime = coordinator(store, permission = { throw AssertionError("Cancellation needs no notification permission") })
        val cancelled = runtime.cancel("one", 1)
        assertFalse(cancelled.alreadyAbsent)
        assertEquals(listOf("get:one", "remove:one", "get:one", "cancelAlarm:one"), store.events)
        assertTrue(store.records.isEmpty())
        assertFalse(runtime.deliver("one", Instant.parse(future).toEpochMilli(), 1))
    }

    @Test fun repeatedCancelOfAbsentIdStillRequestsRealPlatformCancellation() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        runtime.schedule("one", "Agua", future)
        runtime.cancel("one", 1)
        store.events.clear()
        assertTrue(runtime.cancel("one", 1).alreadyAbsent)
        assertTrue(runtime.cancel("one", 1).alreadyAbsent)
        assertEquals(2, store.events.count { it == "cancelAlarm:one" })
        assertFalse(store.events.any { it.startsWith("alarm:") || it.startsWith("notify:") })
    }

    @Test fun failedCancelRemovalKeepsRowAndDoesNotClaimAlarmCancellation() {
        val store = MemoryStore()
        val previous = coordinator(store).schedule("one", "Agua", future)
        store.removeSucceeds = false
        store.events.clear()
        fails("mobile_reminder_remove_failed") { coordinator(store).cancel("one", 1) }
        assertEquals(previous, store.records["one"])
        assertFalse(store.events.any { it.startsWith("cancelAlarm:") })
    }

    @Test fun cancelRemovalMustBeReconsultedEvenWhenCommitReturnsTrue() {
        val store = MemoryStore()
        val previous = coordinator(store).schedule("one", "Agua", future)
        store.ignoreRemove = true
        store.events.clear()
        fails("mobile_reminder_remove_failed") { coordinator(store).cancel("one", 1) }
        assertEquals(previous, store.records["one"])
        assertFalse(store.events.any { it.startsWith("cancelAlarm:") })
    }

    @Test fun failedPlatformCancellationKeepsDurableAbsenceAndRetryStillCancels() {
        val store = MemoryStore()
        val previous = coordinator(store).schedule("one", "Agua", future)
        fails("cancel_failed") {
            coordinator(store, cancelAlarm = { throw IllegalStateException("cancel_failed") }).cancel("one", 1)
        }
        assertTrue(store.records.isEmpty())
        assertFalse(coordinator(store).deliver("one", previous.whenMillis, 1))
        assertTrue(coordinator(store).cancel("one", 1).alreadyAbsent)
        assertTrue(store.events.contains("cancelAlarm:one"))
    }

    @Test fun malformedRevisionsIdsOrNewUpdateDatesNeverCauseMutation() {
        val store = MemoryStore()
        val runtime = coordinator(store)
        val previous = runtime.schedule("one", "Agua", future)
        store.events.clear()
        for (revision in listOf(0L, -1L, 9007199254740992L)) {
            fails("mobile_reminder_revision_required") { runtime.update("one", "Comida", future, revision, "update") }
            fails("mobile_reminder_revision_required") { runtime.cancel("one", revision) }
        }
        fails("mobile_reminder_id_required") { runtime.list("") }
        fails("mobile_reminder_id_required") { runtime.cancel("", 1) }
        fails("mobile_command_id_required") { runtime.update("one", "Comida", future, 1, "") }
        for (date in listOf("not-a-date", "2026-10-23T11:00:00Z")) {
            fails("mobile_reminder_date_invalid") { runtime.update("one", "Comida", date, 1, "update") }
        }
        assertEquals(previous, store.records["one"])
        assertFalse(store.events.any { it.startsWith("put:") || it.startsWith("remove:") || it.startsWith("alarm:") || it.startsWith("cancelAlarm:") })
    }

    @Test fun wireRevisionsRejectCoercionAndNonFiniteOrFractionalNumbers() {
        for (value in listOf<Any?>(null, "1", true, 0, -1, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992L)) {
            fails("mobile_reminder_revision_required") { requireReminderRevision(value) }
        }
        assertEquals(1L, requireReminderRevision(1))
        assertEquals(2L, requireReminderRevision(2L))
        assertEquals(3L, requireReminderRevision(3.0))
        assertEquals(9007199254740991L, requireReminderRevision(9007199254740991L))
    }
}
