package com.gunter.mobile

import java.net.URI
import java.util.Locale

/** Exact scheme/host/effective-port checks; no prefix/suffix URL trust decisions. */
class WebOriginPolicy private constructor(val origin: String, private val scheme: String, private val host: String, private val port: Int) {
    val rootUrl: String get() = "$origin/"
    val isLoopbackHttp: Boolean get() = scheme == "http"

    fun isInternal(value: String?): Boolean {
        val uri = networkUri(value, allowLoopbackHttp = isLoopbackHttp) ?: return false
        return uri.scheme.equals(scheme, ignoreCase = true) && uri.host.lowercase(Locale.ROOT) == host && effectivePort(uri) == port
    }

    /** HTTPS CDNs remain allowed; cleartext is only the selected test origin. */
    fun isAllowedResource(value: String?): Boolean = isHttps(value) || (isLoopbackHttp && isInternal(value))

    companion object {
        /** A build/config value is an origin, never a path, query, credential or fragment. */
        fun fromConfiguredOrigin(value: String?, allowLoopbackHttp: Boolean = false): WebOriginPolicy? {
            val uri = networkUri(value, allowLoopbackHttp) ?: return null
            if (uri.rawPath !in listOf("", "/") || uri.rawQuery != null || uri.rawFragment != null) return null
            if (uri.scheme.equals("http", ignoreCase = true) && uri.port == -1) return null
            val scheme = uri.scheme.lowercase(Locale.ROOT)
            val host = uri.host.lowercase(Locale.ROOT)
            val port = effectivePort(uri)
            val defaultPort = if (scheme == "https") 443 else 80
            return WebOriginPolicy("$scheme://$host${if (port == defaultPort) "" else ":$port"}", scheme, host, port)
        }

        fun isHttps(value: String?): Boolean = httpsUri(value) != null

        /** These destinations still need a user gesture and a native confirmation. */
        fun externalScheme(value: String?): String? {
            val uri = safeUri(value) ?: return null
            val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
            if (scheme == "https") return if (httpsUri(value) != null) scheme else null
            if (scheme !in setOf("mailto", "tel", "sms", "geo") || uri.rawSchemeSpecificPart.isNullOrBlank()) return null
            // Block encoded line breaks as well as raw control characters in external intents.
            if (Regex("%0[ad]", RegexOption.IGNORE_CASE).containsMatchIn(value.orEmpty())) return null
            return scheme
        }

        private fun httpsUri(value: String?): URI? {
            return networkUri(value, allowLoopbackHttp = false)
        }

        private fun networkUri(value: String?, allowLoopbackHttp: Boolean): URI? {
            val uri = safeUri(value) ?: return null
            val https = uri.scheme.equals("https", ignoreCase = true)
            // Port 3013 belongs to the quarantined visual lab, not the app backend.
            val loopback = allowLoopbackHttp && uri.scheme.equals("http", ignoreCase = true) && uri.host == "127.0.0.1"
                && uri.port in 1024..65535 && uri.port != 3013
            if ((!https && !loopback) || uri.isOpaque || uri.rawUserInfo != null) return null
            val host = uri.host ?: return null
            if (host.isBlank() || host.endsWith('.') || '%' in host || uri.port !in -1..65535 || uri.port == 0) return null
            // URI rejects ambiguous/unicode authorities; require an ASCII DNS name or bracketed IPv6.
            if (host.any { it.code > 127 } || uri.rawAuthority?.contains('@') == true) return null
            val authority = host + if (uri.port == -1) "" else ":${uri.port}"
            if (!uri.rawAuthority.equals(authority, ignoreCase = true)) return null
            return uri
        }

        private fun effectivePort(uri: URI): Int = if (uri.port == -1) { if (uri.scheme.equals("http", ignoreCase = true)) 80 else 443 } else uri.port

        private fun safeUri(value: String?): URI? {
            if (value.isNullOrEmpty() || value.length > 8192 || value.any { it.code <= 32 || it.code == 127 || it == '\\' }) return null
            return try { URI(value) } catch (_: Exception) { null }
        }
    }
}
