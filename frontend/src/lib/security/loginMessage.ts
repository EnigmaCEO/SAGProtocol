// The exact text a wallet signs to sign in.
//
// Kept in its own module with no Node-only imports so the browser and the
// server build the message from the same source. If they diverged by a single
// character, every sign-in would fail signature verification — or worse, a
// looser server-side reconstruction would accept a message the user never saw.
//
// Follows EIP-4361 ("Sign-In with Ethereum") field ordering. Each field is
// there for a reason:
//
//   domain / URI      the user can see which site is asking, and a signature
//                     farmed by another site does not verify here
//   Chain ID          a signature for a testnet console cannot be replayed
//                     against a mainnet one
//   Nonce             single-use; claimed atomically server-side
//   Issued At         bounds how long a captured signature stays useful
//   Expiration Time   makes that bound explicit to the signer, and is enforced

export interface LoginMessageParams {
  /** Checksummed or lowercase 0x address — used verbatim in the message. */
  address: string;
  nonce: string;
  /** Host of the site requesting the signature, e.g. `protocol.sagitta.systems`. */
  domain: string;
  /** Full origin, e.g. `https://protocol.sagitta.systems`. */
  uri: string;
  /** EVM chain id the console is operating against. */
  chainId: number;
  /** ISO-8601 timestamp. */
  issuedAt: string;
  /** ISO-8601 timestamp after which this challenge is refused. */
  expirationTime: string;
}

export function buildLoginMessage(params: LoginMessageParams): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to the Sagitta Protocol console. This signature proves wallet control. It authorizes no transaction and moves no funds.',
    '',
    `URI: ${params.uri}`,
    'Version: 1',
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expirationTime}`,
  ].join('\n');
}

/** How long a sign-in challenge stays valid. Also the nonce's lifetime. */
export const LOGIN_CHALLENGE_TTL_SECONDS = 300;
