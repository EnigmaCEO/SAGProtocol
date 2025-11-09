import * as ethers from 'ethers';

/*
  decodeRevert(abi, dataHex) -> string
  - abi: contract ABI (array or object with .abi)
  - dataHex: hex string (e.g. error.data or err.error?.data)
*/
export default function decodeRevert(abi: any, dataHex: string | undefined): string {
  if (!dataHex) return 'no revert data';
  const data = typeof dataHex === 'string' && dataHex.startsWith('0x') ? dataHex : `0x${String(dataHex || '')}`;

  // prefer raw Error(string) decode (selector 0x08c379a0)
  try {
    const errSelector = data.slice(0, 10).toLowerCase();
    const abiCoder = (ethers as any).utils?.defaultAbiCoder ?? (ethers as any).defaultAbiCoder;
    if (errSelector === '0x08c379a0') {
      // Error(string)
      const payload = '0x' + data.slice(10);
      const decoded = abiCoder.decode(['string'], payload);
      return `Error: ${decoded[0]}`;
    }

    // attempt to build an Interface from ABI (support both array ABI and { abi: [...] } shapes)
    const rawAbi = Array.isArray(abi) ? abi : (abi?.abi ?? abi);
    const InterfaceCtor = (ethers as any).Interface ?? (ethers as any).utils?.Interface;
    if (!InterfaceCtor || !rawAbi) {
      return `Unknown revert (${data}). ABI or Interface not available.`;
    }
    const iface = new InterfaceCtor(rawAbi);

    // try parseError if available (ethers v6)
    try {
      if (typeof (iface as any).parseError === 'function') {
        const parsed = (iface as any).parseError(data);
        if (parsed) {
          const args = parsed.args ? JSON.stringify(parsed.args) : '';
          return `Reverted: ${parsed.name} ${args}`;
        }
      }
    } catch {
      // continue to manual match
    }

    // manual error selector match against ABI error fragments
    const sel = data.slice(0, 10).toLowerCase();
    for (const fragment of iface.fragments ?? []) {
      if (fragment.type !== 'error') continue;
      const sig = iface.getSighash(fragment);
      if (sig.toLowerCase() === sel) {
        // decode error args
        const payload = '0x' + data.slice(10);
        let args: any = [];
        try {
          // ethers v6: decodeErrorResult, v5: decodeErrorResult may not exist, fallback to decode
          if (typeof (iface as any).decodeErrorResult === 'function') {
            args = (iface as any).decodeErrorResult(fragment, payload);
          } else {
            // build types from fragment.inputs
            const types = (fragment.inputs || []).map((i: any) => i.type);
            args = (abiCoder as any).decode(types, payload);
          }
        } catch (e) {
          // ignore decoding error
        }
        return `Revert ${fragment.name}(${args ? JSON.stringify(args) : ''})`;
      }
    }

    // fallback: show raw data
    return `Reverted with unknown selector ${sel}, raw: ${data}`;
  } catch (err: any) {
    return `Failed to decode revert: ${String(err)} (raw: ${data})`;
  }
}
