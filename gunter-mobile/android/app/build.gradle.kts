import java.net.URI
import java.io.File
import java.util.Locale

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun externalSetting(property: String, environment: String): String =
    providers.gradleProperty(property).orElse(providers.environmentVariable(environment)).orNull.orEmpty()

// A build pins one trusted web origin. Never embed credentials, links with paths,
// or an insecure development URL into a distributable APK.
fun trustedWebOrigin(value: String): String {
    if (value.isBlank()) return ""
    require(value.length <= 8192 && value.none { it.code <= 32 || it.code == 127 || it == '\\' }) {
        "GUNTER_WEB_ORIGIN must not contain whitespace, controls or backslashes."
    }
    val origin = runCatching { URI(value) }.getOrNull()
    require(origin != null && origin.scheme.equals("https", ignoreCase = true) &&
        !origin.isOpaque && !origin.host.isNullOrBlank() && origin.rawUserInfo == null &&
        (origin.rawPath.isNullOrEmpty() || origin.rawPath == "/") &&
        origin.rawQuery == null && origin.rawFragment == null &&
        (origin.port == -1 || origin.port in 1..65535)) {
        "GUNTER_WEB_ORIGIN must be a HTTPS origin without credentials, path, query or fragment."
    }
    val host = origin.host
    val authority = host + if (origin.port == -1) "" else ":${origin.port}"
    require(!host.endsWith('.') && '%' !in host && host.none { it.code > 127 } &&
        origin.rawAuthority.equals(authority, ignoreCase = true)) {
        "GUNTER_WEB_ORIGIN must have an unambiguous ASCII host and port."
    }
    val port = if (origin.port == -1) 443 else origin.port
    return "https://${host.lowercase(Locale.ROOT)}${if (port == 443) "" else ":$port"}"
}

val gunterWebOrigin = trustedWebOrigin(externalSetting("gunterWebOrigin", "GUNTER_WEB_ORIGIN"))
val requirePushSetting = externalSetting("gunterRequirePush", "GUNTER_REQUIRE_PUSH").trim()
require(requirePushSetting.isEmpty() || requirePushSetting in listOf("true", "false")) {
    "GUNTER_REQUIRE_PUSH must be true or false."
}
val requirePush = requirePushSetting == "true"
val debugFirebaseConfigured = file("src/debug/google-services.json").isFile
val releaseFirebaseConfigured = file("src/release/google-services.json").isFile || file("google-services.json").isFile
if (debugFirebaseConfigured || releaseFirebaseConfigured) apply(plugin = "com.google.gms.google-services")

// Signing material is supplied externally by the release owner. This project
// never generates a distribution key or falls back to the debug key for release.
val releaseStorePath = externalSetting("gunterReleaseStoreFile", "GUNTER_RELEASE_STORE_FILE")
val releaseStorePassword = externalSetting("gunterReleaseStorePassword", "GUNTER_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = externalSetting("gunterReleaseKeyAlias", "GUNTER_RELEASE_KEY_ALIAS")
val releaseKeyPassword = externalSetting("gunterReleaseKeyPassword", "GUNTER_RELEASE_KEY_PASSWORD")
val hasReleaseSigning = listOf(releaseStorePath, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { it.isNotEmpty() }

android {
    namespace = "com.gunter.mobile"
    compileSdk = 35
    buildFeatures { buildConfig = true }
    defaultConfig {
        applicationId = "com.gunter.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
        resValue("string", "gunter_app_name", "Gunter")
        buildConfigField("String", "GUNTER_WEB_ORIGIN", "\"$gunterWebOrigin\"")
        buildConfigField("boolean", "GUNTER_PUSH_REQUIRED", requirePush.toString())
    }
    signingConfigs {
        if (hasReleaseSigning) create("distribution") {
            storeFile = file(releaseStorePath)
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }
    buildTypes {
        getByName("debug") {
            // Install the candidate beside the existing companion, never over it.
            applicationIdSuffix = ".preview"
            versionNameSuffix = "-preview"
            resValue("string", "gunter_app_name", "Gunter · Pruebas")
            buildConfigField("boolean", "GUNTER_FCM_CONFIGURED", debugFirebaseConfigured.toString())
        }
        getByName("release") {
            isDebuggable = false
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("distribution")
            buildConfigField("boolean", "GUNTER_FCM_CONFIGURED", releaseFirebaseConfigured.toString())
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// A production Firebase file may describe com.gunter.mobile only. Do not apply
// it to the isolated com.gunter.mobile.preview package or pretend push works.
tasks.matching { it.name == "processDebugGoogleServices" }.configureEach {
    enabled = debugFirebaseConfigured
}

val validateGunterRelease by tasks.registering {
    group = "verification"
    description = "Fail closed unless a trusted origin and external distribution signing are configured."
    doLast {
        require(gunterWebOrigin.isNotEmpty()) { "Release requires GUNTER_WEB_ORIGIN (HTTPS origin)." }
        require(hasReleaseSigning) { "Release requires the four external GUNTER_RELEASE_* signing settings; debug signing is never used." }
        val keyFile = file(releaseStorePath)
        require(File(releaseStorePath).isAbsolute && keyFile.isFile) {
            "Release signing requires an existing absolute keystore path supplied by the release owner."
        }
        val repository = rootProject.projectDir.resolve("../..").canonicalFile.toPath()
        require(!keyFile.canonicalFile.toPath().startsWith(repository)) {
            "Keep the distribution keystore outside the source repository."
        }
        require(!requirePush || releaseFirebaseConfigured) {
            "Push is required for this release but its Firebase Android configuration is missing."
        }
        // This verifies only build inputs, not deployment, key ownership, FCM
        // server delivery, or the physical-device acceptance checklist.
        logger.lifecycle("Gunter release build inputs validated; device QA and delivery validation are still required.")
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(validateGunterRelease) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")
    testImplementation("junit:junit:4.13.2")
}
