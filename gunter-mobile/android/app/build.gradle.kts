plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

if (file("google-services.json").isFile) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.gunter.mobile"
    compileSdk = 35
    defaultConfig { applicationId = "com.gunter.mobile"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")
}
