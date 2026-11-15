// Dev-only switches for the Agent tab. Both stay false in anything that ships.
export const AGENT_FLAGS = {
  /**
   * Registers a local in-app provider that streams a canned reply, so the conversation view,
   * action cards and the "Connect your plan" row can be checked without a real backend.
   * Only honored in __DEV__ builds.
   */
  exampleConversation: false,
} as const;

export const showExample = __DEV__ && AGENT_FLAGS.exampleConversation;
