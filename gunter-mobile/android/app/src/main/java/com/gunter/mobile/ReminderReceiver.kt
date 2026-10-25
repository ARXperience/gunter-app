package com.gunter.mobile

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, ACTION_REMINDER)) return
        val app = context.applicationContext
        val pending = goAsync()
        Thread({
            try {
                val coordinator = coordinator(app)
                if (intent.action == Intent.ACTION_BOOT_COMPLETED) coordinator.restore()
                else {
                    val id = intent.getStringExtra("id")
                    if (id != null && intent.data == alarmUri(id)) {
                        coordinator.deliver(id, intent.getLongExtra("whenMillis", -1), intent.getLongExtra("revision", 1))
                    }
                }
            } catch (_: Exception) {
                // No titles, IDs or notification contents in logs. Failed delivery leaves
                // its durable record intact for app-resume/boot recovery after permission.
                Log.w("GunterReminder", "Reminder delivery/recovery deferred; inspect notification permission or local storage")
            } finally { pending.finish() }
        }, "gunter-reminder-receiver").start()
    }

    companion object {
        private const val CHANNEL = "gunter_reminders"
        private const val ACTION_REMINDER = "com.gunter.mobile.REMINDER"

        internal fun schedule(context: Context, id: String, title: String, runAt: String): ReminderRecord =
            coordinator(context.applicationContext).schedule(id, title, runAt)

        internal fun list(context: Context, id: String? = null): List<ReminderRecord> =
            coordinator(context.applicationContext).list(id)

        internal fun update(context: Context, id: String, title: String, runAt: String, expectedRevision: Long, mutationId: String): ReminderRecord =
            coordinator(context.applicationContext).update(id, title, runAt, expectedRevision, mutationId)

        internal fun cancel(context: Context, id: String, expectedRevision: Long): ReminderCancellation =
            coordinator(context.applicationContext).cancel(id, expectedRevision)

        /** Safe to call when the app resumes or notification permission is granted. */
        fun reschedulePending(context: Context) {
            val app = context.applicationContext
            Thread({
                runCatching { coordinator(app).restore() }.onFailure {
                    Log.w("GunterReminder", "Reminder recovery deferred; notification permission or local storage unavailable")
                }
            }, "gunter-reminder-recovery").start()
        }

        private fun coordinator(context: Context): ReminderCoordinator = ReminderCoordinator(
            ReminderStore(context),
            { record -> scheduleAlarm(context, record) },
            { requireNotifications(context) },
            { record -> postNotification(context, record) },
            { id -> cancelAlarm(context, id) }
        )

        private fun requireNotifications(context: Context) {
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                throw IllegalStateException("mobile_reminder_notification_permission_required")
            }
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Recordatorios de Gunter", NotificationManager.IMPORTANCE_DEFAULT))
            val channel = manager.getNotificationChannel(CHANNEL)
            if (!manager.areNotificationsEnabled() || channel == null || channel.importance == NotificationManager.IMPORTANCE_NONE) {
                throw IllegalStateException("mobile_reminder_notifications_disabled")
            }
        }

        private fun alarmUri(id: String): Uri = Uri.Builder().scheme("gunter-reminder").authority("local").appendPath(id).build()

        private fun scheduleAlarm(context: Context, record: ReminderRecord) {
            // Intent extras are not part of PendingIntent identity. A unique data URI avoids
            // hashCode collisions silently replacing another reminder in this app.
            val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_REMINDER)
                .setData(alarmUri(record.id)).putExtra("id", record.id).putExtra("whenMillis", record.whenMillis)
                .putExtra("revision", record.revision)
            val pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, maxOf(record.whenMillis, System.currentTimeMillis() + 1000), pending)
        }

        private fun cancelAlarm(context: Context, id: String) {
            val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_REMINDER).setData(alarmUri(id))
            // Obtain the same identity even on a repeated cancellation. Creating a token
            // here does not schedule an alarm; it lets every retry call the real cancel
            // APIs rather than infer success from a missing local row or cached status.
            val pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)
            (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending)
            pending.cancel()
            context.getSystemService(NotificationManager::class.java).cancel(id, 0)
        }

        private fun postNotification(context: Context, record: ReminderRecord) {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: Intent(context, MainActivity::class.java)
            val open = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val delayed = System.currentTimeMillis() - record.whenMillis > 60_000
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(if (delayed) "Gunter: recordatorio pendiente" else "Gunter te recuerda")
                .setContentText(record.title).setStyle(NotificationCompat.BigTextStyle().bigText(record.title))
                .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                throw IllegalStateException("mobile_reminder_notification_permission_required")
            }
            // A stable string tag, rather than hashCode(), also avoids notification clashes.
            context.getSystemService(NotificationManager::class.java).notify(record.id, 0, notification)
        }
    }
}
