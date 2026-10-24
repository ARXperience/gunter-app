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
        val config = SecureNodeStore(this).load() ?: run { running.set(false); stopSelf(); return }
        val api = runCatching { NodeApi(config.serverUrl) }.getOrElse {
            getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).edit().putString("notice",
                "El vínculo guardado no corresponde al servidor de este APK. Abre Dispositivo y vuelve a vincularlo; no se borraron tus datos.").apply()
            running.set(false); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return
        }
        val commands = MobileExecutors(this, config); var heartbeatAt = 0L
        while (running.get()) try {
            if (System.currentTimeMillis() - heartbeatAt > 20_000) { api.heartbeat(config, "ONLINE", JSONObject().put("runtime", true).put("nativeBridge", true)); heartbeatAt = System.currentTimeMillis() }
            val items = api.pull(config).optJSONArray("items") ?: org.json.JSONArray()
            for (index in 0 until items.length()) {
                if (!running.get() || Thread.currentThread().isInterrupted) break
                val command = items.getJSONObject(index); val commandId = command.getString("id")
                val output = try {
                    commands.execute(command.getString("skill"), command.optJSONObject("payload") ?: JSONObject(), commandId)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                } catch (error: Exception) {
                    val code = error.message?.takeIf { it.matches(Regex("mobile_[a-z0-9_]{1,100}")) } ?: "mobile_execution_failed"
                    MobileExecution(JSONObject().put("ok", false).put("error", code), JSONObject().put("verified", false))
                }
                // A rejected/unreachable result endpoint is not another execution failure.
                // Never replay the effect or overwrite its evidence with a second report.
                try { api.result(config, commandId, output.result, output.evidence) }
                catch (_: Exception) {
                    getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).edit().putString("notice",
                        "No se confirmó un resultado con el servidor. Revisa Actividad antes de repetir la acción; podría haberse ejecutado.").apply()
                }
            }
            Thread.sleep(2500)
        } catch (_: Exception) {
            if (!running.get() || Thread.currentThread().isInterrupted) break
            try { Thread.sleep(5000) } catch (_: InterruptedException) {
                Thread.currentThread().interrupt(); break
            }
        }
    }
    private fun notification(): android.app.Notification {
        val manager = getSystemService(NotificationManager::class.java); val channel = NotificationChannel("gunter_node", "Gunter activo", NotificationManager.IMPORTANCE_LOW); manager.createNotificationChannel(channel)
        return NotificationCompat.Builder(this, "gunter_node").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Gunter está activo").setContentText("Esperando acciones autorizadas en este dispositivo").setOngoing(true).build()
    }
}
