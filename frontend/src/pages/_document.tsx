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
        <meta name="description" content="Sagitta Protocol — gold-backed DeFi vault on Moonbase Alpha" />
        <meta property="og:title" content="Sagitta Protocol" />
        <meta property="og:description" content="Gold-backed DeFi vault on Moonbase Alpha" />
        <meta property="og:image" content="/favicon.png" />
        <meta name="theme-color" content="#0a111c" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
