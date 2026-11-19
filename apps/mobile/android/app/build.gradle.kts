plugins {
    alias(libs.plugins.android.application)
}

// The version lives in apps/mobile/version.xcconfig, shared with the iOS app ("KEY = value" lines, // comments).
val appVersion: Map<String, String> =
    rootProject.file("../version.xcconfig").readLines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("//") && "=" in it }
        .associate { it.substringBefore("=").trim() to it.substringAfter("=").trim() }

/** A Gradle property (-Psekai.x or ~/.gradle/gradle.properties) or else an environment variable. */
fun setting(property: String, env: String): String? =
    providers.gradleProperty(property).orElse(providers.environmentVariable(env)).orNull?.takeIf { it.isNotBlank() }

val releaseKeystore = setting("sekai.keystore", "SEKAI_KEYSTORE")

android {
    namespace = "io.github.hazelcaffe.sekai"
    compileSdk = 36

    defaultConfig {
        // The app id: change it here for your own build (your own Firebase project needs a matching Android app).
        applicationId = "io.github.hazelcaffe.sekai"
        minSdk = 28
        targetSdk = 36
        versionName = appVersion.getValue("MARKETING_VERSION")
        versionCode = appVersion.getValue("CURRENT_PROJECT_VERSION").toInt()
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = setting("sekai.keystorePassword", "SEKAI_KEYSTORE_PASSWORD")
                keyAlias = setting("sekai.keyAlias", "SEKAI_KEY_ALIAS")
                // PKCS12 keystores (keytool's default) use the store's password for the key too.
                keyPassword = setting("sekai.keyPassword", "SEKAI_KEY_PASSWORD") ?: storePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Without a keystore, release builds are signed with the debug key (fine for trying them out).
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

/** Copies the files shared with the iOS app (the bridge, the connect screen, the logo) into the app's assets. */
abstract class CopySharedAssets : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun copy() {
        fs.sync {
            from(sources)
            into(outputDir)
        }
    }
}

val copySharedAssets = tasks.register<CopySharedAssets>("copySharedAssets") {
    sources.from(rootProject.files("../shared/bridge.js", "../shared/connect.html", "../shared/icon.png"))
    outputDir = layout.buildDirectory.dir("generated/sekai/assets")
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copySharedAssets, CopySharedAssets::outputDir)
    }
}

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.splashscreen)
    implementation(libs.firebase.messaging)
    testImplementation(libs.junit)
}
