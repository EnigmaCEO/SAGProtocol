import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';
import { initOnChainAddresses } from '../lib/runtime-addresses';

// Kick off the ProtocolDAO address fetch as early as possible so that by the
// time any component mounts and calls fetchData, the on-chain cache is already
// populated (or at least in flight and nearly done).
if (typeof window !== 'undefined') {
  initOnChainAddresses();
}

const siteUrl = 'https://protocol.sagitta.systems/';
const siteTitle = 'Sagitta Protocol - Trustless Wealth Management';
const siteDescription =
  'Deposit USDC, earn yield backed by real gold reserves. Transparent, on-chain, and auditable.';
const socialImageUrl = `${siteUrl}og-image.png`;

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>{siteTitle}</title>
        <meta name="application-name" content="Sagitta Protocol" />
        <meta
          name="description"
          content="Sagitta Protocol - a Trustless Wealth Management protocol. Deposit USDC, earn yield backed by real gold reserves."
        />
        <meta
          name="keywords"
          content="Sagitta Protocol, gold-backed, DeFi, vault, USDC, yield, blockchain"
        />
        <meta name="author" content="Sagitta Protocol" />

        <meta property="og:type" content="website" />
        <meta property="og:locale" content="en_US" />
        <meta property="og:site_name" content="Sagitta Protocol" />
        <meta property="og:title" content={siteTitle} />
        <meta property="og:description" content={siteDescription} />
        <meta property="og:url" content={siteUrl} />
        <meta property="og:image" content={socialImageUrl} />
        <meta property="og:image:secure_url" content={socialImageUrl} />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Sagitta Protocol logo" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={siteTitle} />
        <meta name="twitter:description" content={siteDescription} />
        <meta name="twitter:image" content={socialImageUrl} />
        <meta name="twitter:image:alt" content="Sagitta Protocol logo" />

        <meta name="theme-color" content="#0a111c" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
