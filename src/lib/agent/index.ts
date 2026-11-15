import { exampleProvider } from "./example";
import { showExample } from "./flags";
import { HANDOFF_PROVIDERS } from "./handoff";
import { registerProvider } from "./provider";

// Built-in providers. In-app providers register themselves with registerProvider() wherever they
// live; the Agent tab picks them up automatically.
HANDOFF_PROVIDERS.forEach(registerProvider);
if (showExample) registerProvider(exampleProvider);

export * from "./provider";
export { HANDOFF_PROVIDERS } from "./handoff";
export { showExample } from "./flags";
