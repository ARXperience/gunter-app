package com.gunter.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.util.concurrent.Executors

/** Only an export protocol: never accepts paths, native method names, tokens or arbitrary code. */
class WebBlobExportController(
    private val activity: Activity,
    private val currentWeb: () -> WebView?,
    private val currentPolicy: () -> WebOriginPolicy?,
    private val beforeFileOperation: () -> Boolean,
    private val otherDownloadBusy: () -> Boolean
) {
    private class Transfer(val metadata: WebExportProtocol.Metadata, val view: WebView, val origin: String, val reply: JavaScriptReplyProxy) {
        @Volatile var cancelled = false
        var file: File? = null
        var output: OutputStream? = null
        var bytes = 0L
        var sequence = 0
        var inFlight = false
    }
    private data class Prepared(val metadata: WebExportProtocol.Metadata, val file: File, val view: WebView, val origin: String)
    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var attached: WebView? = null
    private var attachedOrigin: String? = null
    private var script: ScriptHandler? = null
    private var transfer: Transfer? = null
    private var prepared: Prepared? = null
    private var dialog: AlertDialog? = null
    private var timeout: Runnable? = null
    private var pickerOpen = false
    private var copying = false
    private var active = false
    @Volatile private var disposed = false
    @Volatile private var copyOutput: OutputStream? = null
    @Volatile private var copyCancelled = false
    private var deferredNotice: String? = null

    val isBusy: Boolean get() = transfer != null || prepared != null || copying

    /** Must run before loadUrl/restoreState, never after the first export has already run. */
    fun attachTo(view: WebView, policy: WebOriginPolicy) {
        detach()
        if (disposed || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        attached = view
        attachedOrigin = policy.origin
        try {
            WebViewCompat.addWebMessageListener(view, WebExportScript.BRIDGE, setOf(policy.origin)) { source, message, sourceOrigin, isMainFrame, reply ->
                if (source !== attached || source !== currentWeb() || !isMainFrame || currentPolicy()?.origin != attachedOrigin || !policy.isInternal(sourceOrigin.toString())) return@addWebMessageListener
                if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
                val data = message.data ?: return@addWebMessageListener
                if (data.length > WebExportProtocol.MAX_MESSAGE_CHARS) { cancelTransfer(); return@addWebMessageListener }
                val json = runCatching { JSONObject(data) }.getOrNull() ?: run { cancelTransfer(); return@addWebMessageListener }
                val id = json.optString("id")
                if (!Regex("^[a-f0-9]{32}$").matches(id)) return@addWebMessageListener
                if (!isCurrent(source, policy.origin) || !active) { reply(reply, id, "cancel"); return@addWebMessageListener }
                receive(source, policy.origin, reply, json, id)
            }
            script = WebViewCompat.addDocumentStartJavaScript(view, WebExportScript.source(policy.origin), setOf(policy.origin))
        } catch (_: Exception) { detach() }
    }

    private fun receive(view: WebView, origin: String, response: JavaScriptReplyProxy, json: JSONObject, id: String) {
        try {
            when (json.optString("type")) {
                "begin" -> {
                    if (isBusy || otherDownloadBusy() || !beforeFileOperation() || !isCurrent(view, origin)) { reply(response, id, "cancel"); return }
                    require(json.opt("size") is String && json.opt("name") is String && json.opt("mime") is String)
                    val meta = WebExportProtocol.metadata(id, json.getString("name"), json.getString("mime"), json.getString("size"))
                    val item = Transfer(meta, view, origin, response)
                    transfer = item
                    armTimeout(180000)
                    dialog = AlertDialog.Builder(activity).setTitle("Preparar exportación")
                        .setMessage("Gunter solicita exportar ${meta.name} (${meta.size} bytes). Se preparará temporalmente en la caché privada; después elegirás dónde guardarlo. No se abrirá ni ejecutará automáticamente.")
                        .setNegativeButton("Cancelar") { _, _ -> cancelTransfer() }
                        .setOnCancelListener { cancelTransfer() }
                        .setPositiveButton("Preparar y elegir destino") { _, _ ->
                            dialog = null
                            if (transfer !== item || !active || !isCurrent(view, origin)) { cancelTransfer(); return@setPositiveButton }
                            item.inFlight = true
                            worker.execute {
                                val result = runCatching {
                                    check(!item.cancelled && !disposed)
                                    val file = File.createTempFile("gunter-export-", ".part", activity.cacheDir)
                                    item.file = file
                                    item.output = file.outputStream()
                                }
                                handler.post {
                                    if (transfer !== item || item.cancelled) return@post
                                    item.inFlight = false
                                    if (result.isFailure || !active || !isCurrent(view, origin)) { cancelTransfer(); explain("No se pudo preparar la exportación. No se guardó un archivo de usuario.") }
                                    else { armTimeout(45000); reply(item.reply, id, "start") }
                                }
                            }
                        }.create().also { it.show() }
                }
                "chunk" -> {
                    val item = transfer ?: return
                    require(item.metadata.id == id && item.view === view && !item.inFlight && item.output != null)
                    val seq = sequence(json)
                    require(seq == item.sequence && json.opt("data") is String)
                    val bytes = WebExportProtocol.decodeChunk(json.getString("data"), item.bytes, item.metadata.size)
                    item.inFlight = true
                    worker.execute {
                        val result = runCatching { check(!item.cancelled && !disposed); item.output!!.write(bytes) }
                        handler.post {
                            if (transfer !== item || item.cancelled) return@post
                            item.inFlight = false
                            if (result.isFailure || !active || !isCurrent(view, origin)) cancelTransfer()
                            else { item.bytes += bytes.size; item.sequence++; armTimeout(45000); reply(item.reply, id, "ack", seq) }
                        }
                    }
                }
                "end" -> {
                    val item = transfer ?: return
                    require(item.metadata.id == id && item.view === view && !item.inFlight && item.output != null && sequence(json) == item.sequence && item.bytes == item.metadata.size)
                    item.inFlight = true
                    worker.execute {
                        val result = runCatching { check(!item.cancelled && !disposed); item.output!!.flush(); item.output!!.close(); item.output = null; check(item.file!!.length() == item.metadata.size) }
                        handler.post {
                            if (transfer !== item || item.cancelled) return@post
                            if (result.isFailure || !active || !isCurrent(view, origin)) { cancelTransfer(); return@post }
                            clearTimeout()
                            transfer = null
                            val export = Prepared(item.metadata, item.file!!, view, origin)
                            prepared = export
                            reply(item.reply, id, "prepared")
                            openPicker(export)
                        }
                    }
                }
                "cancel" -> if (transfer?.metadata?.id == id) cancelTransfer()
                else -> { reply(response, id, "cancel"); cancelTransfer() }
            }
        } catch (_: Exception) {
            reply(response, id, "cancel")
            cancelTransfer()
            explain("La exportación se canceló: formato, tamaño o secuencia no válidos. No se reintentó automáticamente.")
        }
    }

    private fun openPicker(item: Prepared) {
        if (!active || !isCurrent(item.view, item.origin) || !beforeFileOperation()) { clearPrepared(); return }
        pickerOpen = true
        try {
            activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = item.metadata.mime
                putExtra(Intent.EXTRA_TITLE, item.metadata.name)
            }, SAVE_EXPORT)
        } catch (_: Exception) { clearPrepared(); explain("No se pudo abrir el selector. La exportación temporal se descartó.") }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (!handlesRequestCode(requestCode)) return false
        val item = prepared
        prepared = null
        pickerOpen = false
        if (disposed) { item?.let { deleteLater(it.file) }; return true }
        if (resultCode != Activity.RESULT_OK) { item?.let { deleteLater(it.file) }; return true }
        if (item == null) { explain("La app se recreó durante la exportación. Se canceló; repite la exportación desde Gunter. El destino puede contener un archivo vacío."); return true }
        val destination = data?.data
        if (destination?.scheme != "content" || destination.authority.isNullOrBlank() || !isCurrent(item.view, item.origin) || activity.checkUriPermission(destination, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
            deleteLater(item.file); explain("La exportación se canceló: el destino o el origen ya no están autorizados."); return true
        }
        copying = true
        copyCancelled = false
        worker.execute {
            var wrote = false
            val result = runCatching {
                check(!disposed && !copyCancelled && item.file.length() == item.metadata.size)
                item.file.inputStream().use { input ->
                    activity.contentResolver.openOutputStream(destination, "w")?.use { output ->
                        copyOutput = output
                        val bytes = ByteArray(WebExportProtocol.CHUNK_BYTES); var total = 0L
                        while (true) {
                            check(!disposed && !copyCancelled)
                            val count = input.read(bytes); if (count < 0) break
                            total += count; check(total <= item.metadata.size)
                            output.write(bytes, 0, count); wrote = true
                        }
                        check(total == item.metadata.size); output.flush()
                    } ?: error("export_destination_unavailable")
                }
            }
            copyOutput = null
            item.file.delete()
            handler.post {
                copying = false
                if (!disposed) explain(if (result.isSuccess) "Archivo guardado: ${item.metadata.name}" else if (wrote) "La exportación no terminó. El archivo elegido puede estar incompleto; no lo uses como copia válida. No se eliminó automáticamente." else "No se pudo guardar la exportación. El destino elegido puede contener un archivo vacío.")
            }
        }
        return true
    }

    fun onResume() { active = true; deferredNotice?.let { deferredNotice = null; explain(it) } }
    fun onPause() { active = false; cancelTransfer(); if (!pickerOpen) { clearPrepared(); cancelCopy() } }
    fun onPageStarted(view: WebView) { if (view === attached) { cancelTransfer(); clearPrepared(); cancelCopy() } }
    fun onWebViewReleased(view: WebView) { if (view === attached) detach() }

    private fun isCurrent(view: WebView, origin: String): Boolean = !disposed && view === currentWeb() && currentPolicy()?.origin == origin && currentPolicy()?.isInternal(view.url) == true
    private fun sequence(json: JSONObject): Int {
        val value = json.opt("seq")
        require(value is Number && Regex("^(0|[1-9][0-9]{0,4})$").matches(value.toString()))
        return value.toString().toInt()
    }
    private fun reply(proxy: JavaScriptReplyProxy, id: String, type: String, seq: Int? = null) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        runCatching { proxy.postMessage(JSONObject().put("type", type).put("id", id).apply { if (seq != null) put("seq", seq) }.toString()) }
    }
    private fun armTimeout(ms: Long) { clearTimeout(); timeout = Runnable { cancelTransfer(); explain("La exportación se canceló por inactividad. No se guardó un archivo de usuario.") }.also { handler.postDelayed(it, ms) } }
    private fun clearTimeout() { timeout?.let(handler::removeCallbacks); timeout = null }
    private fun cancelTransfer() {
        clearTimeout()
        val item = transfer; transfer = null
        dialog?.dismiss(); dialog = null
        if (item != null) {
            item.cancelled = true
            reply(item.reply, item.metadata.id, "cancel")
            worker.execute { runCatching { item.output?.close() }; item.output = null; item.file?.delete() }
        }
    }
    private fun clearPrepared() { pickerOpen = false; prepared?.let { deleteLater(it.file) }; prepared = null }
    private fun deleteLater(file: File) { worker.execute { file.delete() } }
    private fun detach() {
        cancelTransfer(); clearPrepared(); cancelCopy()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) runCatching { script?.remove() }
        script = null
        attached?.let { view -> if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) runCatching { WebViewCompat.removeWebMessageListener(view, WebExportScript.BRIDGE) } }
        attached = null; attachedOrigin = null
    }
    private fun explain(message: String) {
        if (disposed || activity.isFinishing || activity.isDestroyed) return
        if (!active) { deferredNotice = message; return }
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
    }
    fun dispose() {
        if (disposed) return
        detach(); active = false; disposed = true
        worker.shutdown() // Drain owned-file cleanup; never abandon queued deletion.
    }
    private fun cancelCopy() {
        if (copyCancelled) return
        copyCancelled = true
        val output = copyOutput
        if (output != null) Thread({ runCatching { output.close() } }, "gunter-export-cancel").start()
    }
    companion object {
        private const val SAVE_EXPORT = 7305
        fun handlesRequestCode(code: Int) = code == SAVE_EXPORT
    }
}
