import { exampleProvider } from "./example";
import { showExample } from "./flags";
import { HANDOFF_PROVIDERS } from "./handoff";
import { registerPlans } from "./inapp";
import { registerProvider } from "./provider";

// Built-ins: the person's own Claude/ChatGPT plan running in yuzu, then the assistant apps
// (handoff). The Agent tab picks them up automatically.
registerPlans();
HANDOFF_PROVIDERS.forEach(registerProvider);
if (showExample) registerProvider(exampleProvider);

export * from "./provider";
export { HANDOFF_PROVIDERS } from "./handoff";
export { showExample } from "./flags";
export {
  PLAN_NAME,
  PLAN_PROVIDER_ID,
  closeLogin,
  openLogin,
  planForProvider,
  planStatus,
  selectPlan,
  tokenFrom,
  useActiveThread,
  useAiPlans,
  useLoginRequest,
  type PlanId,
  type ProviderStatus,
} from "./inapp";
