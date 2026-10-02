package com.gunter.mobile

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : Activity() {
    private val store by lazy { SecureNodeStore(this) }; private lateinit var status: TextView; private var startAfterNotificationPermission = false; private var enablePushAfterPermission = false
    private lateinit var server: EditText; private lateinit var pairing: EditText; private lateinit var name: EditText
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); createPushChannel(); render(); if (intent?.getStringExtra("kind") == "GUNTER_COMMAND_READY") startNode() }
    override fun onResume() {
        super.onResume()
        val optedIn = getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).getBoolean("push_enabled", false)
        if (optedIn && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) deactivatePush()
    }
    private fun createPushChannel() { if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("gunter_commands", "Avisos de Gunter", NotificationManager.IMPORTANCE_HIGH)) }
    private fun render() {
        val pad = (20 * resources.displayMetrics.density).toInt(); val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        fun field(label: String, value: String = "") = EditText(this).apply { hint = label; setText(value); root.addView(this) }
        root.addView(TextView(this).apply { text = "Gunter para Android"; textSize = 26f })
        status = TextView(this).apply { text = getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).getString("notice", null) ?: (store.load()?.let { "Vinculado como ${it.deviceName}" } ?: "Este dispositivo aún no está vinculado."); setPadding(0, pad / 2, 0, pad / 2) }; root.addView(status)
        server = field("URL HTTPS de Gunter", store.load()?.serverUrl ?: "")
        pairing = field("Token de vinculación gp_…")
        name = field("Nombre del dispositivo", Build.MODEL)
        root.addView(Button(this).apply { text = "Vincular dispositivo"; setOnClickListener { pair() } })
        root.addView(Button(this).apply { text = "Elegir carpeta autorizada"; isEnabled = store.load() != null; setOnClickListener { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 41) } })
        root.addView(Button(this).apply { text = "Iniciar Gunter en este móvil"; setOnClickListener { startNode() } })
        root.addView(Button(this).apply { text = "Detener Gunter en este móvil"; setOnClickListener { stopNode() } })
        root.addView(Button(this).apply { text = "Configurar notificaciones"; setOnClickListener { startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) } })
        root.addView(Button(this).apply { text = "Activar avisos push de Gunter"; setOnClickListener { activatePush() } })
        root.addView(Button(this).apply { text = "Desactivar avisos push"; setOnClickListener { deactivatePush() } })
        root.addView(Button(this).apply { text = "Permitir control multimedia"; setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) } })
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })
    }
    private fun pair() {
        val url = server.text.toString().trim().trimEnd('/'); val token = pairing.text.toString().trim(); if (!url.startsWith("https://") || !token.startsWith("gp_")) { status.text = "Indica una URL HTTPS y un acceso de un solo uso válido."; return }
        val deviceName = name.text.toString().trim().ifEmpty { Build.MODEL }
        status.text = "Vinculando…"; Thread { runCatching { NodeApi(url).claim(token, deviceName) }.onSuccess { config -> store.save(config); runOnUiThread { status.text = "Vinculado como ${config.deviceName}. Ya puedes iniciarlo."; render() } }.onFailure { error -> runOnUiThread { status.text = "No se pudo vincular: ${error.message}" } } }.start()
    }
    private fun startNode() {
        if (store.load() == null) { status.text = "Vincula este dispositivo primero."; return }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            startAfterNotificationPermission = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 40)
            return
        }
        getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).edit().remove("notice").apply()
        val intent = Intent(this, GunterNodeService::class.java); if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent); status.text = "Gunter está activo en segundo plano."
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 40 && startAfterNotificationPermission) {
            startAfterNotificationPermission = false
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startNode()
            else status.text = "No se inició: Android necesita notificaciones para mostrar que Gunter sigue activo. Puedes habilitarlas en Ajustes."
        }
        if (requestCode == 42 && enablePushAfterPermission) {
            enablePushAfterPermission = false
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) registerPushToken()
            else status.text = "No se activaron los avisos: permite notificaciones para recibir alertas de Gunter."
        }
    }
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent); setIntent(intent)
        if (intent?.getStringExtra("kind") == "GUNTER_COMMAND_READY") startNode()
    }
    private fun activatePush() {
        if (store.load() == null) { status.text = "Vincula este dispositivo antes de activar los avisos."; return }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            enablePushAfterPermission = true; requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 42); return
        }
        registerPushToken()
    }
    private fun registerPushToken() {
        val config = store.load() ?: return
        if (FirebaseApp.getApps(this).isEmpty()) { status.text = "Falta configurar Firebase para esta app. Añade android/app/google-services.json desde tu proyecto Firebase."; return }
        getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).edit().putBoolean("push_enabled", true).apply()
        status.text = "Activando avisos push…"
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful || task.result.isNullOrBlank()) { status.text = "No pude obtener el token de avisos de Firebase."; return@addOnCompleteListener }
            val token = task.result
            Thread { runCatching { NodeApi(config.serverUrl).registerPushToken(config, token) }
                .onSuccess { result -> runOnUiThread { status.text = if (result.optJSONObject("push")?.optBoolean("deliveryConfigured", false) == true) "Avisos push activados en este móvil." else "Token guardado; falta configurar el envío FCM en el servidor." } }
                .onFailure { runOnUiThread { status.text = "No se pudieron activar los avisos push." } }
            }.start()
        }
    }
    private fun deactivatePush() {
        getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).edit().putBoolean("push_enabled", false).apply()
        if (FirebaseApp.getApps(this).isNotEmpty()) FirebaseMessaging.getInstance().deleteToken()
        val config = store.load() ?: run { status.text = "Este dispositivo no está vinculado."; return }
        Thread { runCatching { NodeApi(config.serverUrl).clearPushToken(config) }
            .onSuccess { runOnUiThread { status.text = "Avisos push desactivados en el servidor." } }
            .onFailure { runOnUiThread { status.text = "No pude desactivar los avisos push." } }
        }.start()
    }
    private fun stopNode() { stopService(Intent(this, GunterNodeService::class.java)); val notice = "Gunter se detuvo en este móvil. El dispositivo sigue vinculado."; getSharedPreferences("gunter_mobile_runtime", MODE_PRIVATE).edit().putString("notice", notice).apply(); status.text = notice }
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) { super.onActivityResult(requestCode, resultCode, data); if (requestCode == 41 && resultCode == RESULT_OK && data?.data != null) { val uri = data.data!!; contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); store.load()?.let { store.save(it.copy(folders = setOf(uri.toString()))); status.text = "Carpeta autorizada. Esta será la carpeta de trabajo del móvil." } } }
}
