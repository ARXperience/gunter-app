package com.gunter.mobile

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class NodeApi(private val base: String) {
    init { require(URL(base).protocol == "https") { "gunter_mobile_https_required" } }
    fun claim(pairingToken: String, name: String): NodeConfig {
        val data = request("/nodes/claim", pairingToken, "POST", JSONObject().put("nodeType", "ANDROID").put("deviceName", name).put("os", "Android").put("appVersion", "0.1.0").put("protocolVersion", "1.0.0"))
        return NodeConfig(base, data.getJSONObject("node").getString("nodeId"), data.getString("nodeToken"), data.getJSONObject("node").getString("deviceName"))
    }
    fun heartbeat(config: NodeConfig, state: String, health: JSONObject) = request("/nodes/heartbeat", config.nodeToken, "POST", JSONObject().put("nodeId", config.nodeId).put("state", state).put("protocolVersion", "1.0.0").put("clientTime", System.currentTimeMillis()).put("capabilities", capabilities()).put("health", health).put("syncCursor", "clean"))
    fun registerPushToken(config: NodeConfig, token: String) = request("/nodes/push-token", config.nodeToken, "POST", JSONObject().put("provider", "fcm").put("token", token))
    fun clearPushToken(config: NodeConfig) = request("/nodes/push-token", config.nodeToken, "DELETE")
    fun pull(config: NodeConfig): JSONObject = request("/commands/pull?limit=10", config.nodeToken, "GET")
    fun result(config: NodeConfig, commandId: String, result: JSONObject, evidence: JSONObject) = request("/commands/result", config.nodeToken, "POST", JSONObject().put("commandId", commandId).put("result", result).put("evidence", evidence))
    private fun capabilities() = listOf("mobile.apps.open", "mobile.files.read", "mobile.media.control", "mobile.messaging.prepare", "mobile.reminders.write")
    private fun request(route: String, token: String, method: String, body: JSONObject? = null): JSONObject {
        val connection = (URL(base.trimEnd('/') + "/api/control" + route).openConnection() as HttpURLConnection).apply { requestMethod = method; connectTimeout = 12000; readTimeout = 12000; setRequestProperty("Accept", "application/json"); setRequestProperty("Authorization", "Bearer $token"); if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json"); outputStream.use { it.write(body.toString().toByteArray()) } } }
        val raw = try { connection.inputStream.bufferedReader().readText() } catch (_: Exception) { connection.errorStream?.bufferedReader()?.readText() ?: "{}" }
        val json = JSONObject(raw)
        if (connection.responseCode !in 200..299 || json.optBoolean("success", true).not()) throw IllegalStateException(json.optString("error", "http_${connection.responseCode}"))
        return json.optJSONObject("data") ?: JSONObject()
    }
}
