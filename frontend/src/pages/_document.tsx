import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Favicon — browsers prefer .ico; PNG fallback for modern browsers */}
        <link rel="icon" href="/favicon.png" type="image/png" sizes="268x268" />
        <link rel="shortcut icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/favicon.png" />

        {/* Site metadata */}
        <meta name="application-name" content="Sagitta Protocol" />
        <meta name="description" content="Sagitta Protocol — a gold-backed DeFi vault protocol. Deposit USDC, earn yield backed by real gold reserves." />
        <meta name="keywords" content="Sagitta Protocol, gold-backed, DeFi, vault, USDC, yield, blockchain" />
        <meta name="author" content="Sagitta Protocol" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Sagitta Protocol" />
        <meta property="og:title" content="Sagitta Protocol — Gold-Backed DeFi Vault" />
        <meta property="og:description" content="Deposit USDC, earn yield backed by real gold reserves. Transparent, on-chain, and auditable." />
        <meta property="og:url" content="https://protocol.sagitta.systems/" />
        <meta property="og:image" content="https://protocol.sagitta.systems/favicon.png" />
        <meta property="og:image:width" content="268" />
        <meta property="og:image:height" content="268" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Sagitta Protocol — Gold-Backed DeFi Vault" />
        <meta name="twitter:description" content="Deposit USDC, earn yield backed by real gold reserves." />
        <meta name="twitter:image" content="https://protocol.sagitta.systems/favicon.png" />

        <meta name="theme-color" content="#0a111c" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
