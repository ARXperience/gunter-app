package com.gunter.mobile

import org.junit.Assert.*
import org.junit.Test

class WebOriginPolicyTest {
    private val policy = WebOriginPolicy.fromConfiguredOrigin("https://gunter.example")!!

    @Test fun canonicalOriginAndDefaultPort() {
        assertEquals("https://gunter.example", WebOriginPolicy.fromConfiguredOrigin("HTTPS://GUNTER.EXAMPLE:443/")!!.origin)
        assertEquals("https://gunter.example/", policy.rootUrl)
        assertTrue(policy.isInternal("https://GUNTER.example:443/tasks?q=today#new"))
        assertFalse(policy.isInternal("https://gunter.example:444/"))
        assertTrue(WebOriginPolicy.fromConfiguredOrigin("https://gunter.example:8443")!!.isInternal("https://gunter.example:8443/agenda"))
    }

    @Test fun originConfigurationHasNoPathsOrCredentials() {
        listOf("", "https://gunter.example/path", "https://gunter.example/?token=x", "https://gunter.example/#x", "https://user:pass@gunter.example", "https://gunter.example:0", "https://gunter.example:65536", "https://gunter.example.", "https://gunter.example:", "https://günter.example").forEach {
            assertNull(it, WebOriginPolicy.fromConfiguredOrigin(it))
        }
    }

    @Test fun hostileSchemesAndAuthoritiesAreNotInternal() {
        listOf("http://gunter.example", "file:///gunter.example", "content://gunter.example", "javascript://gunter.example", "intent://gunter.example", "data:text/html,x", "blob:https://gunter.example/id", "//gunter.example", "https://gunter.example.evil.test", "https://evil.test/gunter.example", "https://gunter.example@evil.test", "https://evil.test@gunter.example", "https://gunter.example\\@evil.test", " https://gunter.example", "https://gunter.example\n", "https://%67unter.example", "https://gunter.example:bad/").forEach {
            assertFalse(it, policy.isInternal(it))
        }
    }

    @Test fun externalIntentAllowlistIsNarrow() {
        listOf("https://external.example/page", "mailto:person@example.com", "tel:+573001234567", "sms:+573001234567", "geo:4.7,-74.0").forEach { assertNotNull(it, WebOriginPolicy.externalScheme(it)) }
        listOf("http://external.example", "intent://x", "javascript:alert(1)", "file:///tmp/x", "content://x", "data:text/plain,x", "blob:https://gunter.example/id", "tel:", "mailto:a@example.com%0d%0aBcc:b@example.com").forEach { assertNull(it, WebOriginPolicy.externalScheme(it)) }
    }

    @Test fun ipv6AndNullInputsAreHandledWithoutTrustExpansion() {
        val ipv6 = WebOriginPolicy.fromConfiguredOrigin("https://[::1]:8443")!!
        assertTrue(ipv6.isInternal("https://[::1]:8443/tasks"))
        assertFalse(ipv6.isInternal("https://[::1]/"))
        assertNull(WebOriginPolicy.fromConfiguredOrigin(null))
        assertFalse(policy.isInternal(null))
        assertNull(WebOriginPolicy.externalScheme(null))
    }

    @Test fun loopbackHttpRequiresExplicitOptInAndPreservesExactOrigin() {
        val localUrl = "http://127.0.0.1:3002"
        assertNull(WebOriginPolicy.fromConfiguredOrigin(localUrl))
        assertFalse(WebOriginPolicy.isHttps(localUrl))
        assertNull(WebOriginPolicy.externalScheme(localUrl))
        val local = WebOriginPolicy.fromConfiguredOrigin("HTTP://127.0.0.1:3002/", allowLoopbackHttp = true)!!
        assertEquals(localUrl, local.origin)
        assertEquals("$localUrl/", local.rootUrl)
        assertTrue(local.isLoopbackHttp)
        assertTrue(local.isInternal("$localUrl/tasks?day=today#new"))
        listOf("http://127.0.0.1:3003/tasks", "http://127.0.0.1:3013/", "https://127.0.0.1:3002/", "http://localhost:3002/", "http://127.0.0.2:3002/", "http://192.168.1.20:3002/").forEach {
            assertFalse(it, local.isInternal(it))
        }
        assertFalse(policy.isLoopbackHttp)
        assertFalse(policy.isInternal(localUrl))
    }

    @Test fun loopbackOptInDoesNotPermitLanInternetOrAmbiguousAuthorities() {
        listOf("http://localhost:3002", "http://[::1]:3002", "http://127.1:3002", "http://2130706433:3002", "http://0x7f000001:3002", "http://127.000.000.001:3002", "http://127.0.0.1.:3002", "http://%31%32%37.0.0.1:3002", "http://127.0.0.1:03002", "http://user@127.0.0.1:3002", "http://127.0.0.1:3002@evil.example", "http://127.0.0.1:3002.evil.example", "http://127.0.0.2:3002", "http://0.0.0.0:3002", "http://192.168.1.5:3002", "http://10.0.0.1:3002", "http://172.16.0.1:3002", "http://gunter.example:3002", "http://127.0.0.1:3002/path", "http://127.0.0.1:3002/?token=x", "http://127.0.0.1:3002/#x", "http://127.0.0.1:3002\\@evil.example", " http://127.0.0.1:3002").forEach {
            assertNull(it, WebOriginPolicy.fromConfiguredOrigin(it, allowLoopbackHttp = true))
        }
    }

    @Test fun localTestRequiresExplicitUnprivilegedPortAndExcludesLab() {
        listOf("http://127.0.0.1", "http://127.0.0.1:", "http://127.0.0.1:0", "http://127.0.0.1:80", "http://127.0.0.1:443", "http://127.0.0.1:1023", "http://127.0.0.1:3013", "http://127.0.0.1:65536", "http://127.0.0.1:-1", "http://127.0.0.1:bad").forEach {
            assertNull(it, WebOriginPolicy.fromConfiguredOrigin(it, allowLoopbackHttp = true))
        }
        listOf(1024, 3002, 65535).forEach { assertNotNull(WebOriginPolicy.fromConfiguredOrigin("http://127.0.0.1:$it", allowLoopbackHttp = true)) }
        // HTTPS defaults and its full explicit-port range remain independent of the debug exception.
        listOf("https://gunter.example", "https://gunter.example:1", "https://gunter.example:3013", "https://gunter.example:65535").forEach {
            assertNotNull(it, WebOriginPolicy.fromConfiguredOrigin(it))
            assertEquals(WebOriginPolicy.fromConfiguredOrigin(it)!!.origin, WebOriginPolicy.fromConfiguredOrigin(it, allowLoopbackHttp = true)!!.origin)
        }
    }

    @Test fun resourcesPermitOnlySelectedHttpTestOriginAndHttpsCdns() {
        val local = WebOriginPolicy.fromConfiguredOrigin("http://127.0.0.1:3002", allowLoopbackHttp = true)!!
        listOf("http://127.0.0.1:3002/js/main.js", "http://127.0.0.1:3002/api/tasks", "https://cdn.example/assets/app.js", "https://gunter.example/api").forEach {
            assertTrue(it, local.isAllowedResource(it))
        }
        listOf(null, "http://127.0.0.1:3003/api", "http://127.0.0.1:3013/", "http://localhost:3002/", "http://192.168.1.20:3002/", "http://cdn.example/a.js", "file:///tmp/x", "content://x", "javascript:alert(1)").forEach {
            assertFalse(it, local.isAllowedResource(it))
        }
        assertTrue(policy.isAllowedResource("https://cdn.example/assets/app.js"))
        assertFalse(policy.isAllowedResource("http://127.0.0.1:3002/js/main.js"))
    }
}
