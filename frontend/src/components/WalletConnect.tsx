export function WalletConnect() {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        <span className="text-sm font-medium text-gray-700">Demo Mode Active</span>
      </div>
      <p className="text-xs text-gray-600 mt-1">
        Using test account: 0xf39F...2266
      </p>
    </div>
  );
}
