package com.gunter.mobile

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class NodeApi(base: String) {
    private val origin = WebOriginPolicy.fromConfiguredOrigin(base)?.origin
        ?: throw IllegalArgumentException("gunter_mobile_https_origin_required")
    init {
        if (!BuildConfig.DEBUG) require(origin == WebOriginPolicy.fromConfiguredOrigin(BuildConfig.GUNTER_WEB_ORIGIN)?.origin) {
            "gunter_mobile_repair_required"
        }
    }
    fun claim(pairingToken: String, name: String): NodeConfig {
        val data = request("/nodes/claim", pairingToken, "POST", JSONObject().put("nodeType", "ANDROID").put("deviceName", name).put("os", "Android").put("appVersion", BuildConfig.VERSION_NAME).put("protocolVersion", "1.0.0"))
        return NodeConfig(origin, data.getJSONObject("node").getString("nodeId"), data.getString("nodeToken"), data.getJSONObject("node").getString("deviceName"))
    }
    fun heartbeat(config: NodeConfig, state: String, health: JSONObject) = request("/nodes/heartbeat", config.nodeToken, "POST", JSONObject().put("nodeId", config.nodeId).put("state", state).put("protocolVersion", "1.0.0").put("clientTime", System.currentTimeMillis()).put("capabilities", capabilities()).put("health", health).put("syncCursor", "clean"))
    fun registerPushToken(config: NodeConfig, token: String) = request("/nodes/push-token", config.nodeToken, "POST", JSONObject().put("provider", "fcm").put("token", token))
    fun clearPushToken(config: NodeConfig) = request("/nodes/push-token", config.nodeToken, "DELETE")
    fun pull(config: NodeConfig): JSONObject = request("/commands/pull?limit=10", config.nodeToken, "GET")
    fun result(config: NodeConfig, commandId: String, result: JSONObject, evidence: JSONObject) = request("/commands/result", config.nodeToken, "POST", JSONObject().put("commandId", commandId).put("result", result).put("evidence", evidence))
    private fun capabilities() = listOf("mobile.apps.open", "mobile.files.read", "mobile.media.control", "mobile.messaging.prepare", "mobile.reminders.read", "mobile.reminders.write")
    private fun request(route: String, token: String, method: String, body: JSONObject? = null): JSONObject {
        val connection = (URL(origin + "/api/control" + route).openConnection() as HttpURLConnection)
        try {
            connection.apply {
                requestMethod = method; instanceFollowRedirects = false; connectTimeout = 12000; readTimeout = 12000
                setRequestProperty("Accept", "application/json"); setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    doOutput = true; setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
            }
            val status = connection.responseCode
            // Never forward a node/pairing credential through a redirect.
            if (status in 300..399) throw IllegalStateException("gunter_mobile_redirect_blocked")
            val input = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = input?.bufferedReader(Charsets.UTF_8)?.use { reader ->
                val value = StringBuilder(); val chunk = CharArray(4096)
                while (true) {
                    val count = reader.read(chunk); if (count < 0) break
                    if (value.length + count > 2 * 1024 * 1024) throw IllegalStateException("gunter_mobile_response_too_large")
                    value.append(chunk, 0, count)
                }
                value.toString()
            } ?: "{}"
            val json = JSONObject(raw)
            if (status !in 200..299 || json.optBoolean("success", true).not()) throw IllegalStateException("gunter_mobile_http_$status")
            return json.optJSONObject("data") ?: JSONObject()
        } finally { connection.disconnect() }
    }
}
