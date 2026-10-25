package com.gunter.mobile

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.Dialog
import android.app.NotificationManager
import android.app.TimePickerDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.text.format.DateFormat
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ScrollView
import android.widget.TextView
import java.lang.ref.WeakReference
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Local-only management. The host must close on pause/destroy and create a new
 * instance on reopening. Closing the view is not a promise to undo a confirmed action. */
class LocalRemindersDialog(activity: Activity) : AutoCloseable {
    private val host = WeakReference(activity)
    private val app = activity.applicationContext
    private val density = activity.resources.displayMetrics.density
    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val dialogs = mutableSetOf<Dialog>()
    @Volatile private var closed = false
    private var busy = false
    private var records = emptyList<ReminderRecord>()
    private var main: AlertDialog? = null
    private var list: ListView? = null
    private var rows: ReminderRows? = null
    private var status: TextView? = null

    fun show() {
        val activity = activeHost() ?: return
        if (main?.isShowing == true) return
        val header = column(activity).apply { setPadding(dp(16), dp(8), dp(16), dp(12)) }
        header.addView(label(activity, "Sólo guardados en este celular; no se sincronizan con tu agenda ni con otros dispositivos.", 15f))
        header.addView(label(activity, "Android puede retrasar los avisos. La lista muestra registros guardados, no confirma su entrega.", 13f))
        status = label(activity, "Consultando…", 14f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        header.addView(status)
        val adapter = ReminderRows()
        val listView = ListView(activity).apply {
            addHeaderView(header, null, false)
            setItemsCanFocus(true)
            this.adapter = adapter
            minimumHeight = dp(180)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                (activity.resources.displayMetrics.heightPixels * 0.60).toInt())
        }
        rows = adapter
        list = listView
        val dialog = AlertDialog.Builder(activity).setTitle("Recordatorios de este celular").setView(listView)
            .setNegativeButton("Cerrar") { _, _ -> close() }
            .setNeutralButton("Actualizar", null).setPositiveButton("Nuevo", null).create()
        main = dialog
        track(dialog) { close() }
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { if (!busy) refresh() }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { if (!busy) editor(null) }
            refresh()
        }
        dialog.show()
    }

    override fun close() {
        if (closed) return
        closed = true
        handler.removeCallbacksAndMessages(null)
        worker.shutdownNow()
        val dismiss = {
            dialogs.toList().forEach { it.setOnDismissListener(null); it.dismiss() }
            dialogs.clear()
            list?.adapter = null
            list = null; rows = null; status = null; main = null
            records = emptyList()
            host.clear()
        }
        if (Looper.myLooper() == Looper.getMainLooper()) dismiss() else handler.post { dismiss() }
    }

    private fun activeHost(): Activity? = if (closed) null else host.get()?.takeUnless { it.isFinishing || it.isDestroyed }
    private fun dp(value: Int) = (value * density).toInt()
    private fun column(activity: Activity) = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private fun label(activity: Activity, value: String, size: Float) = TextView(activity).apply {
        text = value; textSize = size; setPadding(0, dp(6), 0, dp(6))
    }
    private fun button(activity: Activity, value: String, action: () -> Unit) = Button(activity).apply {
        text = value; minHeight = dp(48); isAllCaps = false
        setOnClickListener { if (!busy && activeHost() != null) action() }
    }

    private fun <T : Dialog> track(dialog: T, onDismiss: () -> Unit = {}): T {
        dialogs += dialog
        dialog.setOnDismissListener { dialogs -= dialog; onDismiss() }
        return dialog
    }

    private fun setBusy(value: Boolean) {
        busy = value
        main?.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = !value
        main?.getButton(AlertDialog.BUTTON_NEUTRAL)?.isEnabled = !value
        fun controls(view: View) {
            if (view is Button) view.isEnabled = !value
            if (view is ViewGroup) for (index in 0 until view.childCount) controls(view.getChildAt(index))
        }
        list?.let(::controls)
    }

    private fun <T> work(message: String, task: () -> T, completed: (Result<T>) -> Unit) {
        if (busy || activeHost() == null) return
        setBusy(true)
        status?.text = message
        try {
            worker.submit {
                if (closed) return@submit
                val result = runCatching(task)
                handler.post {
                    if (activeHost() == null) return@post
                    setBusy(false)
                    completed(result)
                }
            }
        } catch (_: RejectedExecutionException) {
            if (activeHost() != null) {
                setBusy(false)
                status?.text = "La vista se cerró. Vuelve a abrir Recordatorios para consultar su estado."
            }
        }
    }

    private fun refresh(notice: String? = null) {
        work("Consultando registros locales…", { ReminderReceiver.list(app) }) { result ->
            result.onSuccess {
                records = it
                rows?.notifyDataSetChanged()
                status?.text = notice ?: if (it.isEmpty()) "No hay recordatorios locales pendientes." else "${it.size} registros locales pendientes."
            }.onFailure {
                status?.text = "No pude consultar el almacenamiento local. La lista puede estar desactualizada."
            }
        }
    }

    private fun editor(record: ReminderRecord?) {
        val activity = activeHost() ?: return
        val zone = ZoneId.systemDefault()
        val initial = record?.let { Instant.ofEpochMilli(it.whenMillis).atZone(zone) }
            ?: Instant.now().atZone(zone).plusHours(1).withSecond(0).withNano(0)
        var date = initial.toLocalDate()
        var time = initial.toLocalTime().withSecond(0).withNano(0)
        val localId = record?.id ?: "local_${UUID.randomUUID()}"
        val mutationId = "local_update_${UUID.randomUUID()}"
        val content = column(activity).apply { setPadding(dp(20), dp(8), dp(20), dp(8)) }
        content.addView(label(activity, "Hora del teléfono: ${zone.id}", 13f))
        content.addView(label(activity, "Título", 14f))
        val title = EditText(activity).apply {
            hint = "Qué quieres recordar"; setText(record?.title.orEmpty())
            filters = arrayOf(InputFilter.LengthFilter(180))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setSingleLine(false); maxLines = 3
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        content.addView(title)
        val dateButton = button(activity, "", {})
        val timeButton = button(activity, "", {})
        fun updateLabels() {
            dateButton.text = "Fecha: ${date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()))}"
            timeButton.text = "Hora: ${time.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.getDefault()))}"
        }
        dateButton.setOnClickListener {
            if (busy || activeHost() == null) return@setOnClickListener
            track(DatePickerDialog(activity, { _, year, month, day ->
                if (activeHost() != null) { date = LocalDate.of(year, month + 1, day); updateLabels() }
            }, date.year, date.monthValue - 1, date.dayOfMonth)).show()
        }
        timeButton.setOnClickListener {
            if (busy || activeHost() == null) return@setOnClickListener
            track(TimePickerDialog(activity, { _, hour, minute ->
                if (activeHost() != null) { time = LocalTime.of(hour, minute); updateLabels() }
            }, time.hour, time.minute, DateFormat.is24HourFormat(activity))).show()
        }
        updateLabels()
        content.addView(dateButton); content.addView(timeButton)
        if (record != null) content.addView(label(activity, "Revisión ${record.revision} · se comprobará antes de guardar.", 13f))
        val error = label(activity, "", 14f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        content.addView(error)
        val dialog = track(AlertDialog.Builder(activity).setTitle(if (record == null) "Nuevo recordatorio local" else "Editar recordatorio local")
            .setView(ScrollView(activity).apply { addView(content) }).setNegativeButton("Volver", null)
            .setPositiveButton("Revisar", null).create())
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (busy || activeHost() == null) return@setOnClickListener
                val text = title.text.toString().trim()
                if (text.isEmpty()) { title.error = "Escribe un título."; return@setOnClickListener }
                if (text.length > 180) { title.error = "El máximo es de 180 caracteres."; return@setOnClickListener }
                val local = LocalDateTime.of(date, time)
                val offsets = zone.rules.getValidOffsets(local)
                if (offsets.size != 1) {
                    error.text = "Esta hora no existe o se repite por el cambio de horario. Elige otra hora no ambigua."
                    return@setOnClickListener
                }
                val at = local.atOffset(offsets.single()).toInstant()
                if (!at.isAfter(Instant.now())) { error.text = "Elige una fecha y hora futuras."; return@setOnClickListener }
                if (!notificationsAllowed()) { notificationSettings(); return@setOnClickListener }
                error.text = ""
                confirm(if (record == null) "Crear en este celular" else "Guardar cambios locales",
                    "$text\n${readable(at)}\n${record?.let { "Revisión ${it.revision}\n" }.orEmpty()}Android puede retrasar el aviso.") {
                    dialog.dismiss()
                    mutate("Guardando recordatorio local…", {
                        if (record == null) ReminderReceiver.schedule(app, localId, text, at.toString())
                        else ReminderReceiver.update(app, record.id, text, at.toString(), record.revision, mutationId)
                    }, "Guardado en este celular. Android puede retrasar el aviso.")
                }
            }
        }
        dialog.show()
    }

    private fun cancel(record: ReminderRecord) {
        confirm("Cancelar recordatorio local", "${record.title}\n${readable(Instant.ofEpochMilli(record.whenMillis))}\nRevisión ${record.revision}\nSe retirará el registro local y su aviso. No se conserva historial de cancelaciones.") {
            mutate("Retirando recordatorio local…", { ReminderReceiver.cancel(app, record.id, record.revision) },
                "El registro y su aviso ya no están activos en este celular. No se conserva historial local.")
        }
    }

    private fun confirm(title: String, message: String, accepted: () -> Unit) {
        val activity = activeHost() ?: return
        track(AlertDialog.Builder(activity).setTitle(title).setMessage(message)
            .setNegativeButton("Volver", null).setPositiveButton("Confirmar") { _, _ ->
                if (!busy && activeHost() != null) accepted()
            }.create()).show()
    }

    private fun <T> mutate(message: String, task: () -> T, success: String) {
        work(message, task) { result ->
            val failure = result.exceptionOrNull()
            refresh(if (failure == null) success else safeError(failure))
            if (failure?.message in setOf("mobile_reminder_notification_permission_required", "mobile_reminder_notifications_disabled")) notificationSettings()
        }
    }

    private fun notificationsAllowed(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        val manager = app.getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() && manager.getNotificationChannel("gunter_reminders")?.importance != NotificationManager.IMPORTANCE_NONE
    }

    private fun notificationSettings() {
        val activity = activeHost() ?: return
        track(AlertDialog.Builder(activity).setTitle("Permitir avisos locales")
            .setMessage("Android tiene desactivados los avisos de Gunter. Permítelos en Ajustes y vuelve a abrir Recordatorios. Este cambio no se ha aplicado.")
            .setNegativeButton("Volver", null).setPositiveButton("Abrir ajustes") { _, _ ->
                if (activeHost() != null) runCatching {
                    activity.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName))
                }.onFailure { status?.text = "No pude abrir Ajustes. Busca Gunter en los ajustes de notificaciones de Android." }
            }.create()).show()
    }

    private fun safeError(error: Throwable): String = when (error.message) {
        "mobile_reminder_revision_conflict", "mobile_reminder_mutation_conflict" -> "El recordatorio cambió desde que lo abriste. Consulta y edita su revisión actual."
        "mobile_reminder_not_found" -> "El registro ya no está aquí. Puede haberse entregado o cancelado; no se conserva historial local."
        "mobile_reminder_notification_permission_required", "mobile_reminder_notifications_disabled" -> "No se completó este intento: permite los avisos de Gunter en Ajustes."
        "mobile_reminder_limit" -> "Hay ${ReminderCoordinator.MAX_REMINDERS} recordatorios locales pendientes. Cancela uno antes de crear otro."
        "mobile_reminder_date_invalid" -> "La hora elegida ya pasó o no es válida. Elige otra fecha futura."
        "mobile_reminder_title_invalid", "mobile_reminder_title_required" -> "El título debe tener entre 1 y 180 caracteres."
        "mobile_reminder_id_conflict" -> "Este intento ya tiene un registro distinto. Actualiza y edítalo; no se creará otra copia automáticamente."
        else -> "No pude comprobar toda la operación. Consulta la lista antes de repetir: podría haber cambios guardados."
    }

    private fun readable(at: Instant): String {
        val zoned = at.atZone(ZoneId.systemDefault())
        val value = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.getDefault()).format(zoned)
        return "$value · ${zoned.zone.id} (UTC${zoned.offset.id})"
    }

    private inner class ReminderRows : BaseAdapter() {
        override fun getCount() = records.size
        override fun getItem(position: Int) = records[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val activity = activeHost() ?: return View(app)
            val record = getItem(position)
            return column(activity).apply {
                setPadding(dp(16), dp(10), dp(16), dp(10))
                addView(label(activity, record.title, 18f))
                addView(label(activity, readable(Instant.ofEpochMilli(record.whenMillis)), 14f))
                addView(label(activity, "${if (record.status(System.currentTimeMillis()) == "overdue") "Fecha pasada; entrega no confirmada" else "Pendiente"} · revisión ${record.revision}", 12f))
                addView(LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    addView(button(activity, "Editar") { editor(record) }.apply {
                        isEnabled = !busy; contentDescription = "Editar recordatorio: ${record.title}"
                    })
                    addView(button(activity, "Cancelar") { cancel(record) }.apply {
                        isEnabled = !busy; contentDescription = "Cancelar recordatorio: ${record.title}"
                    })
                })
            }
        }
    }
}
