// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PredictionPool} from "../src/PredictionPool.sol";

/// A token that calls back into the pool on every outgoing transfer (RULES 6.3).
contract HostileToken is ERC20 {
    PredictionPool public target;
    uint256 public poolId;
    bool public armed;

    constructor() ERC20("Hostile", "HOS") {}

    function arm(PredictionPool target_, uint256 poolId_) external {
        target = target_;
        poolId = poolId_;
        armed = true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == address(target)) {
            armed = false;
            target.claim(poolId);
        }
    }
}

contract ReentrancyTest is Test {
    HostileToken internal token;
    PredictionPool internal pool;
    address internal forwarder = makeAddr("forwarder");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        token = new HostileToken();
        pool = new PredictionPool(address(token), forwarder, makeAddr("treasury"));
    }

    function test_claim_reentryBlocked() public {
        uint256 id = pool.createPool("q", "ethereum", 0, 1e18, uint64(block.timestamp + 120));
        _stake(alice, id, true, 10e6);
        _stake(bob, id, false, 10e6);
        vm.warp(block.timestamp + 120);
        vm.prank(forwarder);
        pool.onReport("", abi.encode(id, true, 2e18));

        token.arm(pool, id);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(alice);
        pool.claim(id);
    }

    function _stake(address user, uint256 id, bool isYes, uint256 amount) private {
        token.mint(user, amount);
        vm.startPrank(user);
        token.approve(address(pool), amount);
        pool.stake(id, isYes, amount);
        vm.stopPrank();
    }
}
