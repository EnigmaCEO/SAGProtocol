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
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          DAO Administration
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <MetricGrid>
        <MetricCard 
          title="Contract Owner" 
          value={`${ownerAddress.slice(0, 6)}...${ownerAddress.slice(-4)}`}
          tone="neutral"
          icon={<UserCog />}
        />
        <MetricCard 
          title="Protocol State" 
          value={vaultPaused ? 'Paused' : 'Active'}
          tone={vaultPaused ? 'danger' : 'success'}
          icon={vaultPaused ? <XCircle/> : <CheckCircle/>}
        />
        <MetricCard 
          title="Admins" 
          value={adminAddresses.length.toString()}
          tone="neutral"
          icon={<Users/>}
        />
      </MetricGrid>

      {/* Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {/* Emergency Controls */}
          <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50">
            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2 text-rose-400"><ShieldAlert size={22}/>Emergency Controls</h3>
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

          {/* Ownership Transfer */}
          <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl p-6 border border-slate-700/50">
            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2 text-amber-400"><Zap size={22}/>Transfer Ownership</h3>
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
        </div>

        {/* Admins List */}
        <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl border border-slate-700/50 flex flex-col overflow-hidden">
          <h3 className="text-xl font-semibold p-6 flex items-center gap-2"><UserCog size={22}/>Protocol Administrators</h3>
          <div className="overflow-y-auto -mx-6 -mb-6 px-2 rounded-b-2xl">
            <div className="sticky top-0 bg-slate-900/70 backdrop-blur-sm px-4 py-2 border-b-2 border-sky-700/40">
              <div className="text-xs text-slate-400 uppercase font-bold grid grid-cols-[1fr_auto] gap-4 px-2">
                <div>Address</div>
                <div>Role</div>
              </div>
            </div>
            <div className="space-y-2 p-4">
              {adminAddresses.map((addr, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto] gap-4 items-center bg-slate-900/50 rounded-lg p-3 hover:bg-slate-800/50 transition-colors">
                  <span className="font-mono text-sm truncate text-slate-300">{addr}</span>
                  {addr === ownerAddress && (
                    <span className="text-xs bg-gradient-to-r from-sky-500 to-indigo-500 text-white px-2.5 py-1 rounded-full font-semibold">Owner</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
