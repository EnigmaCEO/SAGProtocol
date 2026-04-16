import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { initOnChainAddresses } from '../lib/runtime-addresses';

// Kick off the ProtocolDAO address fetch as early as possible so that by the
// time any component mounts and calls fetchData, the on-chain cache is already
// populated (or at least in flight and nearly done).
if (typeof window !== 'undefined') {
  initOnChainAddresses();
}

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
