// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IGoldOracleLegacy {
    function getGoldPrice() external view returns (uint256);
}

interface IPriceOracle {
    function getPrice() external view returns (uint256);
}

interface IOracleLatest {
    function latest() external view returns (uint256 price8, uint256 updatedAt, bool valid);
}

interface IOracleUpdatedAt {
    function updatedAt() external view returns (uint256);
}

interface IOracleValidity {
    function valid() external view returns (bool);
}

/**
 * @title ReserveController
 * @notice Holds the gold reserve backing the Sagitta protocol and exposes NAV and coverage views
 *         consumed by Treasury.
 * @dev On mainnet the `gold` token would be XAUT or PAXG. The contract is Ownable; the owner
 *      (operator / multi-sig) can adjust BPS targets and migrate the oracle address.
 *
 *      KNOWN ISSUE — manageReserve():
 *        The manageReserve() function accepts a `currentRatio` in basis points and computes
 *        fill/drain amounts as a raw BPS difference, which has no meaningful relationship to
 *        actual token quantities. This function is not called by the automated Treasury flow
 *        and should be treated as an admin convenience stub. Do not rely on it for production
 *        rebalancing; the authoritative rebalance path is Treasury._rebalanceReserve().
 *
 *      SECURITY — ORACLE:
 *        The goldOracle address is owner-controlled. A misconfigured oracle (wrong decimals or
 *        address) will cause navReserveUsd() to return 0, which Treasury interprets as a full
 *        reserve loss and escalates the stress state to Emergency.
 */
contract ReserveController is Ownable {
    uint256 private constant PRICE_SCALE = 1e8;

    IERC20 public immutable gold;
    address public treasury;

    uint256 public reserveFloorBps = 1200; // 12%
    uint256 public reserveCeilBps = 2500; // 25%
    uint256 public reserveRatio;
    address public goldOracle; // authoritative oracle address (returns USD*1e6)
    mapping(address => uint256) public reserves;

    event ReserveFilled(uint256 amount);
    event ReserveDrained(uint256 amount);
    event ReserveRatioUpdated(uint256 newRatio);
    event ReservesAdded(address indexed asset, uint256 amount);
    event GoldPriceUpdated(uint256 newPrice);

    constructor(IERC20 _gold, address _goldOracle) Ownable(msg.sender) {
        gold = _gold;
        reserveRatio = 2000; // 20% default
        goldOracle = _goldOracle;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Treasury address cannot be zero");
        treasury = _treasury;
    }

    // set the external oracle address (owner only) to support migration
    function setGoldOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "oracle cannot be zero");
        goldOracle = _oracle;
    }

    /**
     * @notice Admin stub: adjust gold reserve toward the configured BPS floor/ceil.
     * @dev WARNING: The fill/drain amounts computed here are raw BPS differences, not token
     *      quantities. This function is a placeholder that should not be used in production
     *      without a rewrite that converts BPS targets to actual token amounts based on the
     *      current oracle price and reserve balance. The authoritative rebalance path is
     *      Treasury._rebalanceReserve(). This function is restricted to onlyOwner.
     * @param currentRatio Current reserve ratio in basis points (informational only).
     */
    function manageReserve(uint256 currentRatio) external onlyOwner {
        if (currentRatio < reserveFloorBps) {
            uint256 amountToFill = reserveFloorBps - currentRatio;
            require(gold.transferFrom(treasury, address(this), amountToFill), "Reserve fill failed");
            emit ReserveFilled(amountToFill);
        } else if (currentRatio > reserveCeilBps) {
            uint256 amountToDrain = currentRatio - reserveCeilBps;
            require(gold.transfer(treasury, amountToDrain), "Reserve drain failed");
            emit ReserveDrained(amountToDrain);
        }
    }

    function setReserveRatio(uint256 newRatio) external onlyOwner {
        require(newRatio <= 10000, "Invalid ratio");
        reserveRatio = newRatio;
        emit ReserveRatioUpdated(newRatio);
    }

    function getReserveRatio() external view returns (uint256) {
        return reserveRatio;
    }

    function addReserves(address asset, uint256 amount) external onlyOwner {
        reserves[asset] += amount;
        emit ReservesAdded(asset, amount);
    }

    function totalReserves(address asset) external view returns (uint256) {
        return reserves[asset];
    }

    /// @notice Get the Net Asset Value of reserves in USD (6 decimals)
    /// @return Total USD value of all reserves
    function navReserveUsd() external view returns (uint256) {
        uint256 goldBal = gold.balanceOf(address(this));
        (uint256 price8,, bool isValid) = _readGoldOracle();
        if (!isValid || price8 == 0) {
            return 0;
        }
        // Convert GOLD balance (18 decimals) to USD value (6 decimals): goldBal * price8 / 1e20
        return (goldBal * price8) / 1e20;
    }

    /// @notice Calculate coverage ratio in basis points
    /// @return Coverage ratio (0-10000 = 0%-100%)
    function coverageRatio() external view returns (uint256) {
        // This is a simplified version - in production would compare reserve value to liabilities
        return reserveRatio;
    }

    function _readGoldOracle() internal view returns (uint256 price8, uint256 updatedAt_, bool isValid) {
        if (goldOracle == address(0)) {
            return (0, 0, false);
        }

        try IOracleLatest(goldOracle).latest() returns (uint256 latestPrice8, uint256 ts, bool valid_) {
            return (latestPrice8, ts, valid_ && latestPrice8 > 0);
        } catch {}

        try IOracleUpdatedAt(goldOracle).updatedAt() returns (uint256 ts) {
            updatedAt_ = ts;
        } catch {
            updatedAt_ = 0;
        }

        try IOracleValidity(goldOracle).valid() returns (bool valid_) {
            isValid = valid_;
        } catch {
            isValid = true;
        }

        try IPriceOracle(goldOracle).getPrice() returns (uint256 latestPrice8) {
            price8 = latestPrice8;
        } catch {}

        if (price8 == 0) {
            try IGoldOracleLegacy(goldOracle).getGoldPrice() returns (uint256 price6) {
                price8 = price6 * 100;
            } catch {
                return (0, updatedAt_, false);
            }
        }

        if (updatedAt_ == 0) {
            isValid = false;
        }
        if (price8 == 0) {
            isValid = false;
        }
        if (price8 > 0 && price8 < PRICE_SCALE / 10) {
            // Defensive sanity guard against accidental decimal mismatches.
            isValid = false;
        }

        return (price8, updatedAt_, isValid);
    }
}
