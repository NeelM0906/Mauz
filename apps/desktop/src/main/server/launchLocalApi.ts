export type LocalApiHandle = {
  stop(): Promise<void>;
};

export async function launchLocalApi(): Promise<LocalApiHandle> {
  return {
    async stop(): Promise<void> {
      // The Fastify local API starts in the Ask Mauz milestone.
    }
  };
}
