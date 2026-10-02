package com.gunter.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class NodeConfig(val serverUrl: String, val nodeId: String, val nodeToken: String, val deviceName: String, val folders: Set<String> = emptySet()) {
    fun json() = JSONObject().put("serverUrl", serverUrl).put("nodeId", nodeId).put("nodeToken", nodeToken).put("deviceName", deviceName).put("folders", JSONArray(folders)).toString()
    companion object {
        fun fromJson(value: String): NodeConfig { val o = JSONObject(value); val folders = o.optJSONArray("folders") ?: JSONArray(); return NodeConfig(o.getString("serverUrl"), o.getString("nodeId"), o.getString("nodeToken"), o.getString("deviceName"), (0 until folders.length()).map { folders.getString(it) }.toSet()) }
    }
}

class SecureNodeStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("gunter_mobile_secure", Context.MODE_PRIVATE)
    fun load(): NodeConfig? = prefs.getString("node", null)?.let { runCatching { NodeConfig.fromJson(decrypt(it)) }.getOrNull() }
    fun save(value: NodeConfig) { prefs.edit().putString("node", encrypt(value.json())).apply() }
    fun clear() { prefs.edit().remove("node").apply() }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("gunter.mobile.config", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("gunter.mobile.config", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun encrypt(value: String): String { val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }; val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key(), GCMParameterSpec(128, iv)) }; return Base64.encodeToString(iv + c.doFinal(value.toByteArray(StandardCharsets.UTF_8)), Base64.NO_WRAP) }
    private fun decrypt(value: String): String { val raw = Base64.decode(value, Base64.NO_WRAP); val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12))) }; return String(c.doFinal(raw.copyOfRange(12, raw.size)), StandardCharsets.UTF_8) }
}
