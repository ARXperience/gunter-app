package com.gunter.mobile

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import java.io.ByteArrayInputStream

/** Candidate shell. Web credentials stay in WebView, separate from native device pairing. */
class GunterWebActivity : Activity() {
    @Volatile private var policy: WebOriginPolicy? = null
    private var web: WebView? = null
    private lateinit var canvas: FrameLayout
    private lateinit var overlay: LinearLayout
    private lateinit var progress: ProgressBar
    private lateinit var originLabel: TextView
    private var foreground = false
    private var failedPage = false
    private var configuring = false
    private var restoreNavigation: Bundle? = null
    private var pendingMicrophone: PermissionRequest? = null
    private var microphoneWasGranted = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var fileOrigin: String? = null
    private var pickerOpen = false
    private var pickerMultiple = false
    private var activeDialog: AlertDialog? = null
    private var backCallback: OnBackInvokedCallback? = null
    private val downloadsDelegate = lazy { WebDownloadController(this, { web }, { policy }) }
    private val downloads by downloadsDelegate
    private val previewPreferences by lazy { getSharedPreferences("gunter_web_preview", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        renderShell()
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = OnBackInvokedCallback { navigateBack() }.also { onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, it) }
        }
        val fixed = BuildConfig.GUNTER_WEB_ORIGIN
        val configured = if (fixed.isNotBlank()) fixed else if (BuildConfig.DEBUG) previewPreferences.getString("origin", "") else ""
        policy = WebOriginPolicy.fromConfiguredOrigin(configured)
        if (policy == null) showConfiguration() else {
            if (savedInstanceState?.getString(STATE_ORIGIN) == policy?.origin) restoreNavigation = savedInstanceState?.getBundle(STATE_WEB)
            createWebView()
        }
    }

    private fun renderShell() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(246, 248, 250))
            setOnApplyWindowInsetsListener { view, insets ->
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                insets
            }
        }
        root.addView(TextView(this).apply { text = "Gunter"; textSize = 23f; setTextColor(Color.rgb(21, 39, 57)); setPadding(dp(16), dp(8), dp(16), 0); if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true })
        originLabel = TextView(this).apply { textSize = 12f; setPadding(dp(16), dp(2), dp(16), dp(4)); setTextColor(Color.DKGRAY) }
        root.addView(originLabel)
        val navigation = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun action(label: String, click: () -> Unit) {
            navigation.addView(Button(this).apply { text = label; contentDescription = label; minHeight = dp(48); setOnClickListener { click() } })
        }
        action("Atrás") { navigateBack() }
        action("Inicio") { loadHome() }
        action("Dispositivo") { startActivity(Intent(this, MainActivity::class.java)) }
        action("Navegador") { policy?.let { confirmExternal(web?.url?.takeIf(it::isInternal) ?: it.rootUrl) } }
        if (BuildConfig.DEBUG && BuildConfig.GUNTER_WEB_ORIGIN.isBlank()) action("Servidor de prueba") { showConfiguration() }
        root.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(navigation) })
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; visibility = View.GONE }
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        canvas = FrameLayout(this)
        overlay = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(20)); setBackgroundColor(Color.rgb(246, 248, 250)) }
        root.addView(canvas, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        canvas.addView(ScrollView(this).apply { addView(this@GunterWebActivity.overlay) }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
    }

    private fun showConfiguration() {
        configuring = true
        cancelMicrophone()
        if (microphoneWasGranted) {
            restoreNavigation = web?.let { view -> Bundle().also { view.saveState(it) } }
            releaseWebView()
        }
        val canConfigure = BuildConfig.DEBUG && BuildConfig.GUNTER_WEB_ORIGIN.isBlank()
        originLabel.text = "Candidato Android · configuración pendiente"
        showPanel("Conectar con Gunter", if (canConfigure) "Introduce el origen HTTPS de pruebas, sin rutas ni credenciales. Los datos web y la vinculación del dispositivo son almacenes separados." else "Este APK aún no tiene un servidor HTTPS de clientes configurado. No puede iniciar sesión ni conectarse a un servidor elegido desde la pantalla.")
        if (!canConfigure) return
        val field = EditText(this).apply {
            hint = "https://gunter.ejemplo.com"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setText(policy?.origin ?: previewPreferences.getString("origin", ""))
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        overlay.addView(field)
        panelButton("Conectar a este origen") {
            val next = WebOriginPolicy.fromConfiguredOrigin(field.text.toString().trim())
            if (next == null) { field.error = "Usa sólo un origen HTTPS válido, sin ruta, usuario, contraseña ni token."; return@panelButton }
            val previous = previewPreferences.getString("origin", null)
            if (previous != null && previous != next.origin && previewPreferences.getBoolean("has_opened", false)) {
                showDialog(AlertDialog.Builder(this)
                    .setTitle("¿Cambiar el servidor de pruebas?")
                    .setMessage("Los datos y sesiones del origen anterior no se trasladan. La vinculación del dispositivo tampoco cambia. Cambiarás de $previous a ${next.origin}; el almacenamiento web de ambos orígenes permanece separado.")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton("Cambiar") { _, _ -> switchOrigin(next) }
                )
            } else switchOrigin(next)
        }
        if (policy != null) panelButton("Volver a Gunter") { web?.let { hidePanel() } ?: createWebView() }
    }

    private fun switchOrigin(next: WebOriginPolicy) {
        cancelMicrophone()
        completeFiles(null)
        releaseWebView()
        restoreNavigation = null
        policy = next
        previewPreferences.edit().putString("origin", next.origin).apply()
        createWebView()
    }

    @Suppress("DEPRECATION")
    private fun createWebView() {
        val trusted = policy ?: return
        releaseWebView()
        configuring = false
        failedPage = false
        originLabel.text = trusted.origin
        val view = WebView(this)
        web = view
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true) // Popups are refused below, not silently loaded in this view.
            mediaPlaybackRequiresUserGesture = true
            setGeolocationEnabled(false)
            userAgentString = "$userAgentString GunterAndroid/0.2"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        view.webViewClient = client()
        view.webChromeClient = chrome(view)
        view.setDownloadListener { url, _, _, _, _ -> handleDownload(url) }
        canvas.addView(view, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        hidePanel()
        val saved = restoreNavigation
        restoreNavigation = null
        val restored = saved?.let { view.restoreState(it) }
        val validHistory = restored != null && (0 until restored.size).all { trusted.isInternal(restored.getItemAtIndex(it).url) }
        if (!validHistory) { view.clearHistory(); view.loadUrl(trusted.rootUrl) }
        if (BuildConfig.DEBUG) previewPreferences.edit().putBoolean("has_opened", true).apply()
    }

    private fun client() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (web !== view) return true
            val address = request.url.toString()
            if (policy?.isInternal(address) == true) return false
            if (request.isForMainFrame && request.hasGesture() && isTrustedPageActive() && WebOriginPolicy.externalScheme(address) != null) confirmExternal(address)
            else if (request.isForMainFrame) toast("Se bloqueó una navegación fuera del origen de Gunter.")
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            // HTTPS subresources (CDN/API) remain subject to browser CORS; no local content access.
            if (!WebOriginPolicy.isHttps(request.url.toString()) || (request.isForMainFrame && policy?.isInternal(request.url.toString()) != true)) {
                return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
            return null
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (web !== view) return
            cancelMicrophone()
            completeFiles(null)
            if (policy?.isInternal(url) != true) { view.stopLoading(); showError("Se bloqueó una dirección no autorizada."); return }
            failedPage = false
            progress.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (web !== view) return
            progress.visibility = View.GONE
            if (!configuring && !failedPage && policy?.isInternal(url) == true) hidePanel()
            CookieManager.getInstance().flush()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (web === view && request.isForMainFrame) showError("No se pudo cargar Gunter. Revisa la conexión y vuelve a intentarlo. No se ha activado un modo sin conexión.")
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (web === view && request.isForMainFrame) showError("El servidor devolvió un error HTTP ${errorResponse.statusCode}. Puedes reintentar o abrir Gunter en el navegador.")
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            view.stopLoading()
            if (web === view) showError("La conexión segura no es válida. Se canceló la carga; no se permite omitir el certificado.")
        }

        @android.annotation.TargetApi(27)
        override fun onSafeBrowsingHit(view: WebView, request: WebResourceRequest, threatType: Int, callback: SafeBrowsingResponse) {
            callback.backToSafety(true)
            if (web === view && request.isForMainFrame) showError("Navegación bloqueada por la protección de Android.")
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (web !== view) return true
            cancelMicrophone()
            completeFiles(null)
            releaseWebView()
            showError("El motor web se detuvo. Pulsa Reintentar para abrir una vista nueva.")
            return true
        }
    }

    private fun chrome(source: WebView) = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView, value: Int) { if (web === view) progress.progress = value }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean {
            if (web === view && isUserGesture && isTrustedPageActive()) {
                showDialog(AlertDialog.Builder(this@GunterWebActivity).setTitle("Abrir desde el navegador")
                    .setMessage("El inicio de sesión externo, como Google Calendar, puede requerir el navegador. Su sesión y datos no se comparten automáticamente con esta vista de Gunter. Repite allí la acción.")
                    .setNegativeButton("Cancelar", null).setPositiveButton("Abrir Gunter") { _, _ -> policy?.let { confirmExternal(it.rootUrl) } })
            }
            return false
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            if (web !== source) { request.deny(); return }
            activeDialog?.cancel()
            activeDialog = null
            cancelMicrophone()
            val audioOnly = request.resources.toSet() == setOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
            if (!isTrustedPageActive() || !audioOnly || policy?.isInternal(request.origin.toString()) != true) { request.deny(); return }
            pendingMicrophone = request
            showDialog(AlertDialog.Builder(this@GunterWebActivity).setTitle("¿Usar el micrófono?")
                .setMessage("Permitir audio a ${policy?.origin} mientras Gunter esté en primer plano. No se permite la cámara.")
                .setNegativeButton("Cancelar") { _, _ -> cancelMicrophone() }
                .setOnCancelListener { cancelMicrophone() }
                .setPositiveButton("Permitir audio") { _, _ ->
                    if (pendingMicrophone !== request || !isTrustedPageActive()) { cancelMicrophone(); return@setPositiveButton }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        cancelMicrophone()
                        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MICROPHONE)
                    } else {
                        pendingMicrophone = null
                        microphoneWasGranted = true
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    }
                })
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingMicrophone === request) { pendingMicrophone = null; activeDialog?.cancel() }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) { callback.invoke(origin, false, false) }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            if (web !== view) { callback.onReceiveValue(null); return true }
            if (pickerOpen) { callback.onReceiveValue(null); return true }
            if (microphoneWasGranted && isTrustedPageActive()) {
                callback.onReceiveValue(null)
                confirmCaptureReset("adjuntar el archivo")
                return true
            }
            activeDialog?.cancel()
            activeDialog = null
            completeFiles(null)
            if (!isTrustedPageActive() || params.mode !in arrayOf(FileChooserParams.MODE_OPEN, FileChooserParams.MODE_OPEN_MULTIPLE)) { callback.onReceiveValue(null); return true }
            fileCallback = callback
            fileOrigin = policy?.origin
            pickerMultiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
            val mimeTypes = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }.filter { MIME_PATTERN.matches(it) }.distinct().take(32)
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).apply {
                type = if (mimeTypes.size == 1) mimeTypes.first() else "*/*"
                if (mimeTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, pickerMultiple)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            showDialog(AlertDialog.Builder(this@GunterWebActivity).setTitle("Seleccionar archivos")
                .setMessage("Los archivos que elijas se entregarán a la página de ${policy?.origin}. Sólo se abrirá el selector de Android; no se concede acceso general al almacenamiento ni a la cámara.")
                .setNegativeButton("Cancelar") { _, _ -> completeFiles(null) }
                .setOnCancelListener { completeFiles(null) }
                .setPositiveButton("Elegir archivos") { _, _ ->
                    if (!isTrustedPageActive() || fileOrigin != policy?.origin) { completeFiles(null); return@setPositiveButton }
                    pickerOpen = true
                    try { startActivityForResult(intent, REQUEST_FILES) } catch (_: ActivityNotFoundException) { completeFiles(null); toast("No hay un selector de documentos disponible.") }
                })
            return true
        }
    }

    private fun handleDownload(address: String) {
        if (!isTrustedPageActive()) return
        if (microphoneWasGranted) confirmCaptureReset("descargar el archivo") else downloads.request(address)
    }

    /** A native WebView permission grant cannot be revoked independently of its context. */
    private fun confirmCaptureReset(nextAction: String) {
        showDialog(AlertDialog.Builder(this).setTitle("Guardar antes de abrir archivos")
            .setMessage("Esta vista ya recibió acceso al micrófono. Guarda lo que estés editando y cierra la grabación desde Gunter antes de continuar. Para abrir el selector sin dejar audio activo, hay que recargar la vista; lo que no hayas guardado puede perderse. Después vuelve a $nextAction.")
            .setNegativeButton("Seguir en Gunter", null)
            .setPositiveButton("Ya guardé: recargar") { _, _ ->
                if (!isTrustedPageActive()) return@setPositiveButton
                restoreNavigation = web?.let { view -> Bundle().also { view.saveState(it) } }
                cancelMicrophone()
                completeFiles(null)
                releaseWebView()
                createWebView()
                toast("Vista recargada. Vuelve a $nextAction cuando termine de cargar.")
            })
    }

    private fun confirmExternal(address: String) {
        if (!foreground) return
        val scheme = WebOriginPolicy.externalScheme(address) ?: return
        showDialog(AlertDialog.Builder(this).setTitle("¿Abrir otra aplicación?")
            .setMessage("Destino: $address\n\nNo se enviará ningún mensaje ni se realizará una llamada automáticamente. La sesión del navegador es independiente de Gunter Android.")
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Abrir") { _, _ ->
                if (!foreground) return@setPositiveButton
                val action = when (scheme) { "tel" -> Intent.ACTION_DIAL; "mailto", "sms" -> Intent.ACTION_SENDTO; else -> Intent.ACTION_VIEW }
                val intent = Intent(action, Uri.parse(address)).addCategory(Intent.CATEGORY_BROWSABLE)
                try { startActivity(intent) } catch (_: ActivityNotFoundException) { toast("No hay una aplicación disponible para este enlace.") }
            })
    }

    private fun loadHome() { policy?.let { trusted -> if (web == null) createWebView() else { hidePanel(); web?.loadUrl(trusted.rootUrl) } } }
    private fun navigateBack() { val view = web; if (view != null && view.canGoBack()) view.goBack() else finish() }
    @Deprecated("Legacy back callback retained for API 26")
    override fun onBackPressed() { navigateBack() }

    private fun showError(message: String) {
        if (configuring) return
        failedPage = true
        progress.visibility = View.GONE
        cancelMicrophone()
        completeFiles(null)
        if (microphoneWasGranted) releaseWebView()
        showPanel("No se pudo abrir Gunter", message)
        panelButton("Reintentar") { loadHome() }
        panelButton("Abrir en el navegador") { policy?.let { confirmExternal(it.rootUrl) } }
    }

    private fun showPanel(title: String, message: String) {
        overlay.removeAllViews()
        overlay.addView(TextView(this).apply { text = title; textSize = 22f; setTextColor(Color.rgb(21, 39, 57)); if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true })
        overlay.addView(TextView(this).apply { text = message; textSize = 16f; setTextColor(Color.DKGRAY); setPadding(0, dp(12), 0, dp(16)) })
        overlay.parent.let { (it as View).visibility = View.VISIBLE }
        web?.visibility = View.INVISIBLE
    }
    private fun hidePanel() { configuring = false; (overlay.parent as View).visibility = View.GONE; web?.visibility = View.VISIBLE }
    private fun panelButton(label: String, action: () -> Unit) { overlay.addView(Button(this).apply { text = label; minHeight = dp(48); setOnClickListener { action() } }) }
    private fun toast(message: String) { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun isTrustedPageActive(): Boolean = foreground && !configuring && web?.visibility == View.VISIBLE && policy?.isInternal(web?.url) == true

    private fun showDialog(builder: AlertDialog.Builder) {
        activeDialog?.cancel()
        val dialog = builder.create()
        activeDialog = dialog
        dialog.setOnDismissListener { if (activeDialog === dialog) activeDialog = null }
        dialog.show()
    }

    private fun cancelMicrophone() { pendingMicrophone?.deny(); pendingMicrophone = null }
    private fun completeFiles(uris: Array<Uri>?) {
        val callback = fileCallback
        fileCallback = null
        fileOrigin = null
        pickerOpen = false
        callback?.onReceiveValue(uris)
    }

    @Deprecated("Activity result callback retained for API 26")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (WebDownloadController.handlesRequestCode(requestCode) && downloads.onActivityResult(requestCode, resultCode, data)) return
        if (requestCode != REQUEST_FILES || !pickerOpen) return
        if (resultCode != RESULT_OK || data == null || fileOrigin != policy?.origin || policy?.isInternal(web?.url) != true) { completeFiles(null); return }
        val uris = ArrayList<Uri>()
        data.data?.let(uris::add)
        data.clipData?.let { clip -> for (i in 0 until minOf(clip.itemCount, 32)) uris.add(clip.getItemAt(i).uri) }
        val accepted = uris.distinct().filter { uri ->
            uri.scheme == "content" && !uri.authority.isNullOrBlank() && checkUriPermission(uri, android.os.Process.myPid(), android.os.Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED
        }.take(if (pickerMultiple) 32 else 1)
        completeFiles(accepted.takeIf { it.isNotEmpty() }?.toTypedArray())
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_MICROPHONE) {
            cancelMicrophone()
            toast(if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) "Permiso de audio listo. Toca de nuevo el micrófono de Gunter para comenzar." else "Micrófono no autorizado. Puedes seguir escribiendo.")
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_ORIGIN, policy?.origin)
        outState.putBundle(STATE_WEB, web?.let { view -> Bundle().also { view.saveState(it) } } ?: restoreNavigation)
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        ReminderReceiver.reschedulePending(this)
        if (web == null && policy != null) createWebView()
        web?.onResume()
    }

    override fun onPause() {
        foreground = false
        activeDialog?.cancel()
        activeDialog = null
        cancelMicrophone()
        // onPause alone does not revoke getUserMedia. Destroy a granted capture context.
        if (microphoneWasGranted) {
            restoreNavigation = web?.let { view -> Bundle().also { view.saveState(it) } }
            completeFiles(null)
            releaseWebView()
        } else web?.onPause()
        super.onPause()
    }

    private fun releaseWebView() {
        val view = web ?: return
        web = null
        microphoneWasGranted = false
        view.stopLoading()
        (view.parent as? ViewGroup)?.removeView(view)
        view.webChromeClient = null
        view.destroy()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        backCallback = null
        activeDialog?.cancel()
        activeDialog = null
        if (downloadsDelegate.isInitialized()) downloads.dispose()
        cancelMicrophone()
        completeFiles(null)
        releaseWebView()
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_MICROPHONE = 610
        private const val REQUEST_FILES = 611
        private const val STATE_ORIGIN = "gunter.web.origin"
        private const val STATE_WEB = "gunter.web.navigation"
        private val MIME_PATTERN = Regex("^[a-zA-Z0-9!#$&^_.+-]+/(?:[a-zA-Z0-9!#$&^_.+-]+|\\*)$")
    }
}
