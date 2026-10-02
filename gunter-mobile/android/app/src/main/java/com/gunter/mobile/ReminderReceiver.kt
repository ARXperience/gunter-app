package com.gunter.mobile

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import java.time.Instant

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val manager = context.getSystemService(NotificationManager::class.java); manager.createNotificationChannel(NotificationChannel("gunter_reminders", "Recordatorios de Gunter", NotificationManager.IMPORTANCE_DEFAULT))
        manager.notify(intent.getStringExtra("id")?.hashCode() ?: 0, NotificationCompat.Builder(context, "gunter_reminders").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Gunter te recuerda").setContentText(intent.getStringExtra("title") ?: "Tienes un recordatorio").setAutoCancel(true).build())
    }
    companion object {
        fun schedule(context: Context, id: String, title: String, runAt: String) {
            val whenMillis = Instant.parse(runAt).toEpochMilli(); if (whenMillis <= System.currentTimeMillis()) throw IllegalStateException("mobile_reminder_date_invalid")
            val intent = Intent(context, ReminderReceiver::class.java).putExtra("id", id).putExtra("title", title)
            val pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenMillis, pending)
        }
    }
}
