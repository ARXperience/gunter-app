package com.gunter.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebView
import android.widget.Toast
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** User-selected downloads. Credentials never leave the configured HTTPS origin. */
class WebDownloadController(
    private val activity: Activity,
    private val currentWeb: () -> WebView?,
    private val currentPolicy: () -> WebOriginPolicy?
) {
    private data class Download(val address: String, val policy: WebOriginPolicy, val name: String, val userAgent: String)
    private var pending: Download? = null
    private var busy = false
    @Volatile private var disposed = false
    @Volatile private var connection: HttpURLConnection? = null
    private var dialog: AlertDialog? = null
    private val worker = Executors.newSingleThreadExecutor()

    fun request(address: String) {
        if (disposed || activity.isFinishing || activity.isDestroyed) return
        val policy = currentPolicy()
        if (policy == null || !policy.isInternal(currentWeb()?.url) || !policy.isInternal(address)) {
            explain("Esta descarga no es un archivo HTTPS del servidor de Gunter. Las exportaciones blob/data todavía requieren la versión web en el navegador; no se han guardado.")
            return
        }
        if (pending != null || busy) { explain("Termina o cancela la descarga anterior."); return }
        val filename = URLUtil.guessFileName(address, null, null)
            .replace(Regex("[\\p{Cntrl}/\\\\:*?\"<>|]"), "_").take(120).ifBlank { "archivo-gunter" }
        val download = Download(address, policy, filename, currentWeb()?.settings?.userAgentString.orEmpty())
        dialog?.dismiss()
        dialog = AlertDialog.Builder(activity).setTitle("Guardar archivo")
            .setMessage("Se descargará $filename desde ${policy.origin}. Elige dónde guardarlo. Límite: 50 MiB. No se abrirá ni ejecutará automáticamente.")
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Elegir ubicación") { _, _ ->
                if (!isCurrent(download)) return@setPositiveButton
                pending = download
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/octet-stream"
                    putExtra(Intent.EXTRA_TITLE, download.name)
                }
                try { activity.startActivityForResult(intent, SAVE_DOCUMENT) }
                catch (_: Exception) { pending = null; explain("No se pudo abrir el selector de archivos.") }
            }.create().also { it.show() }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != SAVE_DOCUMENT) return false
        val download = pending; pending = null
        val destination = data?.data
        if (disposed || resultCode != Activity.RESULT_OK) return true
        if (download == null) {
            explain("La app se recreó mientras elegías el destino. La descarga se canceló; repítela desde Gunter. El destino elegido puede contener un archivo vacío que no se ha eliminado automáticamente.")
            return true
        }
        if (destination?.scheme != "content" || !isCurrent(download)) {
            explain("La descarga se canceló: no hay un destino autorizado o cambió el servidor.")
            return true
        }
        // CookieManager is queried on the UI thread, never printed or persisted.
        val cookie = CookieManager.getInstance().getCookie(download.address)
        busy = true
        worker.submit {
            var wrote = false
            val result = runCatching {
                val input = openDownload(download, cookie)
                input.use { source ->
                    activity.contentResolver.openOutputStream(destination, "w")?.use { output ->
                        val buffer = ByteArray(32 * 1024); var total = 0L
                        while (true) {
                            check(!disposed && !Thread.currentThread().isInterrupted) { "download_cancelled" }
                            val count = source.read(buffer); if (count < 0) break
                            total += count; check(total <= MAX_BYTES) { "download_too_large" }
                            output.write(buffer, 0, count); wrote = true
                        }
                        output.flush()
                    } ?: error("download_destination_unavailable")
                }
            }
            connection?.disconnect(); connection = null
            activity.runOnUiThread {
                busy = false
                if (!disposed && !activity.isFinishing && !activity.isDestroyed) {
                    if (result.isSuccess) Toast.makeText(activity, "Archivo guardado: ${download.name}", Toast.LENGTH_LONG).show()
                    else explain(if (wrote) "La descarga no terminó. El archivo elegido puede estar incompleto; no lo uses como copia válida. No se ha eliminado automáticamente."
                        else "No se pudo descargar el archivo. Comprueba tu sesión y conexión. El destino elegido puede contener un archivo vacío.")
                }
            }
        }
        return true
    }

    private fun openDownload(download: Download, cookie: String?): java.io.InputStream {
        var address = download.address
        repeat(5) {
            check(!disposed && download.policy.isInternal(address)) { "download_origin_blocked" }
            val next = (URL(address).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false; connectTimeout = 12000; readTimeout = 30000
                requestMethod = "GET"; setRequestProperty("User-Agent", download.userAgent)
                // Redirects are same-origin only; never forward credentials to an external host.
                if (!cookie.isNullOrBlank()) setRequestProperty("Cookie", cookie)
            }
            connection = next
            val status = next.responseCode
            if (status in 300..399) {
                val location = next.getHeaderField("Location") ?: error("download_redirect_missing")
                address = URL(URL(address), location).toExternalForm()
                next.disconnect(); connection = null
            } else {
                check(status in 200..299) { "download_http_error" }
                check(next.contentLengthLong <= MAX_BYTES) { "download_too_large" }
                return next.inputStream
            }
        }
        error("download_redirect_limit")
    }

    private fun isCurrent(download: Download) = !disposed &&
        currentPolicy()?.origin == download.policy.origin && download.policy.isInternal(currentWeb()?.url)

    private fun explain(message: String) {
        if (disposed || activity.isFinishing || activity.isDestroyed) return
        dialog?.dismiss()
        dialog = AlertDialog.Builder(activity).setTitle("Descargas de Gunter").setMessage(message)
            .setPositiveButton("Entendido", null).create().also { it.show() }
    }

    fun dispose() {
        disposed = true; pending = null; dialog?.dismiss(); dialog = null
        connection?.disconnect(); worker.shutdownNow()
    }

    companion object {
        private const val SAVE_DOCUMENT = 7304
        private const val MAX_BYTES = 50L * 1024 * 1024
        fun handlesRequestCode(code: Int) = code == SAVE_DOCUMENT
    }
}
