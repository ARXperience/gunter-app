package com.gunter.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class GunterMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        if (!getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).getBoolean("push_enabled", false)) return
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        val config = SecureNodeStore(this).load() ?: return
        runCatching { NodeApi(config.serverUrl).registerPushToken(config, token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val commandId = message.data["commandId"] ?: return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("gunter_commands", "Avisos de Gunter", NotificationManager.IMPORTANCE_HIGH))
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        val intent = Intent(this, MainActivity::class.java)
            .putExtra("kind", "GUNTER_COMMAND_READY").putExtra("commandId", commandId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(this, commandId.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = androidx.core.app.NotificationCompat.Builder(this, "gunter_commands")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle("Gunter tiene una acción pendiente")
            .setContentText("Toca para abrir la app y continuar con la acción autorizada.")
            .setContentIntent(pending).setAutoCancel(true).setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH).build()
        manager.notify(commandId.hashCode(), notification)
    }
}
