package com.gunter.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class GunterNodeService : Service() {
    private val running = AtomicBoolean(false); private val executor = Executors.newSingleThreadExecutor()
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running.compareAndSet(false, true)) { startForeground(1001, notification()); executor.submit { loop() } }
        return START_STICKY
    }
    override fun onDestroy() { running.set(false); executor.shutdownNow(); super.onDestroy() }
    override fun onTimeout(startId: Int, fgsType: Int) {
        running.set(false)
        getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).edit()
            .putString("notice", "Android pausó el acompañante al alcanzar el límite de ejecución en segundo plano. Abre Gunter para reiniciarlo.")
            .apply()
        executor.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }
    override fun onBind(intent: Intent?): IBinder? = null
    private fun loop() {
        val config = SecureNodeStore(this).load() ?: run { stopSelf(); return }; val api = NodeApi(config.serverUrl); val commands = MobileExecutors(this, config); var heartbeatAt = 0L
        while (running.get()) try {
            if (System.currentTimeMillis() - heartbeatAt > 20_000) { api.heartbeat(config, "ONLINE", JSONObject().put("runtime", true).put("nativeBridge", true)); heartbeatAt = System.currentTimeMillis() }
            val items = api.pull(config).optJSONArray("items") ?: org.json.JSONArray()
            for (index in 0 until items.length()) { val command = items.getJSONObject(index); val commandId = command.getString("id"); try { val output = commands.execute(command.getString("skill"), command.optJSONObject("payload") ?: JSONObject(), commandId); api.result(config, commandId, output.result, output.evidence) } catch (error: Exception) { api.result(config, commandId, JSONObject().put("ok", false).put("error", error.message), JSONObject().put("verified", false)) } }
            Thread.sleep(2500)
        } catch (_: Exception) { Thread.sleep(5000) }
    }
    private fun notification(): android.app.Notification {
        val manager = getSystemService(NotificationManager::class.java); val channel = NotificationChannel("gunter_node", "Gunter activo", NotificationManager.IMPORTANCE_LOW); manager.createNotificationChannel(channel)
        return NotificationCompat.Builder(this, "gunter_node").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Gunter está activo").setContentText("Esperando acciones autorizadas en este dispositivo").setOngoing(true).build()
    }
}
