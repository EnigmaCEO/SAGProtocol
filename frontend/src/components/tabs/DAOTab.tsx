import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import MetricCard from '../ui/MetricCard';
import MetricGrid from '../ui/MetricGrid';
import { getContract } from '../../lib/ethers';
import { getOperator, isOperatorAddress } from '../../lib/operator';
import { Clock, ShieldAlert, UserCog, Zap, Users, CheckCircle, XCircle } from 'lucide-react';

export default function DAOTab() {
  const [address, setAddress] = useState<string>('');
  const [operator, setOperator] = useState<string | null>(null);
  const [ownerAddress, setOwnerAddress] = useState<string>('');
  const [adminAddresses, setAdminAddresses] = useState<string[]>([]);
  const [vaultPaused, setVaultPaused] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  const [newAdmin, setNewAdmin] = useState('');
  const [loading, setLoading] = useState(true);

  const isOp = isOperatorAddress(address, operator);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const op = await getOperator();
      setOperator(op);
      if (op) setAddress(op);
      
      try {
        const vault = await getContract('vault') as any;
        if (!vault) {
          console.error('Vault contract not found');
          return;
        }
        const [owner, paused] = await Promise.all([
          vault.owner().catch(() => ethers.ZeroAddress),
          vault.paused().catch(() => false),
        ]);
        setOwnerAddress(owner);
        setVaultPaused(paused);
        setAdminAddresses([owner]); // Mock data
      } catch (error) {
        console.error('Failed to load DAO data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handlePauseToggle = async () => {
    setLoading(true);
    try {
      const vault = await getContract('vault') as any;
      const tx = vaultPaused ? await vault.unpause() : await vault.pause();
      await tx.wait();
      setVaultPaused(!vaultPaused);
    } catch (error: any) {
      alert(error.reason || error.message || 'Failed to toggle pause');
    } finally {
      setLoading(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!newOwner || !ethers.isAddress(newOwner)) {
      alert('Invalid address');
      return;
    }
    setLoading(true);
    try {
      const vault = await getContract('vault') as any;
      const tx = await vault.transferOwnership(newOwner);
      await tx.wait();
      alert('Ownership transferred!');
      setOwnerAddress(newOwner);
      setNewOwner('');
    } catch (error: any) {
      alert(error.reason || error.message || 'Failed to transfer ownership');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !ownerAddress) {
    return <div className="text-center py-16">Loading DAO Data...</div>;
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <h2 style={{ marginBlockStart: '0.3em' }}>DAO Administration</h2>
          <div className="text-slate-400 text-sm mt-1">Heavy is the head that wears the crown</div>
          <div style={{ height: 12 }} />
          <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
        </div>
      </div>
      <div className="sagitta-grid">
        {/* Cell 1 */}
        <div className="sagitta-cell">
        <h3>Protocol Owner</h3>
          <MetricGrid>
          <MetricCard 
          title="" 
          value={`${ownerAddress.slice(0, 6)}...${ownerAddress.slice(-4)}`}
          tone="neutral"
          icon={<UserCog />}
          />
          </MetricGrid>
        </div>
        {/* Cell 2 */}
        <div className="sagitta-cell">
          <h3>Protocol Status</h3>
          <MetricCard 
          title="" 
          value={vaultPaused ? 'Paused' : 'Active'}
          tone={vaultPaused ? 'danger' : 'success'}
          icon={vaultPaused ? <XCircle/> : <CheckCircle/>}
        />
        </div>
        {/* Cell 3 */}
        <div className="sagitta-cell">
          <h3>Admins</h3>
          <MetricCard 
          title="" 
          value={adminAddresses.length.toString()}
          tone="neutral"
          icon={<Users/>}
        />
        </div>

        {/* Cell 4 */}
        <div className="sagitta-cell">
          <h3><ShieldAlert size={22}/>Emergency Controls</h3>
          <div className="flex items-center justify-between rounded-lg p-4 bg-slate-900/50">
              <p className="text-slate-300">{vaultPaused ? 'Resume all operations' : 'Pause all vault operations'}</p>
              <button
                onClick={handlePauseToggle}
                disabled={!isOp || loading}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                  vaultPaused 
                  ? 'bg-emerald-500 text-white hover:bg-emerald-400 hover:shadow-[0_0_20px_theme(colors.emerald.500)]' 
                  : 'bg-rose-600 text-white hover:bg-rose-500 hover:shadow-[0_0_20px_theme(colors.rose.500)]'
                }`}
              >
                {vaultPaused ? 'Resume' : 'Pause'}
              </button>
            </div>
        </div>

        {/* Cell 5 */}
        <div className="sagitta-cell">
          <h3><Zap size={22}/>Transfer Ownership</h3>
          <p className="text-sm text-slate-400 mb-4">This action is irreversible and will transfer full control.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                placeholder="0x... new owner address"
                className="flex-1 bg-slate-900/70 border border-slate-700 rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-sky-500/50 focus:outline-none transition-all"
                disabled={!isOp || loading}
              />
              <button
                onClick={handleTransferOwnership}
                disabled={!isOp || !newOwner || loading}
                className="rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300 bg-amber-600 text-white hover:bg-amber-500 hover:shadow-[0_0_20px_theme(colors.amber.500)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
              >
                Transfer
              </button>
            </div>
        </div>

        {/* Cell 6 */}
        <div className="sagitta-cell">
          <h3><UserCog size={22}/>Protocol Administrators</h3>
          <div className="space-y-2 p-4">
            {adminAddresses.map((addr, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_auto] gap-4 items-center bg-slate-900/50 rounded-lg p-3 hover:bg-slate-800/50 transition-colors">
                <span className="font-mono text-sm truncate text-slate-300">Address: {addr}</span>
                <div style={{ height: 12 }} />
                {addr === ownerAddress && (
                  <span className="text-xs bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-2.5 py-1 rounded-full font-semibold">Role: Owner</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
