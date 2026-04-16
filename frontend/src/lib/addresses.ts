// Stable selector — committed to git, never auto-generated.
// Deploy scripts write to addresses.<network>.ts (e.g. addresses.moonbase.ts, addresses.local.ts).
// Set NEXT_PUBLIC_NETWORK in .env.local to match the target environment.
// Defaults to "moonbase" if unset.

const network = process.env.NEXT_PUBLIC_NETWORK ?? 'moonbase';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const CONTRACT_ADDRESSES: Record<string, any> =
  (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(`./addresses.${network}`).CONTRACT_ADDRESSES ?? {};
    } catch {
      console.warn(`[addresses] No addresses file found for network "${network}". Run the deploy script.`);
      return {};
    }
  })();
