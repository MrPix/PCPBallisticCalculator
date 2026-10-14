/**
 * Builds the Android APK from the static export.
 *
 *   node scripts/build-apk.mjs              debug APK, ready to sideload
 *   node scripts/build-apk.mjs --release    signed release APK
 *   node scripts/build-apk.mjs --no-build   skip `next build` (reuse ./out)
 *
 * The Android toolchain is fussy about versions, so this script finds them
 * instead of assuming they are on PATH:
 *   - a JDK 21+ (AGP 8.13 / Capacitor 8 need 21; a bare `java` on PATH is
 *     usually something older and Gradle will not complain clearly)
 *   - the Android SDK, writing android/local.properties if it is missing
 *
 * Everything else is the plain Capacitor + Gradle workflow.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = join(ROOT, "android");
const args = process.argv.slice(2);
const release = args.includes("--release");
const skipNextBuild = args.includes("--no-build");

function run(command, cmdArgs, opts = {}) {
  console.log(`\n$ ${command} ${cmdArgs.join(" ")}`);
  const result = spawnSync(command, cmdArgs, {
    cwd: opts.cwd ?? ROOT,
    stdio: "inherit",
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: false,
  });
  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Returns the major version of a JDK home, or null if it is not a usable JDK. */
function jdkMajor(home) {
  const javaBin = join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(javaBin)) return null;
  const out = spawnSync(javaBin, ["-version"], { encoding: "utf8" });
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  const match = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!match) return null;
  // "1.8.0_501" means Java 8; "21.0.8" means Java 21.
  const major = match[1] === "1" ? Number(match[2]) : Number(match[1]);
  return Number.isFinite(major) ? major : null;
}

function childJdks(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

function findJdk() {
  // AGP 8.13 + Gradle 8.14.3 are happiest on exactly 21, so 21 is preferred and
  // anything newer is only used if nothing else exists.
  const roots = [
    process.env.JDK21_HOME,
    process.env.JAVA_HOME,
    ...(process.platform === "win32"
      ? [
          "C:/Program Files/Android/openjdk",
          "C:/Program Files/Android/Android Studio/jbr",
          "C:/Program Files/Eclipse Adoptium",
          "C:/Program Files/Java",
        ]
      : ["/usr/lib/jvm", "/Library/Java/JavaVirtualMachines", "/opt/homebrew/opt"]),
    join(homedir(), ".gradle", "jdks"),
  ].filter(Boolean);

  const found = [];
  for (const root of roots) {
    for (const home of [root, ...childJdks(root)]) {
      const major = jdkMajor(home);
      if (major !== null && major >= 17) found.push({ home, major });
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => {
    const rank = (x) => (x.major === 21 ? 0 : x.major < 21 ? 1 : 2);
    return rank(a) - rank(b) || a.major - b.major;
  });
  return found[0];
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    ...(process.platform === "win32"
      ? [join(homedir(), "AppData", "Local", "Android", "Sdk")]
      : process.platform === "darwin"
        ? [join(homedir(), "Library", "Android", "sdk")]
        : [join(homedir(), "Android", "Sdk")]),
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(join(dir, "platform-tools"))) ?? null;
}

// Local CLI entry points. Spawning `npx` directly fails on Windows (it is
// npx.cmd) and going through the shell mangles quoting, so invoke the scripts
// with the same Node that is running this file.
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const CAP_BIN = join(ROOT, "node_modules", "@capacitor", "cli", "bin", "capacitor");

// ---- 1. web build --------------------------------------------------------
if (!skipNextBuild) run(process.execPath, [NEXT_BIN, "build"]);

// ---- 2. toolchain discovery ---------------------------------------------
const jdk = findJdk();
if (!jdk) {
  console.error(
    "No JDK 17+ found. AGP 8.13 needs JDK 21. Install one, or set JDK21_HOME to its folder.\n" +
      "Easiest alternative: `npm run android:open` and press Build in Android Studio, " +
      "which ships its own JDK.",
  );
  process.exit(1);
}
console.log(`JDK: ${jdk.home} (Java ${jdk.major})`);

const sdk = findSdk();
const localProps = join(ANDROID, "local.properties");
if (existsSync(localProps)) {
  console.log("android/local.properties: already present");
} else if (sdk) {
  const escaped = sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  writeFileSync(localProps, `sdk.dir=${escaped}\n`);
  console.log(`android/local.properties: wrote sdk.dir=${sdk}`);
} else {
  console.error(
    "No Android SDK found. Install Android Studio, or set ANDROID_HOME. " +
      "Or use `npm run android:open` and build inside the IDE.",
  );
  process.exit(1);
}

const env = { JAVA_HOME: jdk.home, ANDROID_HOME: sdk ?? undefined };

// ---- 3. copy web assets into the native project -------------------------
run(process.execPath, [CAP_BIN, "sync", "android"], { env });

// ---- 4. gradle ------------------------------------------------------------
// gradlew / gradlew.bat are shell scripts, and Node cannot spawn a .bat without
// a shell. The wrapper jar is the thing those scripts ultimately run, so run it
// directly: same build, no shell quoting to get wrong.
const WRAPPER_JAR = join(ANDROID, "gradle", "wrapper", "gradle-wrapper.jar");
const JAVA_BIN = join(jdk.home, "bin", process.platform === "win32" ? "java.exe" : "java");
const gradleTask = (task) => [JAVA_BIN, ["-cp", WRAPPER_JAR, "org.gradle.wrapper.GradleWrapperMain", task]];
if (release) {
  const keystore = join(ANDROID, "release.keystore");
  const props = join(ANDROID, "keystore.properties");
  if (!existsSync(keystore)) {
    if (!existsSync(props)) {
      writeFileSync(
        props,
        [
          "storeFile=release.keystore",
          "storePassword=pcpfield",
          "keyAlias=pcp",
          "keyPassword=pcpfield",
          "",
        ].join("\n"),
      );
    }
    const keytool = join(jdk.home, "bin", process.platform === "win32" ? "keytool.exe" : "keytool");
    console.log("\nGenerating android/release.keystore (10 years, self-signed)...");
    run(keytool, [
      "-genkeypair",
      "-keystore",
      keystore,
      "-alias",
      "pcp",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "3650",
      "-storepass",
      "pcpfield",
      "-keypass",
      "pcpfield",
      "-dname",
      "CN=PCP Ballistic Calculator, O=personal, C=US",
    ]);
  }
  run(...gradleTask("assembleRelease"), { cwd: ANDROID, env });
} else {
  run(...gradleTask("assembleDebug"), { cwd: ANDROID, env });
}

// ---- 5. point at the result ---------------------------------------------
const apkDir = join(ANDROID, "app", "build", "outputs", "apk", release ? "release" : "debug");
const apk = ["app-release.apk", "app-release-unsigned.apk", "app-debug.apk"]
  .map((name) => join(apkDir, name))
  .find((p) => existsSync(p));

const adb = sdk ? join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : null;

console.log("\n" + "=".repeat(60));
if (apk) {
  const sizeMb = (readFileSync(apk).length / 1024 / 1024).toFixed(1);
  console.log(`APK: ${apk}  (${sizeMb} MB)`);
  console.log("\nInstall on the phone (USB debugging on, phone authorised):");
  console.log(`  ${adb ?? "adb"} install -r "${apk}"`);
  console.log("\nOr just copy the file to the tablet and tap it, with");
  console.log("Settings -> Install unknown apps enabled for your file manager.");
} else {
  console.log(`Gradle finished but no APK found under ${apkDir}`);
  process.exit(1);
}
console.log("=".repeat(60));
