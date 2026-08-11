plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "dev.glassbox"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation("com.google.code.gson:gson:2.13.2")
    testImplementation(platform("org.junit:junit-bom:5.13.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")

    intellijPlatform {
        intellijIdeaCommunity("2024.3.6")
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

intellijPlatform {
    pluginConfiguration {
        name = "GlassBox Lite"
        version = project.version.toString()
        description = """
            Audits explicitly selected editor text using the free deterministic GlassBox Lite service.
            The plugin requires a one-audit confirmation, contains no API key or telemetry, and displays
            the privacy-minimized result without repeating the selected text. GlassBox Lite is not a web
            fact-check, source authenticator, truth guarantee, or professional advice.
        """.trimIndent()
        changeNotes = "Initial explicit-selection audit action with privacy-minimized MCP results."
        vendor {
            name = "Karthik Barma"
            email = "thebarmaeffect@gmail.com"
            url = "https://glassbox-platform-gateway.onrender.com/"
        }
        ideaVersion {
            sinceBuild = "243"
            untilBuild = "243.*"
        }
    }
}

tasks {
    withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
    }
    jar {
        from("LICENSE.txt") {
            into("META-INF")
        }
    }
    test {
        useJUnitPlatform()
    }
}
