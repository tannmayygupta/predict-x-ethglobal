// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

/// Shared fixture: a fresh MockUSDC and PredictionPool with dedicated forwarder and treasury accounts.
abstract contract PoolTestBase is Test {
    uint64 internal constant MIN_DURATION = 120;
    uint64 internal constant ONE_HOUR = 3600;
    uint256 internal constant STRIKE_E18 = 3_000e18;
    uint256 internal constant PRICE_E18 = 3_100e18;
    uint8 internal constant ABOVE = 0;
    string internal constant QUESTION = "Will ETH be above $3,000 in 1h?";
    string internal constant COINGECKO_ID = "ethereum";

    MockUSDC internal usdc;
    PredictionPool internal pool;
    address internal forwarder = makeAddr("forwarder");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        pool = new PredictionPool(address(usdc), forwarder, treasury);
    }

    function _create(uint64 duration) internal returns (uint256 id) {
        vm.prank(creator);
        id = pool.createPool(QUESTION, COINGECKO_ID, ABOVE, STRIKE_E18, uint64(block.timestamp) + duration);
    }

    /// Mints and approves exactly `amount` (the extension never asks for unlimited approval), then stakes.
    function _stake(address user, uint256 id, bool isYes, uint256 amount) internal {
        _fund(user, amount);
        vm.prank(user);
        usdc.approve(address(pool), amount);
        vm.prank(user);
        pool.stake(id, isYes, amount);
    }

    function _fund(address user, uint256 amount) internal {
        uint256 cap = usdc.MAX_MINT_PER_CALL();
        while (amount > 0) {
            uint256 chunk = amount > cap ? cap : amount;
            usdc.mint(user, chunk);
            amount -= chunk;
        }
    }

    function _warpPast(uint256 id) internal {
        vm.warp(pool.getPool(id).resolveTime);
    }

    function _report(uint256 id, bool outcomeYes) internal {
        vm.prank(forwarder);
        pool.onReport("", abi.encode(id, outcomeYes, PRICE_E18));
    }

    function _resolve(uint256 id, bool outcomeYes) internal {
        _warpPast(id);
        _report(id, outcomeYes);
    }
}
