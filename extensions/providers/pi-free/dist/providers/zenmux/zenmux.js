/**
 * ZenMux Provider Extension
 *
 * ZenMux is an OpenAI-compatible gateway for models from multiple providers.
 * It is registered as a native Pi Provider so Pi owns credential resolution,
 * models-store persistence, refresh throttling, and offline initialization.
 *
 * Setup:
 *   1. Get an API key from https://zenmux.ai
 *   2. Set ZENMUX_API_KEY or add zenmux_api_key to ~/.pi/free.json
 */
import { getZenmuxApiKey } from "../../config.js";
import { PROVIDER_ZENMUX } from "../../constants.js";
import { registerNativeProvider, registerNativeProviderRefresh, registerNativeProviderToggle, } from "../../lib/native-provider.js";
import { registerWithGlobalToggle } from "../../lib/registry.js";
import { createZenmuxProvider } from "./zenmux-provider.js";
export default async function zenmuxProvider(pi) {
    const { provider, stored } = createZenmuxProvider();
    registerNativeProvider(pi, provider);
    const reRegister = () => {
        registerNativeProvider(pi, provider);
    };
    registerWithGlobalToggle(PROVIDER_ZENMUX, stored, reRegister, Boolean(getZenmuxApiKey()), { native: true, invalidate: reRegister });
    registerNativeProviderToggle(pi, {
        providerId: PROVIDER_ZENMUX,
        stored,
        reRegister,
    });
    registerNativeProviderRefresh(pi, PROVIDER_ZENMUX);
}
//# sourceMappingURL=zenmux.js.map