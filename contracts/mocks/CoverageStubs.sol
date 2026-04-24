// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TreasuryStub {
    uint256 public lastFundedBatch;
    uint256 public lastFundedAmount;
    uint256 public lastReportedBatch;

    function fundEscrowBatch(uint256 batchId, uint256 amountUsd) external {
        lastFundedBatch = batchId;
        lastFundedAmount = amountUsd;
    }

    function reportBatchResult(
        uint256 batchId,
        uint256,
        uint256,
        uint256,
        uint256
    ) external {
        lastReportedBatch = batchId;
    }

    function poke() external pure returns (bool) {
        return true;
    }
}

contract VaultStub {
    struct DepositReceipt {
        address user;
        address asset;
        uint256 amount;
        uint256 amountUsd6;
        uint256 shares;
        uint64 createdAt;
        uint64 lockUntil;
        bool withdrawn;
    }

    mapping(uint256 => DepositReceipt) public deposits;

    function setDeposit(
        uint256 tokenId,
        address user,
        address asset,
        uint256 amount,
        uint256 amountUsd6,
        uint256 shares,
        uint64 createdAt,
        uint64 lockUntil,
        bool withdrawn
    ) external {
        deposits[tokenId] = DepositReceipt(user, asset, amount, amountUsd6, shares, createdAt, lockUntil, withdrawn);
    }

    function depositInfo(uint256 tokenId) external view returns (DepositReceipt memory) {
        return deposits[tokenId];
    }
}

contract SAGTokenStub is ERC20 {
    constructor() ERC20("SAG Stub", "SAG") {}

    function faucetMint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract TestTreasury {
    IERC20 public immutable usdc;
    uint256 public lastFundedBatch;
    uint256 public lastFundedAmount;
    uint256 public lastReportedBatch;

    constructor(address usdc_) {
        usdc = IERC20(usdc_);
    }

    function fundEscrowBatch(uint256 batchId, uint256 amountUsd) external {
        lastFundedBatch = batchId;
        lastFundedAmount = amountUsd;
        (bool ok,) = address(usdc).call(abi.encodeWithSignature("mint(address,uint256)", msg.sender, amountUsd));
        require(ok, "mint failed");
    }

    function reportBatchResult(
        uint256 batchId,
        uint256,
        uint256,
        uint256,
        uint256
    ) external {
        lastReportedBatch = batchId;
    }

    function reportBatchResult(
        uint256 batchId,
        uint256,
        uint256,
        uint256,
        uint256,
        bytes32,
        bytes32
    ) external {
        lastReportedBatch = batchId;
    }

    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }
}

interface IEscrowLegacy {
    function registerDeposit(uint256 tokenId, uint256 amountUsd6, uint256 shares) external;
    function registerDepositTo(uint256 batchId, uint256 tokenId, uint256 amountUsd6, uint256 shares) external;
}

contract TestVault is VaultStub {
    function forwardRegisterDeposit(address escrow, uint256 tokenId, uint256 amountUsd6, uint256 shares) external {
        IEscrowLegacy(escrow).registerDeposit(tokenId, amountUsd6, shares);
    }

    function forwardRegisterDepositTo(address escrow, uint256 batchId, uint256 tokenId, uint256 amountUsd6, uint256 shares) external {
        IEscrowLegacy(escrow).registerDepositTo(batchId, tokenId, amountUsd6, shares);
    }
}
