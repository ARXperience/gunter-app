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
}
