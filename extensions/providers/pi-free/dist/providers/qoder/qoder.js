/**
 * Qoder Provider Extension.
 *
 * Qoder uses a custom OAuth/PAT flow and custom OpenAI-compatible streaming,
 * but its provider registration now uses Pi's native Provider and
 * models-store lifecycle. The factory performs no catalog network I/O.
 */
import { PROVIDER_QODER } from "../../constants.js";
import { registerWithGlobalToggle } from "../../lib/registry.js";
import { registerNativeProvider, registerNativeProviderRefresh, registerNativeProviderToggle, } from "../../lib/native-provider.js";
import { createQoderProvider } from "./qoder-provider.js";
export default async function qoderProvider(pi) {
    const { provider, stored } = createQoderProvider();
    registerNativeProvider(pi, provider);
    // Re-register the same provider object only to invalidate Pi's availability
    // snapshot after the global or provider-specific free/paid toggle changes.
    const reRegister = () => registerNativeProvider(pi, provider);
    registerWithGlobalToggle(PROVIDER_QODER, stored, reRegister, false, {
        native: true,
        invalidate: reRegister,
    });
    registerNativeProviderToggle(pi, {
        providerId: PROVIDER_QODER,
        stored,
        reRegister,
    });
    registerNativeProviderRefresh(pi, PROVIDER_QODER);
}
// Re-export the auth object for tests (tests/qoder-auth.test.ts imports it
// from this module, the provider's public entry point).
export { qoderAuth } from "./auth.js";
//# sourceMappingURL=qoder.js.map