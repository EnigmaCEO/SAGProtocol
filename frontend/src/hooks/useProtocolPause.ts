import { useEffect, useState } from 'react';
import { ethers } from 'ethers';

import { getRuntimeAddress, isValidAddress } from '../lib/runtime-addresses';
import { UI_REFRESH_EVENT } from '../lib/ui-refresh';
import { RPC_URL } from '../lib/network';

const LOCALHOST_RPC = RPC_URL;

export default function useProtocolPause(): { isPaused: boolean; loading: boolean } {
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const provider = new ethers.JsonRpcProvider(LOCALHOST_RPC);

    const refreshPauseState = async () => {
      const vaultAddress = getRuntimeAddress('Vault');
      if (!isValidAddress(vaultAddress)) {
        if (active) {
          setIsPaused(false);
          setLoading(false);
        }
        return;
      }

      try {
        const vault = new ethers.Contract(vaultAddress, ['function paused() view returns (bool)'], provider);
        const paused = await vault.paused().catch(() => false);
        if (active) setIsPaused(Boolean(paused));
      } catch {
        if (active) setIsPaused(false);
      } finally {
        if (active) setLoading(false);
      }
    };

    void refreshPauseState();

    if (typeof window !== 'undefined') {
      window.addEventListener(UI_REFRESH_EVENT, refreshPauseState as EventListener);
      window.addEventListener('storage', refreshPauseState);
      return () => {
        active = false;
        window.removeEventListener(UI_REFRESH_EVENT, refreshPauseState as EventListener);
        window.removeEventListener('storage', refreshPauseState);
      };
    }

    return () => {
      active = false;
    };
  }, []);

  return { isPaused, loading };
}
