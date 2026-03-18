/**
 * Post-install script: copies onnxruntime_providers_shared.dll from the
 * foundry-local-core native package into the onnxruntime-node bin directory
 * so the GenAI runtime can find it at model-load time.
 *
 * This resolves a DLL-resolution issue on Windows where onnxruntime-genai
 * looks for providers_shared.dll adjacent to the onnxruntime.dll that
 * onnxruntime-node already loaded into the process.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const platform = process.platform;
const arch = process.arch;

if (platform !== "win32") {
  process.exit(0);
}

const coreDir = path.join(root, "node_modules", "@foundry-local-core", `${platform}-${arch}`);
const src = path.join(coreDir, "onnxruntime_providers_shared.dll");

if (!fs.existsSync(src)) {
  console.log("[postinstall] foundry-local-core providers_shared.dll not found, skipping.");
  process.exit(0);
}

// Find the onnxruntime-node bin directory containing onnxruntime.dll
const ortNodeBase = path.join(root, "node_modules", "onnxruntime-node", "bin");
if (!fs.existsSync(ortNodeBase)) {
  console.log("[postinstall] onnxruntime-node bin directory not found, skipping.");
  process.exit(0);
}

// Walk napi-v*/win32/x64 (or arm64) directories
for (const napiDir of fs.readdirSync(ortNodeBase)) {
  const target = path.join(ortNodeBase, napiDir, platform, arch);
  const ortDll = path.join(target, "onnxruntime.dll");
  const dst = path.join(target, "onnxruntime_providers_shared.dll");

  if (fs.existsSync(ortDll) && !fs.existsSync(dst)) {
    fs.copyFileSync(src, dst);
    console.log(`[postinstall] Copied onnxruntime_providers_shared.dll → ${path.relative(root, dst)}`);
  }
}
