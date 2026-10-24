package com.gunter.mobile

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.net.Uri
import android.os.SystemClock
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject

data class MobileExecution(val result: JSONObject, val evidence: JSONObject)

class MobileExecutors(private val context: Context, private val config: NodeConfig) {
    fun execute(skill: String, payload: JSONObject, commandId: String): MobileExecution = when (skill) {
        "mobile.open_app" -> openApp(payload)
        "mobile.files.list" -> listFiles(payload)
        "mobile.files.search" -> searchFiles(payload)
        "mobile.files.open" -> openFile(payload)
        "mobile.media.next", "mobile.media.play_pause" -> media(skill)
        "mobile.message.prepare" -> prepareMessage(payload)
        "mobile.reminder" -> scheduleReminder(payload, commandId)
        "mobile.message.send" -> throw IllegalStateException("mobile_direct_send_requires_default_sms_app")
        else -> throw IllegalStateException("mobile_skill_not_supported")
    }

    private fun openApp(payload: JSONObject): MobileExecution {
        val deepLink = payload.optString("deepLink", "").trim()
        val appId = payload.optString("appId", payload.optString("app", "")).trim()
        val packages = mapOf("spotify" to "com.spotify.music", "whatsapp" to "com.whatsapp", "telegram" to "org.telegram.messenger", "chrome" to "com.android.chrome", "youtube" to "com.google.android.youtube", "maps" to "com.google.android.apps.maps")
        val intent = when {
            deepLink.isNotEmpty() && Uri.parse(deepLink).scheme?.lowercase() in setOf("https", "mailto", "tel", "sms", "geo", "spotify") -> Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
            appId.isNotEmpty() -> context.packageManager.getLaunchIntentForPackage(packages[appId.lowercase()] ?: appId) ?: throw IllegalStateException("mobile_app_not_found")
            else -> throw IllegalStateException("mobile_app_required")
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        // Android can suppress background launches without throwing. Dispatch is not proof
        // of a visible app, especially when this executor runs in GunterNodeService.
        return MobileExecution(JSONObject().put("requested", appId.ifEmpty { deepLink }), intentEvidence())
    }

    private fun listFiles(payload: JSONObject): MobileExecution {
        val folder = authorizedFolder(payload.optString("folderToken"))
        val limit = payload.optInt("limit", 100).coerceIn(1, 250)
        val files = JSONArray(folder.listFiles().take(limit).map { JSONObject().put("token", it.uri.toString()).put("name", it.name).put("directory", it.isDirectory).put("size", it.length()) })
        return MobileExecution(JSONObject().put("items", files), JSONObject().put("folderRead", true).put("itemCount", files.length()))
    }

    private fun searchFiles(payload: JSONObject): MobileExecution {
        val root = authorizedFolder(payload.optString("folderToken"))
        val query = payload.optString("query").trim().lowercase(); if (query.isEmpty()) throw IllegalStateException("mobile_search_query_required")
        val limit = payload.optInt("limit", 50).coerceIn(1, 100); val matches = JSONArray(); val queue = ArrayDeque<DocumentFile>(); queue.add(root); var inspected = 0
        while (queue.isNotEmpty() && matches.length() < limit && inspected < 3000) for (file in queue.removeFirst().listFiles()) {
            inspected += 1
            if (file.isDirectory) queue.add(file) else if ((file.name ?: "").lowercase().contains(query)) matches.put(JSONObject().put("token", file.uri.toString()).put("name", file.name).put("size", file.length()))
            if (matches.length() >= limit || inspected >= 3000) break
        }
        return MobileExecution(JSONObject().put("items", matches), JSONObject().put("searchCompleted", true).put("itemCount", matches.length()).put("inspected", inspected))
    }

    private fun openFile(payload: JSONObject): MobileExecution {
        val uri = if (payload.has("fileToken")) Uri.parse(payload.getString("fileToken")) else {
            val fileName = payload.optString("fileName").trim()
            if (fileName.isEmpty()) throw IllegalStateException("mobile_file_required")
            val root = authorizedFolder(payload.optString("folderToken")); findFile(root, fileName)?.uri ?: throw IllegalStateException("mobile_file_not_found")
        }
        if (uri.scheme != "content" || !belongsToAuthorizedFolder(uri)) throw IllegalStateException("mobile_file_token_invalid")
        val intent = Intent(Intent.ACTION_VIEW).setData(uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(intent, "Abrir con").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return MobileExecution(JSONObject().put("fileToken", uri.toString()), intentEvidence())
    }

    private fun findFile(root: DocumentFile, name: String): DocumentFile? {
        val queue = ArrayDeque<DocumentFile>(); queue.add(root); var inspected = 0
        while (queue.isNotEmpty() && inspected < 3000) for (file in queue.removeFirst().listFiles()) {
            inspected += 1
            if (file.isDirectory) queue.add(file) else if ((file.name ?: "").equals(name, ignoreCase = true)) return file
            if (inspected >= 3000) break
        }
        return null
    }

    private fun media(skill: String): MobileExecution {
        val manager = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
        val listener = ComponentName(context, GunterNotificationListener::class.java)
        val controller = manager.getActiveSessions(listener).firstOrNull() ?: throw IllegalStateException("mobile_media_permission_required")
        val before = mediaSnapshot(controller)
        val requestedState = if (before.state == 3) 2 else 3 // PlaybackState.PLAYING / PAUSED
        if (skill == "mobile.media.next") controller.transportControls.skipToNext()
        else if (requestedState == 2) controller.transportControls.pause() else controller.transportControls.play()

        // TransportControls do not return a completion result. Observe a bounded, real
        // postcondition; a pre-existing playback state cannot verify a sent command.
        val deadline = SystemClock.elapsedRealtime() + 1500
        var verified = mediaEffectObserved(skill, before, mediaSnapshot(controller), requestedState)
        while (!verified && SystemClock.elapsedRealtime() < deadline) {
            Thread.sleep(minOf(50, deadline - SystemClock.elapsedRealtime()).coerceAtLeast(1))
            verified = mediaEffectObserved(skill, before, mediaSnapshot(controller), requestedState)
        }
        val evidence = JSONObject().put("mediaCommandDispatched", true).put("effectVerified", verified)
        if (verified) {
            if (skill == "mobile.media.next") evidence.put("playbackStateChanged", true).put("trackChanged", true)
            else evidence.put("playbackStateObserved", true).put("requestedStateObserved", true)
        }
        return MobileExecution(JSONObject().put("package", controller.packageName).put("effectVerified", verified), evidence)
    }

    private fun mediaSnapshot(controller: MediaController): MobileMediaSnapshot {
        val metadata = controller.metadata
        fun value(key: String) = metadata?.getString(key)?.trim()?.takeIf { it.isNotEmpty() }
        return MobileMediaSnapshot(
            controller.playbackState?.state,
            value(MediaMetadata.METADATA_KEY_MEDIA_ID),
            value(MediaMetadata.METADATA_KEY_TITLE) ?: value(MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
            value(MediaMetadata.METADATA_KEY_ARTIST)
        )
    }

    private fun prepareMessage(payload: JSONObject): MobileExecution {
        val channel = requireSmsChannel(payload.optString("channel", "sms"))
        val recipient = payload.optString("recipient").trim(); val text = payload.optString("text").trim(); if (recipient.isEmpty() || text.isEmpty()) throw IllegalStateException("mobile_message_required")
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(recipient)}")).putExtra("sms_body", text).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        // No SMS is sent here, and an external messaging app supplies no saved-draft ID.
        return MobileExecution(JSONObject().put("channel", channel).put("userSendRequired", true), intentEvidence().put("userSendRequired", true))
    }

    private fun scheduleReminder(payload: JSONObject, commandId: String): MobileExecution {
        val title = payload.optString("title").trim(); if (title.isEmpty()) throw IllegalStateException("mobile_reminder_title_required")
        val id = commandId.ifBlank { throw IllegalStateException("mobile_command_id_required") }
        val record = ReminderReceiver.schedule(context, id, title, payload.optString("runAt"))
        return MobileExecution(
            JSONObject().put("id", id).put("runAt", record.runAt).put("delivery", "inexact"),
            JSONObject().put("persistedId", id).put("persisted", true).put("reconsulted", true)
                .put("alarmScheduled", true).put("exact", false).put("deliveryGuaranteed", false)
        )
    }

    private fun intentEvidence() = JSONObject().put("intentDispatched", true).put("effectVerified", false)

    private fun authorizedFolder(token: String): DocumentFile {
        val selected = if (token.isBlank() && config.folders.size == 1) config.folders.first() else token
        if (selected !in config.folders) throw IllegalStateException(if (config.folders.isEmpty()) "mobile_files_read_permission_required" else "mobile_folder_not_authorized")
        return DocumentFile.fromTreeUri(context, Uri.parse(selected)) ?: throw IllegalStateException("mobile_folder_not_available")
    }

    private fun belongsToAuthorizedFolder(file: Uri): Boolean = config.folders.any { raw ->
        val folder = Uri.parse(raw)
        runCatching {
            folder.authority == file.authority && DocumentsContract.getDocumentId(file).let { documentId ->
                val treeId = DocumentsContract.getTreeDocumentId(folder)
                documentId == treeId || documentId.startsWith("$treeId/")
            }
        }.getOrDefault(false)
    }
}
